import { itemKey, normalizeNFT } from './core.js?v=1.1.1';

export function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || new DOMException('Cancelled', 'AbortError'));
    const abort = () => { clearTimeout(timer); reject(signal.reason || new DOMException('Cancelled', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export function retryDelay(headers, attempt, now = Date.now(), rateLimited = true) {
  const retry = headers.get('Retry-After');
  const seconds = retry == null ? NaN : Number(retry);
  const date = retry && !Number.isFinite(seconds) ? Date.parse(retry) : NaN;
  const reset = rateLimited || headers.get('X-RateLimit-Remaining') === '0' ? Number(headers.get('X-RateLimit-Reset')) * 1000 : 0;
  return Math.max(1000 * 2 ** attempt, Number.isFinite(seconds) ? seconds * 1000 : 0, Number.isFinite(date) ? date - now : 0, Number.isFinite(reset) ? reset - now : 0);
}

export function createApiClient({ fetchImpl = fetch, wait = abortableDelay, now = Date.now } = {}) {
  let queue = Promise.resolve();
  let nextAllowed = 0;
  return function request(url, key, { signal, body, retries = 3 } = {}) {
    const operation = async () => {
      const target = new URL(url, 'https://api.opensea.io');
      if (target.origin !== 'https://api.opensea.io') throw new Error('API credentials can only be sent to OpenSea.');
      for (let attempt = 0; attempt <= retries; attempt++) {
        signal?.throwIfAborted();
        if (nextAllowed > now()) await wait(nextAllowed - now(), signal);
        const res = await fetchImpl(target.href, {
          method: body ? 'POST' : 'GET', redirect: 'error', signal,
          headers: { 'X-API-KEY': key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {})
        });
        if (res.headers.get('X-RateLimit-Remaining') === '0') {
          const reset = Number(res.headers.get('X-RateLimit-Reset')) * 1000;
          if (Number.isFinite(reset) && reset > now()) nextAllowed = reset;
        }
        if (res.status === 429 || res.status >= 500) {
          nextAllowed = now() + retryDelay(res.headers, attempt, now(), res.status === 429);
          if (attempt < retries) continue;
        }
        if (!res.ok) {
          // Do not reflect upstream bodies that could contain request details or credentials.
          const message = res.status === 401 || res.status === 403 ? 'OpenSea rejected this API key. Check its validity and permissions.' : res.status === 429 ? 'OpenSea rate limit reached. Wait before trying again.' : `OpenSea request failed (${res.status}).`;
          const error = new Error(message); error.status = res.status; throw error;
        }
        return res.json();
      }
    };
    const pending = queue.then(operation, operation);
    queue = pending.catch(() => {});
    return pending;
  };
}

export function nextPage(base, next, seen) {
  if (!next) return null;
  if (seen.has(next)) throw new Error('OpenSea repeated a page cursor. The scan stopped to avoid incomplete or duplicate results.');
  seen.add(next);
  return `${base}&next=${encodeURIComponent(next)}`;
}

export async function fetchNFTBatches(items, request, key, signal, onProgress = () => {}) {
  const result = [];
  // Batch one chain at a time: detailed NFT responses do not carry chain context.
  const chains = new Map();
  for (const item of items) {
    if (!chains.has(item.chain)) chains.set(item.chain, []);
    chains.get(item.chain).push(item);
  }
  for (const [chain, chainItems] of chains) for (let start = 0; start < chainItems.length; start += 20) {
    signal?.throwIfAborted();
    const batch = chainItems.slice(start, start + 20);
    const data = await request('/api/v2/nfts/batch', key, { signal, body: { identifiers: batch.map(i => ({ chain, contract_address: i.contractAddress, token_id: String(i.tokenId) })) } });
    const byIdentity = new Map((data.nfts || []).map(n => [itemKey({ chain, contractAddress: n.contract, tokenId: n.identifier }), n]));
    for (const item of batch) {
      const nft = byIdentity.get(itemKey(item));
      if (nft) result.push(normalizeNFT(nft, item));
      // Omitted NFTs are explicit unavailable metadata, never positionally matched.
      else result.push({ ...item, name: item.name || `#${item.tokenId}`, traits: item.traits || [], traitsKnown: false, metadataUnavailable: true });
    }
    onProgress(result.length, items.length);
  }
  return result;
}

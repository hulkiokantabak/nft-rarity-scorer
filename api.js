import { itemKey, normalizeNFT } from './core.js?v=1.6.0';

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

// Rank-only enrichment: never replace Art Blocks traits, supply, owner or score.
export async function fetchOpenSeaRarities(items, request, key, signal, onProgress = () => {}) {
  const records = new Map(), collections = new Map(), warnings = new Set(), groups = new Map();
  for (const item of items) { if (!groups.has(item.chain)) groups.set(item.chain, []); groups.get(item.chain).push(item); }
  let done = 0, stop = false;
  for (const [chain, group] of groups) {
    if (stop) break;
    for (let start = 0; start < group.length; start += 20) {
      signal?.throwIfAborted();
      const batch = group.slice(start, start + 20), expected = new Set(batch.map(itemKey));
      try {
        const data = await request('/api/v2/nfts/batch', key, { signal, retries: 1,
          body: { identifiers: batch.map(i => ({ chain, contract_address: i.contractAddress, token_id: i.tokenId })) } });
        for (const nft of data.nfts || []) {
          const id = itemKey({ chain, contractAddress: nft.contract, tokenId: nft.identifier });
          if (expected.has(id)) records.set(id, { rarity: nft.rarity, slug: typeof nft.collection === 'string' ? nft.collection : null });
        }
      } catch (e) {
        signal?.throwIfAborted();
        warnings.add('Some OpenSea ranks could not be fetched. Art Blocks scores are retained.');
        if ([401, 403, 429].includes(e.status)) { stop = true; break; }
      }
      done += batch.length; onProgress(done, items.length);
    }
  }
  if (!stop) for (const slug of new Set([...records.values()].filter(r => Number.isSafeInteger(r.rarity?.rank) && r.rarity.rank > 0 && r.slug).map(r => r.slug))) {
    signal?.throwIfAborted();
    try {
      const collection = await request(`/api/v2/collections/${encodeURIComponent(slug)}`, key, { signal, retries: 1 });
      if (collection.collection !== slug) throw new Error('OpenSea collection identity mismatch.');
      collections.set(slug, collection);
    }
    catch (e) {
      signal?.throwIfAborted(); warnings.add('Some OpenSea ranking populations are unavailable; those ranks have no percentage.');
      if ([401, 403, 429].includes(e.status)) break;
    }
  }
  return { records, collections, warnings: [...warnings] };
}

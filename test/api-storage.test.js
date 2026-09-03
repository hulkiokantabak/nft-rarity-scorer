import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, abortableDelay, retryDelay, nextPage, fetchNFTBatches } from '../api.js';
import { createKeyStore } from '../storage.js';
const response = (status, data = {}, headers = {}) => new Response(JSON.stringify(data), { status, headers });
const memory = () => { const data = new Map(); return { getItem: k => data.get(k), setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) }; };

test('rate limits honor retry and reset headers', () => {
  assert.equal(retryDelay(new Headers({ 'Retry-After': '12', 'X-RateLimit-Reset': '20' }), 0, 10000), 12000);
});
test('queued client observes cooldown after final 429', async () => {
  let now = 10000, calls = 0; const waits = [];
  const api = createApiClient({ now: () => now, wait: async ms => { waits.push(ms); now += ms; }, fetchImpl: async () => ++calls === 1 ? response(429, {}, { 'Retry-After': '9' }) : response(200, { ok: true }) });
  await assert.rejects(api('/api/v2/test', 'test-only', { retries: 0 }), /rate limit/);
  assert.deepEqual(await api('/api/v2/test', 'test-only'), { ok: true });
  assert.deepEqual(waits, [9000]);
});
test('successful exhausted quota delays next request', async () => {
  let now = 10000; const waits = [];
  const api = createApiClient({ now: () => now, wait: async ms => { waits.push(ms); now += ms; }, fetchImpl: async () => response(200, {}, { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '15' }) });
  await api('/one', 'test'); await api('/two', 'test'); assert.deepEqual(waits, [5000]);
});
test('foreign origins never receive API keys', async () => {
  const api = createApiClient({ fetchImpl: () => { throw new Error('must not fetch'); } });
  await assert.rejects(api('https://example.com', 'secret'), /only be sent to OpenSea/);
});
test('server errors do not wait until quota reset when quota remains', async () => {
  let now = 10000, count = 0; const waits = [];
  const api = createApiClient({ now: () => now, wait: async ms => { waits.push(ms); now += ms; }, fetchImpl: async () => ++count === 1 ? response(503, {}, { 'X-RateLimit-Remaining': '599', 'X-RateLimit-Reset': '3610' }) : response(200) });
  await api('/test', 'fake'); assert.deepEqual(waits, [1000]);
});
test('cancel interrupts retry waits immediately', async () => {
  const controller = new AbortController(), pending = abortableDelay(60000, controller.signal);
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
});
test('pagination encodes cursors and rejects repetition', () => {
  const seen = new Set(); assert.equal(nextPage('/path?limit=200', 'a&b=1', seen), '/path?limit=200&next=a%26b%3D1');
  assert.throws(() => nextPage('/path?limit=200', 'a&b=1', seen), /repeated/);
});
test('batch matches identity not position and retains missing items as unavailable', async () => {
  const items = ['0', '1', '2'].map(tokenId => ({ tokenId, contractAddress: '0xabc', chain: 'ethereum' }));
  const request = async (url, key, options) => {
    assert.equal(url, '/api/v2/nfts/batch'); assert.equal(options.body.identifiers[0].token_id, '0');
    return { nfts: [{ identifier: '2', contract: '0xabc', name: 'Two', traits: [] }, { identifier: '0', contract: '0xabc', name: 'Zero', traits: [] }] };
  };
  const result = await fetchNFTBatches(items, request, 'fake');
  assert.equal(result[0].name, 'Zero'); assert.equal(result[1].metadataUnavailable, true); assert.equal(result[1].traitsKnown, false); assert.equal(result[2].name, 'Two');
});
test('batch separates chain contexts for identical contracts', async () => {
  const chains = []; const items = ['ethereum', 'base'].map(chain => ({ chain, contractAddress: '0xabc', tokenId: '0' }));
  const result = await fetchNFTBatches(items, async (url, key, { body }) => { chains.push(body.identifiers[0].chain); return { nfts: [{ identifier: '0', contract: '0xabc', traits: [] }] }; }, 'fake');
  assert.deepEqual(chains, ['ethereum', 'base']); assert.deepEqual(result.map(i => i.chain), chains);
});
test('key storage defaults to session and migrates old automatic persistence', () => {
  const session = memory(), persistent = memory(); persistent.setItem('opensea_api_key', 'legacy');
  const keys = createKeyStore(session, persistent); assert.equal(keys.load().key, 'legacy');
  assert.equal(persistent.getItem('opensea_api_key'), undefined); assert.equal(session.getItem('opensea_api_key'), 'legacy');
  keys.save('new'); assert.equal(session.getItem('opensea_api_key'), 'new'); assert.equal(persistent.getItem('opensea_api_key'), undefined);
});
test('remember is explicit and clear removes every copy', () => {
  const session = memory(), persistent = memory(), keys = createKeyStore(session, persistent);
  keys.save('remembered', true); assert.equal(persistent.getItem('opensea_api_key'), 'remembered');
  assert.equal(createKeyStore(session, persistent).load().remembered, true);
  keys.clear(); assert.equal(keys.get(), ''); assert.equal(persistent.getItem('opensea_api_key'), undefined); assert.equal(session.getItem('opensea_api_key'), undefined);
});
test('blocked browser storage falls back to memory', () => {
  const denied = { getItem() { throw new Error(); }, setItem() { throw new Error(); }, removeItem() { throw new Error(); } };
  const keys = createKeyStore(denied, denied); keys.load(); assert.equal(keys.save('memory'), 'memory'); assert.equal(keys.get(), 'memory');
});

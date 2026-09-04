import test from 'node:test';
import assert from 'node:assert/strict';
import { ARTBLOCKS_ENDPOINT, ARTBLOCKS_CHAINS, createArtBlocksClient, fetchArtBlocksCatalog, fetchArtBlocksPortfolio, projectIdentity, normalizeArtBlocksToken, artBlocksTraitCounts } from '../artblocks.js';
import { scoreNFT, traitKey, buildMissingCountByType } from '../core.js';
import { OWNER, V0, V1, FLEX, FAKE, registry, project, token, makeFixture } from '../fixtures/artblocks.js';

const config = { tiers: [{ threshold: 2, points: 7, name: 'Rare' }, { threshold: 5, points: 3, name: 'Uncommon' }, { threshold: 20, points: 1, name: 'Scarce' }], weights: {}, scoreMissing: false, scorePairs: false, missingBonus: 1.5 };
const scored = (p, t = token(p), settings = config) => scoreNFT(normalizeArtBlocksToken(t, p), artBlocksTraitCounts(p), Number(p.invocations), settings, null);

test('client posts only to official origin without API key or cookies', async () => {
  let seen;
  const request = createArtBlocksClient({ fetchImpl: async (url, options) => { seen = { url, options }; return Response.json({ data: { ok: true } }); } });
  assert.deepEqual(await request('query Test', { owner: OWNER }), { ok: true });
  assert.equal(seen.url, ARTBLOCKS_ENDPOINT); assert.equal(seen.options.credentials, 'omit');
  assert.equal(seen.options.redirect, 'error');
  assert.deepEqual(Object.keys(seen.options.headers).sort(), ['Accept', 'Content-Type']);
  assert.deepEqual(JSON.parse(seen.options.body), { query: 'query Test', variables: { owner: OWNER } });
});

test('client rejects GraphQL partial errors without reflecting upstream details', async () => {
  const request = createArtBlocksClient({ fetchImpl: async () => Response.json({ data: { partial: true }, errors: [{ message: 'private-data' }] }) });
  await assert.rejects(request('x', {}), e => /incomplete data/.test(e.message) && !e.message.includes('private-data'));
});

test('client respects bounded retries and cancellation', async () => {
  const waits = []; let tries = 0;
  const request = createArtBlocksClient({ wait: async ms => waits.push(ms), fetchImpl: async () => ++tries < 3 ? new Response('', { status: 429, headers: { 'Retry-After': '2' } }) : Response.json({ data: {} }) });
  await request('x', {}); assert.equal(tries, 3); assert.deepEqual(waits, [2000, 2000]);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(request('x', {}, controller.signal), { name: 'AbortError' }); assert.equal(tries, 3);
  const long = createArtBlocksClient({ wait: async () => assert.fail('Must not retry early'), fetchImpl: async () => new Response('', { status: 429, headers: { 'Retry-After': '90' } }) });
  await assert.rejects(long('x', {}), /429/);
});

test('identity uses exact chain, contract and BigInt project arithmetic', () => {
  assert.deepEqual(projectIdentity(1, V1.toUpperCase(), '78000000'), { id: `${V1}-78`, projectId: '78', key: `1:${V1}-78` });
  assert.equal(projectIdentity(1, V1, '9007199254740993123456').projectId, '9007199254740993');
  for (const id of ['-1', '1e6', '0x10', '01', 'NaN']) assert.equal(projectIdentity(1, V1, id), null);
  assert.equal(projectIdentity(5, V1, '1'), null); assert.equal(projectIdentity(1, 'Art Blocks', '1'), null);
});

test('catalog includes legacy V0/V1 and independently branded Flex on all four chains', async () => {
  const f = makeFixture({ pageSize: 1 }); const catalog = await fetchArtBlocksCatalog(f.request);
  assert.equal(catalog.contracts.size, registry.length);
  assert.equal(catalog.contracts.get(`1:${V0}`).core_version, null);
  assert.equal(catalog.contracts.get(`1:${FLEX}`).is_artblocks, false);
  assert.deepEqual([...catalog.counts.keys()], ARTBLOCKS_CHAINS.map(c => c.id));
  assert.ok(f.calls.filter(c => c.query.includes('ArtBlocksContracts') && c.variables.chain === 1).length > 1);
});

test('catalog fails closed for missing legacy, truncated and repeated pages', async () => {
  await assert.rejects(fetchArtBlocksCatalog(makeFixture({ registry: registry.filter(c => c.address !== V0) }).request), /legacy/);
  await assert.rejects(fetchArtBlocksCatalog(async () => ({ contracts_metadata: [], contracts_metadata_aggregate: { aggregate: { count: 2 } } })), /truncated/);
  await assert.rejects(fetchArtBlocksCatalog(async () => ({ contracts_metadata: [registry[0]], contracts_metadata_aggregate: { aggregate: { count: 2 } } })), /repeated page/);
});

test('shared core projects use separate frequencies and denominators, not wallet counts', async () => {
  const a = project(V1, 1), b = project(V1, 2, 1, { invocations: 10 });
  const result = await fetchArtBlocksPortfolio(OWNER, makeFixture({ projects: [a, b] }).request);
  assert.equal(result.projects.size, 2); assert.equal(result.tokens.length, 2);
  assert.equal(scored(a).totalScore, 7); assert.equal(scored(b).totalScore, 1);
  assert.equal(scored(a).mainTraits[0].pct, '1.00'); assert.equal(scored(b).mainTraits[0].pct, '10.00');
  assert.notEqual(normalizeArtBlocksToken(token(a), a).collectionSlug, normalizeArtBlocksToken(token(b), b).collectionSlug);
});

test('noncatalog impersonators, wrong owner and wrong project never enter scoring', async () => {
  const p = project(); const fake = project(FAKE, 0, 1, { name: 'Art Blocks Curated', opensea_slug: 'art-blocks' });
  const rows = [token(p), token(fake), token(p, 1, { owner_address: FAKE }), token(p, 2, { project_id: `${V1}-99` })];
  const result = await fetchArtBlocksPortfolio(OWNER, makeFixture({ projects: [p, fake], tokens: rows }).request);
  assert.equal(result.tokens.length, 1); assert.equal(result.rejected, 3); assert.equal(result.partial, true);
});

test('the same contract/token on different verified chains remains distinct', async () => {
  const projects = [project(FLEX, 1, 1), project(FLEX, 1, 8453)];
  const result = await fetchArtBlocksPortfolio(OWNER, makeFixture({ projects }).request);
  assert.equal(result.tokens.length, 2); assert.equal(result.projects.size, 2);
  const wrong = project(V1, 1, 8453); // V1 address is indexed on Ethereum only.
  const excluded = await fetchArtBlocksPortfolio(OWNER, makeFixture({ projects: [wrong] }).request);
  assert.equal(excluded.tokens.length, 0); assert.equal(excluded.rejected, 1);
});

test('short holdings pages continue and more than 25 projects are included', async () => {
  const projects = Array.from({ length: 31 }, (_, i) => project(V1, i));
  const f = makeFixture({ projects, pageSize: 3 }); const result = await fetchArtBlocksPortfolio(OWNER, f.request);
  assert.equal(result.tokens.length, 31); assert.equal(result.projects.size, 31); assert.equal(result.partial, false);
  assert.equal(f.calls.filter(c => c.query.includes('ArtBlocksProjects')).length, 2);
  assert.ok(f.calls.filter(c => c.query.includes('ArtBlocksHoldings')).length > 10);
});

test('numeric/boolean scalar features score from exact counts; nested values are not invented', () => {
  const p = project(V1, 1, 1, { features: { features_generating: false, feature_value_counts: { Color: { Gold: 1 }, Level: { 2: 1 }, Flag: { false: 1 } } } });
  const t = token(p, 0, { features: { Color: 'Gold', Level: 2, Flag: false, Empty: '', Null: null } });
  assert.equal(scored(p, t).totalScore, 21); assert.equal(scored(p, t).coverage, 1);
  const invalid = normalizeArtBlocksToken(token(p, 0, { features: { Color: ['Gold'], Other: {} } }), p);
  assert.equal(invalid.traitsKnown, true); assert.equal(invalid.unsupportedFeatures, 2);
  assert.ok(invalid.traits.every(t => t.frequencyUnavailable && t.value === '[Unsupported feature data]'));
  assert.equal(normalizeArtBlocksToken(token(p, 0, { media_url: 'javascript:evil()' }), p).image, '');
});

test('unsupported fields never turn measured common scalar siblings into assumed rarity', () => {
  const p = project(V1, 1, 1, { features: { features_generating: false, feature_value_counts: { Color: { Blue: 100 } } } });
  const t = token(p, 0, { features: { Color: 'Blue', Extra: ['x'] } });
  const result = scored(p, t, { ...config, scoreMissing: true });
  assert.equal(result.mainTraits[0].status, 'known'); assert.equal(result.mainTraits[0].points, 0);
  assert.equal(result.mainTraits[1].status, 'assumed'); assert.equal(result.totalScore, 7); assert.equal(result.coverage, 0.5);
  assert.equal(scored(p, t).totalScore, 0); assert.equal(scored(p, t).coverage, 0.5);
});

test('generating or missing aggregates cannot masquerade as measured rarity', () => {
  const p = project(); p.features.features_generating = true;
  assert.equal(scored(p).scoringMethod, 'Unscored'); assert.equal(scored(p).coverage, 0);
  const assumed = scored(p, token(p), { ...config, scoreMissing: true });
  assert.equal(assumed.totalScore, 7); assert.equal(assumed.mainTraits[0].status, 'assumed');
  assert.equal(assumed.mainTraits[0].count, null); assert.equal(assumed.mainTraits[0].pct, 'N/A');
  delete p.features; assert.equal(scored(p).scoringMethod, 'Unscored');
});

test('missing opt-in preserves rare points without fabricated measured absence', () => {
  const p = project(); const t = token(p, 0, { features: { Level: 2 } });
  const counts = artBlocksTraitCounts(p);
  assert.equal(counts[traitKey('Color', 'Gold')], 1);
  assert.deepEqual(Object.keys(buildMissingCountByType(counts, 100)), []);
  assert.equal(scored(p, t).totalScore, 0);
  const result = scored(p, t, { ...config, scoreMissing: true });
  assert.equal(result.totalScore, 18); assert.equal(result.assumedPoints, 18); assert.equal(result.coverage, 0);
  assert.equal(result.pairsAvailable, false);
});

test('unavailable project data is retained as unscored, not replaced by other cohorts', async () => {
  const f = makeFixture({ fail: query => query.includes('ArtBlocksProjects') });
  const result = await fetchArtBlocksPortfolio(OWNER, f.request);
  assert.equal(result.tokens.length, 3); assert.equal(result.partial, true);
  for (const p of result.projects.values()) assert.equal(scored(p).scoringMethod, 'Unscored');
});

test('caps, partial chain failures, catalog failures and cancellation are explicit', async () => {
  const limited = await fetchArtBlocksPortfolio(OWNER, makeFixture().request, { maxItems: 2 });
  assert.equal(limited.tokens.length, 2); assert.equal(limited.partial, true); assert.match(limited.warnings.join(), /Stopped at 2/);
  const f = makeFixture({ fail: (query, v) => query.includes('ArtBlocksHoldings') && v.chain === 8453 });
  const partial = await fetchArtBlocksPortfolio(OWNER, f.request);
  assert.equal(partial.tokens.length, 3); assert.match(partial.warnings.join(), /Base/);
  const failed = makeFixture({ fail: query => query.includes('ArtBlocksContracts') });
  await assert.rejects(fetchArtBlocksPortfolio(OWNER, failed.request));
  assert.equal(failed.calls.some(c => c.query.includes('ArtBlocksHoldings')), false);
  const controller = new AbortController();
  const cancelled = makeFixture({ controller, cancelOn: 'ArtBlocksHoldings' });
  await assert.rejects(fetchArtBlocksPortfolio(OWNER, cancelled.request, { signal: controller.signal }), { name: 'AbortError' });
});

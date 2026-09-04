import test from 'node:test';
import assert from 'node:assert/strict';
import { rankScores, assignHeldRanks, openSeaRanking, summarizeHoldings, summarizeProjects, projectRanksForHoldings, rankText } from '../rankings.js';
import { itemKey, scoreNFT } from '../core.js';
import { fetchOpenSeaRarities } from '../api.js';
import { fetchArtBlocksProjectPopulation, normalizeArtBlocksToken, artBlocksTraitCounts } from '../artblocks.js';
import { V1, FLEX, project, token, makeFixture } from '../fixtures/artblocks.js';
const item = (id, score, extra = {}) => ({ chain: 'ethereum', contractAddress: V1, tokenId: String(id), totalScore: score,
  collectionSlug: 'a', collectionName: 'A', totalSupply: 100, scoringMethod: 'Custom tiers', mainTraits: [], specialTraits: [], ...extra });
const config = { tiers: [{ threshold: 2, points: 7, name: 'Rare' }, { threshold: 5, points: 3, name: 'Uncommon' }, { threshold: 20, points: 1, name: 'Scarce' }], weights: {}, scoreMissing: false, scorePairs: false };

test('competition ranks preserve ties, zero scores and complete tie intervals', () => {
  const rows = [item(1, 10), item(2, 10), item(3, 5), item(4, 0, { scoringMethod: 'Unscored' })];
  const ranks = rankScores(rows, 'held');
  assert.equal(ranks.size, 3);
  assert.deepEqual([ranks.get(itemKey(rows[0])).rank, ranks.get(itemKey(rows[0])).rankEnd], [1, 2]);
  assert.equal(ranks.get(itemKey(rows[2])).rank, 3);
  assert.match(rankText(ranks.get(itemKey(rows[0]))), /#1–2 \/ 3 · Top 33.3333–66.6667%/);
  const tied = rankScores([item(1, 0), item(2, 0)], 'held').get(itemKey(item(1, 0)));
  assert.equal(tied.topHigh, 100); assert.equal(tied.rankEnd, 2);
  assert.equal(rankScores([item(1, 0)], 'held').get(itemKey(item(1, 0))).topLow, 100);
});

test('held ranks keep projects/chains separate and summary sums are additive', () => {
  const rows = [item(1, 10), item(2, 5, { assumedPoints: 5 }), item(3, 40, { chain: 'base', collectionSlug: 'b', collectionName: 'B' }), item(4, 0, { scoringMethod: 'Unscored' })];
  assignHeldRanks(rows);
  assert.equal(rows[0].heldScoreRank.rank, 2); assert.equal(rows[0].heldProjectRank.rank, 1);
  assert.equal(rows[2].heldProjectRank.total, 1); assert.equal(rows[3].heldScoreRank, null);
  const total = summarizeHoldings(rows), projects = summarizeProjects(rows);
  assert.equal(total.totalScore, 55); assert.equal(total.assumedPoints, 5); assert.equal(total.scored, 3);
  assert.equal(projects.reduce((n, p) => n + p.totalScore, 0), total.totalScore);
  assert.equal(projects[0].average, 7.5);
});

test('OpenSea percentage uses matching rarity population, never project/general supply', () => {
  const nft = { rank: 4, strategy_id: 'openrarity', strategy_version: '1' };
  const collection = { collection: 'os-collection', total_supply: 999, rarity: { total_supply: 200, max_rank: 198, strategy_id: 'openrarity', strategy_version: '1', calculated_at: '2026-09-04' } };
  const rank = openSeaRanking(nft, collection, 'os-collection');
  assert.equal(rank.total, 200); assert.equal(rank.topLow, 2); assert.equal(rank.scope, 'os-collection');
  for (const invalid of [null, { rarity: { ...collection.rarity, strategy_version: '2' } }, { rarity: { ...collection.rarity, max_rank: 201 } }, { rarity: { ...collection.rarity, total_supply: 2 } }]) {
    const result = openSeaRanking(nft, invalid && { ...invalid, collection: 'os-collection' }, 'os-collection'); assert.equal(result.rank, 4); assert.equal(result.total, null); assert.equal(result.topLow, null); assert.equal(result.calculatedAt, null);
  }
  assert.equal(openSeaRanking({ rank: 0 }, collection), null);
  assert.equal(openSeaRanking({ rank: 4 }, collection).total, null);
  assert.equal(openSeaRanking(nft, { ...collection, collection: 'wrong' }, 'os-collection').total, null);
});

test('rank-only OpenSea batch joins identities across chains and never changes traits', async () => {
  const rows = [item(1, 7, { traits: [{ type: 'Color', value: 'Gold' }] }), item(1, 7, { chain: 'base' })];
  const calls = [];
  const request = async (url, key, options) => {
    calls.push({ url, key, options });
    if (url.includes('/nfts/batch')) return { nfts: [{ contract: V1, identifier: '1', collection: 'os-project', rarity: { rank: options.body.identifiers[0].chain === 'base' ? 2 : 1 }, traits: [] }, { contract: FLEX, identifier: '1', rarity: { rank: 999 } }] };
    return { collection: 'os-project', rarity: { total_supply: 100 } };
  };
  const result = await fetchOpenSeaRarities(rows, request, 'synthetic-key');
  assert.equal(result.records.size, 2); assert.equal(result.records.get(itemKey(rows[0])).rarity.rank, 1);
  assert.equal(result.records.get(itemKey(rows[1])).rarity.rank, 2);
  assert.equal(calls.filter(c => c.url.includes('/collections/')).length, 1);
  assert.equal(rows[0].totalScore, 7); assert.equal(rows[0].traits[0].value, 'Gold');
});

test('OpenSea failure retains scores and abort cannot publish enrichment', async () => {
  const rows = [item(1, 7)];
  const failed = await fetchOpenSeaRarities(rows, async () => { throw Object.assign(new Error(), { status: 401 }); }, 'test');
  assert.equal(failed.records.size, 0); assert.equal(failed.warnings.length, 1); assert.equal(rows[0].totalScore, 7);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fetchOpenSeaRarities(rows, async () => assert.fail(), 'test', controller.signal), { name: 'AbortError' });
});

test('full-project scan uses all tokens, short pages, stable counts and exact invocation IDs', async () => {
  const p = project(), f = makeFixture({ projects: [p], pageSize: 17 });
  const result = await fetchArtBlocksProjectPopulation(p, f.request);
  assert.equal(result.tokens.length, 100);
  assert.ok(f.calls.filter(c => c.query.includes('ArtBlocksProjectPopulation')).length > 5);
  assert.ok(f.calls.filter(c => c.query.includes('ArtBlocksProjectPopulation')).every(c => !c.query.includes('owner_address')));
  const counts = artBlocksTraitCounts(p), population = result.tokens.map(t => scoreNFT(normalizeArtBlocksToken(t, p), counts, 100, config, null));
  const ranks = projectRanksForHoldings([population[0]], population, 100);
  assert.equal(ranks.get(itemKey(population[0])).rank, 1); assert.equal(ranks.get(itemKey(population[0])).topLow, 1);
});

test('truncated, changing, wrong-identity and over-budget populations withhold full rank', async () => {
  const p = project(V1, 1, 1, { invocations: 3 });
  const valid = [0, 1, 2].map(i => token(p, i));
  for (const population of [valid.slice(0, 2), [valid[0], valid[2], token(p, 3)], [valid[0], { ...valid[1], chain_id: 8453 }, valid[2]]]) {
    await assert.rejects(fetchArtBlocksProjectPopulation(p, makeFixture({ projects: [p], population }).request));
  }
  const options = { projects: [p], population: valid, pageSize: 1 }; const f = makeFixture(options);
  await assert.rejects(fetchArtBlocksProjectPopulation(p, async (q, v, s) => { const data = await f.request(q, v, s); if (q.includes('ArtBlocksProjectPopulation')) options.updatedAt = '2026-09-05'; return data; }), /changed during/);
  await assert.rejects(fetchArtBlocksProjectPopulation(project(V1, 1, 1, { invocations: 20001 }), async () => assert.fail()), /limit/);
  await assert.rejects(fetchArtBlocksProjectPopulation(p, makeFixture({ projects: [{ ...p, invocations: 4 }] }).request), /changed/);
});

test('full rank refuses unresolved scores and changed held scores; assumptions are labelled', () => {
  const a = item(1, 7), b = item(2, 0);
  assert.throws(() => projectRanksForHoldings([a], [a], 2), /unresolved/);
  assert.throws(() => projectRanksForHoldings([a], [a, { ...b, mainTraits: [{ status: 'unknown' }] }], 2), /unresolved/);
  assert.throws(() => projectRanksForHoldings([{ ...a, totalScore: 8 }], [a, b], 2), /changed/);
  assert.throws(() => projectRanksForHoldings([{ ...b, scoringMethod: 'Unscored' }], [a, b], 2), /unresolved/);
  assert.throws(() => projectRanksForHoldings([{ ...a, mainTraits: [{ type: 'Color', value: 'Gold', status: 'assumed', points: 7 }] }], [a, b], 2), /changed/);
  const result = projectRanksForHoldings([a], [a, { ...b, assumedTraits: 1 }], 2).get(itemKey(a));
  assert.equal(result.assumedPopulation, 1); assert.match(rankText(result), /includes assumptions/);
});

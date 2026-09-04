import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreArtBlocksPopulation, normalizeArtBlocksToken, artBlocksTraitCounts } from '../artblocks.js';
import { countTraits, buildPairCounts, traitKey, scoreNFT, itemKey } from '../core.js';
import { projectRanksForHoldings } from '../rankings.js';
import { bonusFixture, project, token } from '../fixtures/artblocks.js';

const config = { tiers: [{ name: 'rare', threshold: 2, points: 7 }, { name: 'uncommon', threshold: 5, points: 3 }, { name: 'scarce', threshold: 20, points: 1 }], weights: {}, scoreMissing: false, scorePairs: false, missingBonus: 1.5, comboBonus: 2 };

test('complete project baseline forces both bonuses, preserves official distributions and measures absence', async () => {
  const f = bonusFixture(), p = f.projects[0];
  const scored = await scoreArtBlocksPopulation(f.population, p, config);
  assert.equal(scored.population[0].totalScore, 25); assert.equal(scored.population[99].totalScore, 14);
  assert.ok(scored.population.slice(1, 99).every(i => i.totalScore === 0));
  assert.equal(scored.counts._meta.present.C, 99); assert.equal(scored.pairs._meta.population, 100);
  assert.equal(scored.config.scoreMissing, true); assert.equal(scored.config.scorePairs, true);
  assert.deepEqual(Object.entries(scored.counts), Object.entries(artBlocksTraitCounts(p)));
  const ranks = projectRanksForHoldings([scored.population[0]], scored.population, 100);
  assert.deepEqual([ranks.get(itemKey(scored.population[0])).rank, ranks.get(itemKey(scored.population[0])).total], [1, 100]);
});

test('unsupported fields cannot establish measured absence or pairs; scalar siblings remain measured', async () => {
  const p = project(), raw = Array.from({ length: 100 }, (_, i) => token(p, i, { features: { Color: i ? 'Blue' : 'Gold', ...(i ? {} : { Broken: ['not scalar'] }) } }));
  const items = raw.map(t => normalizeArtBlocksToken(t, p));
  const counts = countTraits(items, 100), pairs = buildPairCounts(items, 100);
  assert.equal(counts._meta.complete, false); assert.equal(pairs._meta.complete, false);
  assert.equal(counts[traitKey('Broken', '[Unsupported feature data]')], undefined);
  assert.equal(Object.keys(pairs).length, 0);
  const base = scoreNFT(items[0], artBlocksTraitCounts(p), 100, { ...config, scoreMissing: true }, null);
  assert.equal(base.mainTraits.find(t => t.type === 'Color').status, 'known');
  await assert.rejects(scoreArtBlocksPopulation(raw, p, config), /complete supported project features/);
});

test('incomplete or unavailable metadata and generating aggregates cannot publish requested project scoring', async () => {
  const f = bonusFixture(), p = f.projects[0];
  for (const raw of [f.population.slice(1), f.population.map((t, i) => i ? t : { ...t, features: null })]) {
    await assert.rejects(scoreArtBlocksPopulation(raw, p, config), /complete supported/);
  }
  await assert.rejects(scoreArtBlocksPopulation(f.population, { ...p, features: { ...p.features, features_generating: true } }, config), /complete supported/);
});

test('pair-work safety cap and cancellation stop project scoring before publication', async () => {
  const f = bonusFixture();
  await assert.rejects(scoreArtBlocksPopulation(f.population, f.projects[0], config, { maxPairWork: 0 }), /safety limit/);
  const controller = new AbortController();
  const pending = scoreArtBlocksPopulation(f.population, f.projects[0], config, { signal: controller.signal });
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
});

test('equal-frequency pair selection and rank evidence are invariant to feature order', async () => {
  const p = project(undefined, 1, 1, { features: { features_generating: false, feature_value_counts: Object.fromEntries(['A', 'B', 'C', 'D'].map(k => [k, { Rare: 1, Common: 99 }])) } });
  const raw = Array.from({ length: 100 }, (_, i) => token(p, i, { features: Object.fromEntries(['A', 'B', 'C', 'D'].map(k => [k, i ? 'Common' : 'Rare'])) }));
  const { population, counts, pairs, config: applied } = await scoreArtBlocksPopulation(raw, p, config);
  const held = scoreNFT({ ...population[0], traits: [...population[0].traits].reverse() }, counts, 100, applied, pairs);
  assert.equal(held.totalScore, 70); assert.equal(held.pairScores.length, 3);
  assert.equal(projectRanksForHoldings([held], population, 100).get(itemKey(held)).rank, 1);
});

test('full metadata adds wholly missing types but does not splice values into official distributions', async () => {
  const f = bonusFixture(), p = f.projects[0];
  const altered = { ...p, features: { ...p.features, feature_value_counts: { A: { red: 49, blue: 51 }, B: { round: 50, square: 50 } } } };
  const { counts } = await scoreArtBlocksPopulation(f.population, altered, config);
  assert.equal(counts[traitKey('A', 'red')], 49); assert.equal(counts[traitKey('C', 'true')], 99);
  assert.match(counts._meta.source, /Art Blocks.*additional/); assert.doesNotMatch(counts._meta.source, /OpenSea/);
});

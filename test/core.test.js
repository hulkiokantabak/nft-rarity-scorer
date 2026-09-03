import test from 'node:test';
import assert from 'node:assert/strict';
import { numberSetting, validateTiers, parseTraitCounts, countTraits, buildTraitTypes, buildPairCounts, buildMissingCountByType, scoreNFT, itemKey, listingAsset, parsePrice, normalizeNFT, addValueMetrics, configFingerprint, traitKey } from '../core.js';
import { validateConfig } from '../config.js';

const tiers = [2, 5, 20].map((threshold, i) => ({ name: ['orange', 'purple', 'blue'][i], color: '#3498db', threshold, points: [7, 3, 1][i] }));
const config = { tiers, weights: new Map(), scoreMissing: false, scorePairs: false, missingBonus: 1.5, comboBonus: 2 };
const counts = parseTraitCounts({ categories: { Color: 'string', Level: 'number' }, counts: { Color: { gold: 1, purple: 2, blue: 5, grey: 20 }, Level: { min: 1, max: 99 } } }, 100);
const nft = (value = 'gold', extra = {}) => ({ chain: 'ethereum', contractAddress: '0xabc', tokenId: '0', traitsKnown: true, traits: [{ type: 'Color', value }], ...extra });
const price = (value, decimals) => ({ price: { current: { value, decimals, currency: 'ETH' } } });

test('exclusive rarity boundaries and known common zero', () => {
  assert.deepEqual(['gold', 'purple', 'blue', 'grey'].map(v => scoreNFT(nft(v), counts, 100, config).totalScore), [7, 3, 1, 0]);
  assert.equal(scoreNFT(nft('grey'), counts, 100, config).scoringMethod, 'Custom tiers');
});
test('zero points, weights and bonuses are preserved', () => {
  assert.equal(numberSetting('0', 7), 0);
  assert.equal(scoreNFT(nft(), counts, 100, { ...config, weights: new Map([['Color', 0]]) }).totalScore, 0);
  assert.equal(scoreNFT(nft(), counts, 100, { ...config, tiers: tiers.map(t => ({ ...t, points: 0 })) }).totalScore, 0);
});
test('invalid settings are rejected, not silently defaulted', () => {
  for (const value of ['NaN', 'Infinity', -1, 1001]) assert.throws(() => numberSetting(value, 1));
  assert.equal(numberSetting('', 7), 7);
  assert.throws(() => validateTiers([tiers[0], { ...tiers[1], name: 'orange' }]));
  assert.throws(() => validateTiers([{ ...tiers[0], name: 'common' }]));
  assert.throws(() => validateTiers([tiers[1], tiers[0]]));
});
test('unknown frequency never earns rare points', () => {
  const result = scoreNFT(nft('not returned'), counts, 100, config);
  assert.equal(result.totalScore, 0); assert.equal(result.scoringMethod, 'Unscored');
  assert.equal(result.mainTraits[0].status, 'unknown'); assert.equal(result.coverage, 0);
});
test('invalid counts and invalid population are unscored', () => {
  for (const count of [0, -1, NaN, 101, 1.5]) {
    const invalid = { [traitKey('Color', 'gold')]: count };
    assert.equal(scoreNFT(nft(), invalid, 100, config).scoringMethod, 'Unscored');
  }
  for (const supply of [0, -1, NaN, 1.5]) assert.equal(scoreNFT(nft(), counts, supply, config).scoringMethod, 'Unscored');
});
test('numeric min/max and underscore traits are excluded', () => {
  assert.deepEqual([...buildTraitTypes(counts)], ['Color']);
  const result = scoreNFT(nft('gold', { traits: [{ type: 'Level', value: '7', numeric: true }, { type: '_internal', value: 'x' }] }), counts, 100, config);
  assert.equal(result.totalScore, 0); assert.equal(result.mainTraits[0].status, 'excluded');
});
test('duplicate traits cannot increase score or occurrence counts', () => {
  const item = nft(); item.traits.push({ ...item.traits[0] });
  assert.equal(scoreNFT(item, counts, 100, config).totalScore, 7);
  assert.equal(countTraits([item], 1)[traitKey('Color', 'gold')], 1);
  assert.equal(Object.keys(buildPairCounts([item], 1)).length, 0);
});
test('structured trait keys do not collide on delimiters', () => {
  assert.notEqual(traitKey('a::b', 'c'), traitKey('a', 'b::c'));
  const c = countTraits([nft('x', { traits: [{ type: 'a::b', value: 'c||d' }] })]);
  assert.deepEqual([...buildTraitTypes(c)], ['a::b']);
});
test('missing scoring requires complete per-token presence', () => {
  const items = Array.from({ length: 100 }, (_, i) => nft('gold', { tokenId: String(i), traits: i === 0 ? [] : [{ type: 'Color', value: 'gold' }] }));
  const full = countTraits(items, 100);
  assert.equal(buildMissingCountByType(full, 100).Color, 1);
  assert.equal(scoreNFT(items[0], full, 100, { ...config, scoreMissing: true }).totalScore, 11);
  assert.equal(scoreNFT(items[0], full, 100, { ...config, scoreMissing: true, missingBonus: 0 }).totalScore, 0);
  assert.equal(scoreNFT(items[0], counts, 100, { ...config, scoreMissing: true }).totalScore, 0);
});
test('omitted NFT metadata is not evidence of missing traits', () => {
  const items = Array.from({ length: 100 }, (_, i) => nft('gold', { tokenId: String(i), traits: i ? [{ type: 'Color', value: 'gold' }] : [] }));
  const result = scoreNFT(nft('gold', { traits: [], traitsKnown: false, metadataUnavailable: true }), countTraits(items), 100, { ...config, scoreMissing: true });
  assert.equal(result.totalScore, 0); assert.equal(result.scoringMethod, 'Unscored'); assert.equal(result.coverage, 0);
});
test('subset pair counts never masquerade as collection frequencies', () => {
  const item = nft('gold', { traits: [{ type: 'Color', value: 'gold' }, { type: 'Shape', value: 'star' }] });
  const c = parseTraitCounts({ categories: { Color: 'string', Shape: 'string' }, counts: { Color: { gold: 1 }, Shape: { star: 1 } } }, 100);
  const result = scoreNFT(item, c, 100, { ...config, scorePairs: true }, buildPairCounts([item], 100));
  assert.equal(result.pairScores.length, 0);
});
test('full pair scores obey zero weights and deduplicate tokens', () => {
  const items = Array.from({ length: 100 }, (_, i) => nft(i ? 'blue' : 'gold', { tokenId: String(i), traits: [{ type: 'Color', value: i ? 'blue' : 'gold' }, { type: 'Shape', value: i ? 'circle' : 'star' }] }));
  const c = countTraits(items), pairs = buildPairCounts([...items, items[0]], 100);
  assert.equal(pairs._meta.population, 100);
  assert.equal(scoreNFT(items[0], c, 100, { ...config, scorePairs: true }, pairs).pairScores.length, 1);
  assert.equal(scoreNFT(items[0], c, 100, { ...config, scorePairs: true, weights: new Map([['Color', 0]]) }, pairs).pairScores.length, 0);
});
test('atomic price conversion handles zero and large decimals', () => {
  assert.equal(parsePrice(price('420', 0)), 420);
  assert.equal(parsePrice(price('1230000', 6)), 1.23);
  assert.equal(parsePrice(price('1000000000000000000', 18)), 1);
  assert.equal(parsePrice(price('1', 18)), 1e-18);
  for (const p of [price('NaN', 18), price('-1', 0), price('1', -1), {}, price('1', 1000)]) assert.equal(parsePrice(p), null);
});
test('NFT identity includes chain and contract, preserves non-EVM case', () => {
  assert.notEqual(itemKey(nft()), itemKey(nft('gold', { contractAddress: '0xdef' })));
  assert.notEqual(itemKey(nft()), itemKey(nft('gold', { chain: 'base' })));
  assert.equal(itemKey(nft()), itemKey(nft('gold', { contractAddress: '0xABC' })));
  assert.notEqual(itemKey(nft('gold', { contractAddress: 'AbCd' })), itemKey(nft('gold', { contractAddress: 'abcd' })));
});
test('modern asset fields preserve token zero and identify currency', () => {
  const asset = listingAsset({ ...price('1', 0), chain: 'ethereum', asset: { contract: '0xabc', identifier: '0' } });
  assert.equal(asset.tokenId, '0'); assert.equal(asset.price, 1); assert.equal(asset.priceComparable, true);
});
test('criteria, bundles and quantity listings are rejected', () => {
  const offer = { itemType: 2, token: '0xabc', identifierOrCriteria: '0', startAmount: '1', endAmount: '1' };
  const listing = { ...price('1', 0), chain: 'ethereum', protocol_data: { parameters: { offer: [offer] } } };
  assert.equal(listingAsset(listing).tokenId, '0');
  for (const offers of [[offer, offer], [{ ...offer, itemType: 4 }], [{ ...offer, startAmount: '2' }]]) assert.equal(listingAsset({ ...listing, protocol_data: { parameters: { offer: offers } } }), null);
});
test('numeric metadata keeps its type and original NFT contract', () => {
  const item = normalizeNFT({ identifier: '0', contract: '0xdef', traits: [{ trait_type: 'Level', value: 7 }] }, { chain: 'base', contractAddress: '0xabc' });
  assert.equal(item.contractAddress, '0xdef'); assert.equal(item.traits[0].numeric, true);
});
test('high-score lower-price heuristic does not prefer expensive NFTs', () => {
  const items = [10, 8, 5, 1].map((totalScore, i) => nft('gold', { tokenId: String(i), price: i + 1, currency: 'ETH', totalScore, coverage: 1, scoringMethod: 'Custom tiers' }));
  addValueMetrics(items); assert.equal(items[0].isBargain, true);
  items[0].price = 100; addValueMetrics(items); assert.equal(items[0].isBargain, false);
});
test('ties, currency and coverage constrain value flags', () => {
  const items = Array.from({ length: 4 }, (_, i) => nft('gold', { tokenId: String(i), price: 1, totalScore: 7, currency: 'ETH', coverage: 1, scoringMethod: 'Custom tiers' }));
  addValueMetrics(items); assert.ok(items.every(i => !i.isBargain));
  items[0].totalScore = 99; items[0].currency = 'USDC'; addValueMetrics(items); assert.equal(items[0].isBargain, false);
  items[0].currency = 'ETH'; items[0].coverage = 0.5; addValueMetrics(items); assert.equal(items[0].isBargain, false);
});
test('config fingerprint is order-independent for weights and sensitive to zero', () => {
  assert.equal(configFingerprint({ ...config, weights: new Map([['A', 1], ['B', 0]]) }), configFingerprint({ ...config, weights: new Map([['B', 0], ['A', 1]]) }));
  assert.notEqual(configFingerprint(config), configFingerprint({ ...config, missingBonus: 0 }));
});
test('import validation retains zeros and defaults missing weights to empty', () => {
  const input = { v: 2, standard_tiers: { thresholds: [0, 5, 20], points: [0, 3, 1] }, missing_bonus: 0, combo_bonus: 0 };
  const parsed = validateConfig(input);
  assert.equal(parsed.tiers[0].points, 0); assert.equal(parsed.missing_bonus, 0); assert.equal(parsed.weights.size, 0);
  assert.throws(() => validateConfig({ ...input, trait_weights: { Color: 11 } }));
});

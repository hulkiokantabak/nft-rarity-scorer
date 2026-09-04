// Deterministic, DOM-free scoring. This is a custom heuristic, not OpenRarity.
export const ENGINE_VERSION = '1.3.0';
export const traitKey = (type, value) => JSON.stringify([String(type), String(value)]);
const pairKey = (a, b) => JSON.stringify([a, b].sort());
const validCount = (n, supply) => Number.isInteger(n) && n > 0 && n <= supply;
const uniqueTraits = traits => [...new Map((traits || []).map(t => [traitKey(t.type, t.value), t])).values()];

export function numberSetting(value, fallback, min = 0, max = 1000) {
  const n = value == null || String(value).trim() === '' ? fallback : Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Enter a number from ${min} to ${max}.`);
  return n;
}

export function validateTiers(tiers) {
  if (!tiers.length || tiers.length > 10) throw new Error('Use between 1 and 10 scoring tiers.');
  let previous = -1;
  const names = new Set(['common', 'unknown', 'excluded', '__proto__', 'constructor', 'prototype']);
  return tiers.map(t => {
    const threshold = numberSetting(t.threshold, 0, 0, 100);
    const points = numberSetting(t.points, 0);
    if (threshold <= previous) throw new Error('Tier thresholds must be strictly increasing.');
    previous = threshold;
    const name = String(t.name || 'Tier').trim().slice(0, 20);
    if (names.has(name.toLowerCase())) throw new Error('Tier names must be unique and cannot be common, unknown, or excluded.');
    names.add(name.toLowerCase());
    return { name, color: /^#[\da-f]{6}$/i.test(t.color) ? t.color : '#3498db', threshold, points };
  });
}

function withMeta(counts, meta) {
  Object.defineProperty(counts, '_meta', { value: meta, enumerable: false });
  return counts;
}

export function parseTraitCounts(data, supply) {
  const counts = Object.create(null);
  for (const [type, values] of Object.entries(data?.counts || {})) {
    // API numeric categories contain min/max, not frequency distributions.
    if (data?.categories?.[type] !== 'string') continue;
    if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
    for (const [value, n] of Object.entries(values)) {
      if (validCount(n, supply)) counts[traitKey(type, value)] = n;
    }
  }
  return withMeta(counts, { source: 'OpenSea categorical frequencies', population: supply, complete: true });
}

export function countTraits(items, supply = items.length) {
  const counts = Object.create(null);
  const present = Object.create(null);
  const unique = [...new Map(items.map(i => [itemKey(i), i])).values()];
  for (const item of unique) {
    const seenTypes = new Set();
    for (const t of uniqueTraits(item.traits)) {
      const key = traitKey(t.type, t.value);
      counts[key] = (counts[key] ?? 0) + 1;
      seenTypes.add(t.type);
    }
    for (const type of seenTypes) present[type] = (present[type] ?? 0) + 1;
  }
  const complete = unique.length === supply && unique.every(i => i.traitsKnown !== false && !i.metadataUnavailable);
  return withMeta(counts, { source: 'Full NFT metadata scan', population: unique.length, complete, present });
}

// Keep existing API distributions stable across modes. A full scan supplies
// otherwise unavailable types (including exact numeric values), never a few
// individual values spliced into an existing distribution.
export function supplementTraitCounts(primary, scanned, supply) {
  if (!scanned?._meta?.complete || scanned._meta.population !== supply) return primary;
  if (!Object.keys(primary).length) return scanned;
  const counts = Object.assign(Object.create(null), primary);
  const primaryTypes = buildTraitTypes(primary);
  let supplemented = false;
  for (const [key, count] of Object.entries(scanned)) if (!primaryTypes.has(JSON.parse(key)[0])) {
    counts[key] = count; supplemented = true;
  }
  return withMeta(counts, { ...primary._meta, population: supply, complete: true, present: scanned._meta.present,
    source: supplemented ? 'OpenSea frequencies + full-scan additional trait types' : primary._meta.source,
    presenceSource: 'Full NFT metadata scan' });
}

export function needsTraitScan(items, counts) {
  const types = buildTraitTypes(counts);
  return items.some(item => item.traitsKnown !== false && (item.traits || []).some(t => !types.has(t.type)));
}

const typesCache = new WeakMap(), missingCache = new WeakMap();
export function buildTraitTypes(counts) {
  if (!typesCache.has(counts)) typesCache.set(counts, new Set(Object.keys(counts).map(k => JSON.parse(k)[0])));
  return typesCache.get(counts);
}

export function buildMissingCountByType(counts, supply) {
  const cached = missingCache.get(counts);
  if (cached?.supply === supply) return cached.missing;
  const missing = Object.create(null);
  // Value counts cannot establish absence for multi-valued trait types.
  // Only a complete metadata scan has trustworthy per-token presence counts.
  if (!counts._meta?.complete || !counts._meta?.present) return missing;
  for (const type of buildTraitTypes(counts)) {
    const n = counts._meta.present[type] ?? 0;
    if (Number.isInteger(n) && n >= 0 && n <= supply) missing[type] = supply - n;
  }
  missingCache.set(counts, { supply, missing });
  return missing;
}

export function buildPairCounts(items, supply = items.length) {
  const unique = [...new Map(items.map(i => [itemKey(i), i])).values()];
  const counts = Object.create(null);
  for (const item of unique) {
    const traits = uniqueTraits(item.traits).filter(t => !t.type.startsWith('_'));
    for (let i = 0; i < traits.length; i++) for (let j = i + 1; j < traits.length; j++) {
      if (traits[i].type === traits[j].type) continue;
      const k = pairKey(traitKey(traits[i].type, traits[i].value), traitKey(traits[j].type, traits[j].value));
      counts[k] = (counts[k] ?? 0) + 1;
    }
  }
  return withMeta(counts, { population: unique.length, complete: unique.length === supply && unique.every(i => i.traitsKnown !== false && !i.metadataUnavailable) });
}

export function classifyTrait(pct, tiers) {
  const tier = tiers.find(t => pct < t.threshold);
  return tier ? { tier: tier.name, pts: tier.points } : { tier: 'common', pts: 0 };
}

export function scoreNFT(item, counts, supply, config, pairCounts) {
  const tiers = config.tiers;
  const weights = config.weights instanceof Map ? config.weights : new Map(Object.entries(config.weights || {}));
  const traits = uniqueTraits(item.traits);
  const metadataKnown = item.traitsKnown !== false && !item.metadataUnavailable;
  const traitScores = [];
  const score = (type, value, count, bonus = 1, isMissing = false, frequencyUnavailable = false) => {
    const validSupply = Number.isInteger(supply) && supply > 0;
    const known = !frequencyUnavailable && metadataKnown && validSupply && validCount(count, supply) && counts._meta?.complete !== false;
    // Explicit opt-in: unavailable data may receive the rarest nonempty band,
    // but must never be represented as a measured 0% frequency.
    const assumed = !known && validSupply && config.scoreMissing === true;
    const pct = known ? count / supply * 100 : null;
    const { tier, pts } = known || assumed ? classifyTrait(known ? pct : 0, tiers) : { tier: 'unknown', pts: 0 };
    const weight = numberSetting(weights.get(type), 1, 0, 10);
    traitScores.push({ type, value, count: known ? count : null, pct: known ? pct.toFixed(2) : 'N/A', tier, points: Math.round(pts * weight * bonus), status: known ? 'known' : assumed ? 'assumed' : 'unknown', isMissing });
  };
  for (const t of traits) score(t.type, t.value, counts[traitKey(t.type, t.value)], 1, false, t.frequencyUnavailable === true);
  const missingCounts = buildMissingCountByType(counts, supply);
  if (config.scoreMissing) for (const type of buildTraitTypes(counts)) {
    if (!type.startsWith('_') && !traits.some(t => t.type === type)) score(type, '[None]', missingCounts[type], numberSetting(config.missingBonus, 1.5, 0, 10), true);
  }
  let pairScores = [];
  if (config.scorePairs && metadataKnown && pairCounts?._meta?.complete && pairCounts._meta.population === supply) {
    const eligible = traits.filter(t => !t.frequencyUnavailable && !t.type.startsWith('_') && numberSetting(weights.get(t.type), 1, 0, 10) > 0 && validCount(counts[traitKey(t.type, t.value)], supply));
    for (let i = 0; i < eligible.length; i++) for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i], b = eligible[j];
      if (a.type === b.type) continue;
      const count = pairCounts[pairKey(traitKey(a.type, a.value), traitKey(b.type, b.value))];
      if (!validCount(count, supply)) continue;
      const pct = count / supply * 100;
      const { tier, pts } = classifyTrait(pct, tiers);
      // Restore the original independent pair multiplier. A zero trait weight
      // still disables its pairs; positive weights apply to single traits only.
      const points = Math.round(pts * numberSetting(config.comboBonus, 2, 0, 10));
      if (points > 0) pairScores.push({ a, b, count, pct, tier, points });
    }
    pairScores.sort((a, b) => a.pct - b.pct || traitKey(a.a.type, a.a.value).localeCompare(traitKey(b.a.type, b.a.value)));
    pairScores = pairScores.slice(0, 3).map(p => ({ ...p, pct: p.pct.toFixed(2) }));
  }
  const tierCounts = Object.fromEntries(tiers.map(t => [t.name, 0]));
  for (const t of [...traitScores, ...pairScores]) if (Object.hasOwn(tierCounts, t.tier)) tierCounts[t.tier]++;
  const known = traitScores.filter(t => t.status === 'known').length;
  const assumed = traitScores.filter(t => t.status === 'assumed').length;
  return { ...item, rarityRank: item.rarity?.rank, totalSupply: supply,
    totalScore: traitScores.reduce((n, t) => n + t.points, 0) + pairScores.reduce((n, t) => n + t.points, 0),
    tierCounts, mainTraits: traitScores.filter(t => !t.type.startsWith('_')), specialTraits: traitScores.filter(t => t.type.startsWith('_')), pairScores,
    scoringMethod: known || assumed ? 'Custom tiers' : 'Unscored', coverage: metadataKnown && traitScores.length ? known / traitScores.length : 0,
    assumedTraits: assumed, assumedPoints: traitScores.filter(t => t.status === 'assumed').reduce((n, t) => n + t.points, 0),
    unknownTraits: traitScores.length - known, missingAvailable: !!counts._meta?.present && counts._meta.complete,
    pairsAvailable: !!pairCounts?._meta?.complete && pairCounts._meta.population === supply,
    source: [counts._meta?.source || 'Unknown frequencies',
      ...(config.scoreMissing && counts._meta?.presenceSource ? ['Missing frequencies: full metadata scan'] : []),
      ...(config.scorePairs && pairCounts?._meta?.complete && pairCounts._meta.population === supply ? ['Pairs: full metadata scan'] : [])].join('; ') };
}

export function itemKey(item) {
  const contract = String(item.contractAddress || item.contract || '');
  return JSON.stringify([String(item.chain || 'ethereum').toLowerCase(), /^0x[\da-f]+$/i.test(contract) ? contract.toLowerCase() : contract, String(item.tokenId ?? item.identifier)]);
}

export function parsePrice(listing) {
  const price = listing?.price?.current;
  if (!price || !/^\d+$/.test(String(price.value)) || !Number.isInteger(price.decimals) || price.decimals < 0 || price.decimals > 36) return null;
  const str = String(price.value).padStart(price.decimals + 1, '0');
  const result = Number(price.decimals === 0 ? str : `${str.slice(0, -price.decimals)}.${str.slice(-price.decimals)}`);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

export function listingAsset(listing, fallbackChain = null) {
  if (!listing.chain && !fallbackChain) return null;
  if (listing.remaining_quantity != null && listing.remaining_quantity !== 1) return null;
  const offers = listing.protocol_data?.parameters?.offer;
  if (offers && (offers.length !== 1 || ![2, 3].includes(Number(offers[0].itemType)) || (offers[0].startAmount != null && offers[0].startAmount !== '1') || (offers[0].endAmount != null && offers[0].endAmount !== '1'))) return null;
  const offer = offers?.[0];
  const tokenId = listing.asset?.identifier ?? offer?.identifierOrCriteria;
  const contractAddress = listing.asset?.contract ?? offer?.token;
  if (tokenId == null || !contractAddress) return null; // Never assume a collection's first contract.
  const price = parsePrice(listing);
  if (price == null) return null;
  const currency = listing.price?.current?.currency;
  if (!currency) return null;
  const payments = listing.protocol_data?.parameters?.consideration?.filter(c => [0, 1].includes(Number(c.itemType))) || [];
  const paymentTokens = new Set(payments.map(c => Number(c.itemType) === 0 ? 'native' : String(c.token).toLowerCase()));
  if (paymentTokens.size > 1) return null;
  const currencyAddress = [...paymentTokens][0] || (['ETH', 'SOL', 'POL', 'AVAX', 'BNB'].includes(currency) ? 'native' : null);
  const chain = listing.chain || fallbackChain;
  return { tokenId: String(tokenId), contractAddress, chain, price, currency, currencyKey: JSON.stringify([chain, currency, currencyAddress]), priceComparable: !!currencyAddress };
}

export function normalizeNFT(nft, context = {}) {
  // Owner/rank enrichment must not erase or change a known trait population
  // halfway through a run. Missing traits can still be filled by a later batch.
  const keepTraits = Array.isArray(context.traits) && context.traitsKnown !== false && !context.metadataUnavailable;
  const traitsKnown = keepTraits || Array.isArray(nft.traits);
  const traits = keepTraits ? context.traits : (Array.isArray(nft.traits) ? nft.traits : []).map(t => ({ type: String(t.trait_type), value: String(t.value), numeric: typeof t.value === 'number' || ['number', 'boost_number', 'boost_percentage', 'date'].includes(t.display_type) }));
  return { ...context, tokenId: String(nft.identifier), name: nft.name || context.name || `#${nft.identifier}`, image: nft.image_url || nft.display_image_url || context.image || '',
    contractAddress: nft.contract || context.contractAddress, chain: nft.chain || context.chain,
    price: context.price ?? null, currency: context.currency ?? null, rarity: nft.rarity || context.rarity, owner: nft.owners?.[0]?.address || context.owner || null,
    traitsKnown, traits, metadataUnavailable: !traitsKnown };
}

// Midrank percentile is tie-aware and only describes the fetched, same-method cohort.
export function addValueMetrics(items) {
  const groups = new Map();
  for (const i of items) {
    i.valueScore = i.price > 0 && i.priceComparable !== false && i.scoringMethod !== 'Unscored' ? Math.round(i.totalScore / i.price) : null;
    i.isBargain = false;
    const key = JSON.stringify([i.collectionSlug || '', i.chain, i.currencyKey || i.currency, i.scoringMethod]);
    if (!groups.has(key)) groups.set(key, []);
    if (i.price > 0 && i.priceComparable !== false && i.coverage === 1 && i.scoringMethod === 'Custom tiers') groups.get(key).push(i);
  }
  for (const group of groups.values()) {
    if (group.length < 3) continue;
    const percentiles = field => {
      const sorted = group.map(i => i[field]).sort((a, b) => a - b), result = new Map();
      for (let start = 0; start < sorted.length;) {
        let end = start + 1;
        while (end < sorted.length && sorted[end] === sorted[start]) end++;
        result.set(sorted[start], (start + (end - start - 1) / 2) / (sorted.length - 1) * 100);
        start = end;
      }
      return result;
    };
    const scoreRanks = percentiles('totalScore'), priceRanks = percentiles('price');
    for (const i of group) {
      i.scorePercentile = scoreRanks.get(i.totalScore);
      i.pricePercentile = 100 - priceRanks.get(i.price);
      i.isBargain = i.scorePercentile >= 75 && i.pricePercentile >= 50;
    }
  }
  return items;
}

export function configFingerprint(config) {
  // Stable human-readable signature, not a cryptographic security boundary.
  const canonical = { engine: ENGINE_VERSION, tiers: config.tiers, weights: [...(config.weights instanceof Map ? config.weights : new Map(Object.entries(config.weights || {})))].filter(([, w]) => w !== 1).sort(([a], [b]) => a.localeCompare(b)), scoreMissing: !!config.scoreMissing, scorePairs: !!config.scorePairs, missingBonus: config.missingBonus, comboBonus: config.comboBonus };
  let hash = 2166136261;
  for (const ch of JSON.stringify(canonical)) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return `${ENGINE_VERSION}-${(hash >>> 0).toString(16)}`;
}

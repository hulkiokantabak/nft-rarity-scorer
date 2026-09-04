import { itemKey } from './core.js?v=1.5.0';

const positiveInteger = n => Number.isSafeInteger(n) && n > 0;
export const hasScore = item => item.scoringMethod !== 'Unscored' && Number.isFinite(item.totalScore);

// Competition ranks with the complete tie interval. Filtering never changes
// these source-cohort ranks. A zero score is valid; unscored is not zero.
export function rankScores(items, scope) {
  const unique = [...new Map(items.filter(hasScore).map(i => [itemKey(i), i])).values()];
  unique.sort((a, b) => b.totalScore - a.totalScore);
  const result = new Map(), total = unique.length;
  for (let start = 0; start < total;) {
    let end = start + 1;
    while (end < total && unique[end].totalScore === unique[start].totalScore) end++;
    const rank = { rank: start + 1, rankEnd: end, total, topLow: (start + 1) / total * 100, topHigh: end / total * 100, scope };
    for (let j = start; j < end; j++) result.set(itemKey(unique[j]), { ...rank });
    start = end;
  }
  return result;
}

// The denominator belongs to OpenSea's ranking strategy, not the Art Blocks
// project or the collection's general supply. Never invent an absent rank.
export function openSeaRanking(rarity, collection, slug) {
  if (!positiveInteger(rarity?.rank)) return null;
  const meta = collection?.rarity;
  const matching = typeof slug === 'string' && slug.length > 0 && collection?.collection === slug &&
    typeof rarity.strategy_id === 'string' && rarity.strategy_id.length > 0 &&
    typeof rarity.strategy_version === 'string' && rarity.strategy_version.length > 0 &&
    meta?.strategy_id === rarity.strategy_id && meta?.strategy_version === rarity.strategy_version;
  const total = matching && positiveInteger(meta.total_supply) && positiveInteger(meta.max_rank) && rarity.rank <= meta.max_rank && meta.max_rank <= meta.total_supply ? meta.total_supply : null;
  return { rank: rarity.rank, total, topLow: total ? rarity.rank / total * 100 : null,
    topHigh: total ? rarity.rank / total * 100 : null, scope: slug || 'OpenSea collection',
    strategy: rarity.strategy_id || null, version: rarity.strategy_version || null, calculatedAt: total ? meta.calculated_at || null : null };
}

export function summarizeHoldings(items) {
  const scored = items.filter(hasScore), totalScore = scored.reduce((n, i) => n + i.totalScore, 0);
  return { held: items.length, scored: scored.length, unscored: items.length - scored.length, totalScore,
    assumedPoints: scored.reduce((n, i) => n + (i.assumedPoints || 0), 0),
    average: scored.length ? totalScore / scored.length : null,
    bestScore: scored.length ? Math.max(...scored.map(i => i.totalScore)) : null,
    osRanked: items.filter(i => i.openSeaRanking?.rank).length,
    projectRanked: items.filter(i => i.customProjectRank).length };
}

export function summarizeProjects(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.collectionSlug)) groups.set(item.collectionSlug, []);
    groups.get(item.collectionSlug).push(item);
  }
  return [...groups].map(([key, group]) => ({ key, name: group[0].collectionName, chain: group[0].chain,
    projectId: group[0].artBlocksProjectId, contract: group[0].contractAddress, supply: group[0].totalSupply,
    ...summarizeHoldings(group) })).sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}

export function projectRanksForHoldings(held, population, expectedSupply) {
  const unresolved = i => !hasScore(i) || [...i.mainTraits, ...i.specialTraits].some(t => t.status === 'unknown');
  if (population.length !== expectedSupply || new Set(population.map(itemKey)).size !== expectedSupply ||
      population.some(unresolved) || held.some(unresolved)) {
    throw new Error('Full-project ranks unavailable: some project scores are unresolved. No project percentage was inferred from a subset.');
  }
  const byId = new Map(population.map(i => [itemKey(i), i]));
  const cohort = held[0]?.collectionSlug;
  const evidence = i => JSON.stringify([i.totalScore, i.coverage, i.assumedTraits, i.assumedPoints,
    [...i.mainTraits, ...i.specialTraits].map(t => [t.type, t.value, t.status, t.count, t.pct, t.points, t.isMissing]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    i.pairsAvailable, (i.pairScores || []).map(p => [[[p.a.type, p.a.value], [p.b.type, p.b.value]].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), p.count, p.pct, p.points]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
  if (!cohort || population.some(i => i.collectionSlug !== cohort) || held.some(i => i.collectionSlug !== cohort || !byId.has(itemKey(i)) || evidence(byId.get(itemKey(i))) !== evidence(i))) {
    throw new Error('Project scores changed since the holdings scan. Run Portfolio again before calculating ranks.');
  }
  const ranks = rankScores(population, 'Entire minted Art Blocks project');
  const assumedPopulation = population.filter(i => i.assumedTraits > 0).length;
  return new Map(held.map(i => [itemKey(i), { ...ranks.get(itemKey(i)), assumedPopulation, calculatedAt: new Date().toISOString() }]));
}

export const percentText = n => Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : 'N/A';
export function rankText(rank) {
  if (!rank) return 'Unavailable';
  const end = rank.rankEnd || rank.rank;
  const position = `#${rank.rank}${end !== rank.rank ? '–' + end : ''}${rank.total ? ' / ' + rank.total : ''}`;
  const top = rank.topLow != null ? ` · Top ${percentText(rank.topLow)}${rank.topHigh !== rank.topLow ? '–' + percentText(rank.topHigh) : ''}%` : ' · percentage unavailable';
  return position + top + (rank.assumedPopulation ? ' · includes assumptions' : '');
}

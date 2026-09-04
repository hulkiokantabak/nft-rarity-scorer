// Synthetic protocol fixtures. The two historical core addresses are public;
// wallets, features and projects below are invented, with no credentials.
export const OWNER = '0x' + '1'.repeat(40);
export const V0 = '0x059edd72cd353df5106d2b9cc5ab83a52287ac3a';
export const V1 = '0xa7d8d9ef8d8ce8992df33d8b8cf4aebabd5bd270';
export const FLEX = '0x' + 'b'.repeat(40);
export const FAKE = '0x' + 'f'.repeat(40);
export const registry = [
  { chain_id: 1, address: V0, name: null, contract_type: 'GenArt721CoreV0', core_version: null },
  { chain_id: 1, address: V1, name: 'Art Blocks', contract_type: 'GenArt721CoreV1', core_version: null },
  ...[1, 42161, 8453, 360].map(chain_id => ({ chain_id, address: FLEX, name: 'Independent brand', contract_type: 'GenArt721CoreV3_Engine_Flex', core_version: 'v3.2.0', is_artblocks: false }))
];
export const project = (contract = V1, id = 1, chain = 1, extra = {}) => ({
  id: `${contract}-${id}`, project_id: String(id), chain_id: chain, contract_address: contract,
  name: `Project ${id}`, invocations: 100, opensea_slug: `project-${id}`,
  features: { feature_value_counts: { Color: { Gold: 1, Blue: 99 } }, features_generating: false }, ...extra
});
export const token = (p = project(), invocation = 0, extra = {}) => {
  const token_id = String(BigInt(p.project_id) * 1000000n + BigInt(invocation));
  const { features: unused, ...nested } = p;
  return { id: `${p.contract_address}-${token_id}`, token_id, project_id: p.id, chain_id: p.chain_id,
    contract_address: p.contract_address, owner_address: OWNER, invocation, features: { Color: 'Gold' },
    media_url: 'https://example.com/piece.png', project: nested, ...extra };
};
export function makeFixture(options = {}) {
  const projects = options.projects || [project(), project(V1, 2), project(FLEX, 0)];
  const tokens = options.tokens || projects.map(p => token(p));
  const contracts = options.registry || registry;
  const calls = [];
  const request = async (query, variables, signal) => {
    signal?.throwIfAborted(); calls.push({ query, variables });
    if (options.cancelOn && query.includes(options.cancelOn)) { options.controller.abort(); signal?.throwIfAborted(); }
    if (options.fail && options.fail(query, variables)) throw new Error('Synthetic API failure');
    if (query.includes('ArtBlocksProjectPopulation')) {
      const p = projects.find(p => p.chain_id === variables.chain && p.id === variables.project);
      const population = options.population || Array.from({ length: p.invocations }, (_, i) => token(p, i, { features: { Color: i === 0 ? 'Gold' : 'Blue', ...(options.unknownFrequency ? { Level: 2 } : {}) }, updated_at: '2026-09-04T00:00:00Z' }));
      return { tokens_metadata: population.filter(t => t.invocation > variables.after).slice(0, options.pageSize || 200),
        tokens_metadata_aggregate: { aggregate: { count: population.length, max: { updated_at: options.updatedAt || '2026-09-04T00:00:00Z' } } } };
    }
    if (query.includes('ArtBlocksContracts')) {
      const all = contracts.filter(c => c.chain_id === variables.chain).sort((a, b) => a.address.localeCompare(b.address));
      return { contracts_metadata: all.filter(c => c.address > variables.after).slice(0, options.pageSize || 200), contracts_metadata_aggregate: { aggregate: { count: all.length } } };
    }
    if (query.includes('ArtBlocksHoldings')) {
      const rows = tokens.filter(t => t.chain_id === variables.chain && t.id > variables.after).sort((a, b) => a.id.localeCompare(b.id)).slice(0, options.pageSize || 200);
      return { tokens_metadata: rows.map(t => ({ ...t, features: options.unknownFrequency ? { ...t.features, Level: 2 } : t.features })) };
    }
    if (query.includes('ArtBlocksProjects')) return { projects_metadata: projects.filter(p => p.chain_id === variables.chain && variables.ids.includes(p.id)) };
    throw new Error('Unexpected fixture operation');
  };
  return { request, calls, projects, tokens, registry: contracts };
}

export function bonusFixture() {
  const p = project(V1, 1, 1, { features: { features_generating: false, feature_value_counts: { A: { red: 50, blue: 50 }, B: { round: 50, square: 50 }, C: { true: 99 } } } });
  const population = Array.from({ length: 100 }, (_, i) => token(p, i, { features: {
    A: i < 50 ? 'red' : 'blue', B: i === 0 || (i >= 50 && i < 99) ? 'round' : 'square', ...(i ? { C: true } : {})
  }, updated_at: '2026-09-04T00:00:00Z' }));
  return { projects: [p], tokens: [population[0]], population };
}

// Official Art Blocks inventory and project-scoped Portfolio data. Never send an
// OpenSea key here, and never use names/slugs/prefixes as a contract allowlist.
import { traitKey, countTraits, supplementTraitCounts, buildPairCounts, scoreNFT } from './core.js?v=1.5.0';
import { abortableDelay, retryDelay } from './api.js?v=1.5.0';

export const ARTBLOCKS_ENDPOINT = 'https://data.artblocks.io/v1/graphql';

// The requested Portfolio policy always uses both bonuses and the whole project.
// Bound quadratic pair work as well as token count, and yield between batches.
export async function scoreArtBlocksPopulation(tokens, project, config, { signal, maxPairWork = 1000000 } = {}) {
  const supply = Number(project.invocations), normalized = [];
  let pairWork = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (i % 100 === 0) { signal?.throwIfAborted(); await abortableDelay(0, signal); }
    const item = normalizeArtBlocksToken(tokens[i], project);
    const n = item.traits.filter(t => !t.type.startsWith('_')).length;
    pairWork += n * (n - 1) / 2;
    if (pairWork > maxPairWork) throw new Error('Held rarity unavailable: project exceeds the trait-combination safety limit.');
    normalized.push(item);
  }
  const scanned = countTraits(normalized, supply), official = artBlocksTraitCounts(project);
  if (!scanned._meta.complete || !official._meta.complete) {
    throw new Error('Held rarity unavailable: complete supported project features are needed for missing-trait and combination scoring.');
  }
  const counts = supplementTraitCounts(official, scanned, supply), pairs = Object.create(null);
  for (let i = 0; i < normalized.length; i += 100) {
    await abortableDelay(0, signal); signal?.throwIfAborted();
    for (const [key, n] of Object.entries(buildPairCounts(normalized.slice(i, i + 100)))) pairs[key] = (pairs[key] || 0) + n;
  }
  Object.defineProperty(pairs, '_meta', { value: { complete: true, population: supply } });
  const effectiveConfig = { ...config, scoreMissing: true, scorePairs: true }, population = [];
  for (let i = 0; i < normalized.length; i++) {
    if (i % 100 === 0) { await abortableDelay(0, signal); signal?.throwIfAborted(); }
    population.push(scoreNFT(normalized[i], counts, supply, effectiveConfig, pairs));
  }
  return { population, counts, pairs, config: effectiveConfig };
}
export const ARTBLOCKS_CHAINS = Object.freeze([
  { id: 1, name: 'Ethereum', slug: 'ethereum' },
  { id: 42161, name: 'Arbitrum', slug: 'arbitrum' },
  { id: 8453, name: 'Base', slug: 'base' },
  { id: 360, name: 'Shape', slug: 'shape' }
]);
const chains = new Map(ARTBLOCKS_CHAINS.map(c => [c.id, c]));
const addressPattern = /^0x[0-9a-f]{40}$/i;
const uintPattern = /^(0|[1-9]\d*)$/;
const object = value => value != null && typeof value === 'object' && !Array.isArray(value);
export const contractKey = (chain, address) => `${chain}:${String(address).toLowerCase()}`;
export function projectIdentity(chain, address, tokenId) {
  if (!chains.has(chain) || !addressPattern.test(address) || !uintPattern.test(String(tokenId))) return null;
  const projectId = (BigInt(tokenId) / 1000000n).toString();
  const id = `${address.toLowerCase()}-${projectId}`;
  return { id, projectId, key: `${chain}:${id}` };
}

export const CONTRACTS_QUERY = `query ArtBlocksContracts($chain: Int!, $after: String!) {
  contracts_metadata(where: {chain_id: {_eq: $chain}, address: {_gt: $after}}, order_by: {address: asc}, limit: 200) {
    address chain_id name contract_type core_version
  }
  contracts_metadata_aggregate(where: {chain_id: {_eq: $chain}}) { aggregate { count } }
}`;
export const HOLDINGS_QUERY = `query ArtBlocksHoldings($chain: Int!, $owner: String!, $after: String!) {
  tokens_metadata(where: {chain_id: {_eq: $chain}, owner_address: {_eq: $owner}, id: {_gt: $after}}, order_by: {id: asc}, limit: 200) {
    id token_id project_id chain_id contract_address owner_address invocation features media_url
    project { id project_id chain_id contract_address name invocations opensea_slug }
  }
}`;
export const PROJECTS_QUERY = `query ArtBlocksProjects($chain: Int!, $ids: [String!]!) {
  projects_metadata(where: {chain_id: {_eq: $chain}, id: {_in: $ids}}) {
    id project_id chain_id contract_address name invocations opensea_slug
    features { feature_value_counts features_generating }
  }
}`;

export function createArtBlocksClient({ fetchImpl = fetch, wait = abortableDelay, timeoutMs = 20000 } = {}) {
  return async function request(query, variables, signal) {
    for (let attempt = 0; attempt < 3; attempt++) {
      signal?.throwIfAborted();
      let response;
      try {
        const timeout = AbortSignal.timeout(timeoutMs);
        response = await fetchImpl(ARTBLOCKS_ENDPOINT, {
          method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ query, variables })
        });
      } catch {
        signal?.throwIfAborted();
        throw new Error('Art Blocks data could not be reached. Retry later; no unrelated NFTs will be substituted.');
      }
      if (response.status === 429 || response.status >= 500) {
        const delay = retryDelay(response.headers, attempt, Date.now(), response.status === 429);
        if (attempt < 2 && delay <= 30000) { await wait(delay, signal); continue; }
      }
      if (!response.ok) throw new Error(`Art Blocks data is unavailable (${response.status}). Retry later.`);
      const payload = await response.json();
      if (payload.errors?.length || !object(payload.data)) throw new Error('Art Blocks returned incomplete data. Portfolio stopped without widening its scope.');
      signal?.throwIfAborted();
      return payload.data;
    }
  };
}

export async function fetchArtBlocksCatalog(request, { signal, onProgress = () => {} } = {}) {
  const contracts = new Map(), counts = new Map();
  for (const chain of ARTBLOCKS_CHAINS) {
    let after = '', expected = null, fetched = 0;
    do {
      const data = await request(CONTRACTS_QUERY, { chain: chain.id, after }, signal);
      const rows = data.contracts_metadata;
      const total = data.contracts_metadata_aggregate?.aggregate?.count;
      if (!Array.isArray(rows) || !Number.isInteger(total) || total < 0 || total > 10000 || (expected != null && total !== expected)) throw new Error('Art Blocks contract catalog changed or is incomplete. Retry the scan.');
      expected = total;
      for (const row of rows) {
        if (row.chain_id !== chain.id || !addressPattern.test(row.address) || row.address <= after) throw new Error('Art Blocks contract catalog returned an invalid identity or repeated page.');
        after = row.address;
        const key = contractKey(chain.id, row.address);
        if (contracts.has(key)) throw new Error('Art Blocks contract catalog returned duplicate entries.');
        contracts.set(key, { ...row, address: row.address.toLowerCase() });
        fetched++;
      }
      if (fetched > expected || (!rows.length && fetched !== expected)) throw new Error('Art Blocks contract catalog was truncated. Portfolio stopped safely.');
    } while (fetched < expected);
    counts.set(chain.id, fetched);
    onProgress(`Verified ${fetched} ${chain.name} Art Blocks core contracts.`);
  }
  // Both old flagship contracts are in the official catalog. Losing either is
  // evidence of an incomplete inventory, not permission to exclude old pieces.
  for (const address of ['0x059edd72cd353df5106d2b9cc5ab83a52287ac3a', '0xa7d8d9ef8d8ce8992df33d8b8cf4aebabd5bd270']) {
    if (!contracts.has(contractKey(1, address))) throw new Error('Art Blocks catalog is missing a legacy core contract. Retry later.');
  }
  return { contracts, counts, checkedAt: new Date().toISOString() };
}

function validProject(project, chain, identity, address) {
  return project && project.chain_id === chain && project.id === identity.id &&
    String(project.project_id) === identity.projectId && String(project.contract_address).toLowerCase() === address.toLowerCase();
}

export function artBlocksTraitCounts(project) {
  const counts = Object.create(null);
  const supply = Number(project.invocations);
  const features = project.features;
  if (Number.isSafeInteger(supply) && supply > 0 && object(features?.feature_value_counts)) {
    for (const [type, values] of Object.entries(features.feature_value_counts)) {
      if (!object(values)) continue;
      for (const [value, count] of Object.entries(values)) {
        if (value !== '' && Number.isInteger(count) && count > 0 && count <= supply) counts[traitKey(type, value)] = count;
      }
    }
  }
  Object.defineProperty(counts, '_meta', { enumerable: false, value: {
    source: 'Art Blocks project frequencies', population: supply,
    complete: features?.features_generating === false
    // Value aggregates are not per-token presence. Missing-data assumptions
    // remain opt-in; wallet holdings never become a project baseline.
  } });
  return counts;
}

export function normalizeArtBlocksToken(token, project) {
  const identity = projectIdentity(token.chain_id, token.contract_address, token.token_id);
  const traits = [];
  const supported = object(token.features);
  let unsupportedFeatures = 0;
  for (const [type, value] of Object.entries(object(token.features) ? token.features : {})) {
    if (value == null || value === '') continue;
    if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      traits.push({ type, value: String(value), numeric: typeof value === 'number' });
    } else {
      // Preserve valid scalar siblings. A malformed field must not turn a
      // measured common trait into an assumed-rare one.
      traits.push({ type, value: '[Unsupported feature data]', frequencyUnavailable: true });
      unsupportedFeatures++;
    }
  }
  return {
    tokenId: String(token.token_id), contractAddress: token.contract_address.toLowerCase(), chain: chains.get(token.chain_id).slug,
    name: `${project.name || 'Art Blocks project ' + identity.projectId} #${BigInt(token.token_id) % 1000000n}`,
    image: typeof token.media_url === 'string' && token.media_url.startsWith('https://') ? token.media_url : '',
    owner: token.owner_address, price: null, currency: null,
    traits, traitsKnown: supported, metadataUnavailable: !supported, unsupportedFeatures,
    collectionSlug: identity.key, collectionName: project.name || `Project ${identity.projectId}`,
    artBlocksProjectId: identity.projectId, artBlocksVerified: true, chainId: token.chain_id,
    marketplaceSlug: project.opensea_slug || null
  };
}

export async function fetchArtBlocksPortfolio(owner, request, { signal, onProgress = () => {}, maxItems = 10000 } = {}) {
  if (!addressPattern.test(owner)) throw new Error('Enter a valid wallet address.');
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 10000) throw new Error('Invalid Art Blocks scan limit.');
  owner = owner.toLowerCase();
  const catalog = await fetchArtBlocksCatalog(request, { signal, onProgress });
  const tokens = new Map(), projects = new Map(), warnings = new Set();
  let rejected = 0, partial = false;
  for (const chain of ARTBLOCKS_CHAINS) {
    if (!catalog.counts.get(chain.id)) continue;
    let after = '';
    try {
      while (true) {
        const data = await request(HOLDINGS_QUERY, { chain: chain.id, owner, after }, signal);
        if (!Array.isArray(data.tokens_metadata)) throw new Error('Missing Art Blocks holdings page.');
        if (!data.tokens_metadata.length) break;
        for (const token of data.tokens_metadata) {
          if (typeof token.id !== 'string' || token.id <= after) throw new Error('Art Blocks holdings cursor did not advance.');
          after = token.id;
          const identity = projectIdentity(token.chain_id, token.contract_address, token.token_id);
          if (token.chain_id !== chain.id || !identity || !catalog.contracts.has(contractKey(chain.id, token.contract_address)) ||
              String(token.owner_address).toLowerCase() !== owner || token.id !== `${token.contract_address.toLowerCase()}-${token.token_id}` ||
              token.project_id !== identity.id || !validProject(token.project, chain.id, identity, token.contract_address)) { rejected++; continue; }
          const key = `${chain.id}:${token.id}`;
          if (tokens.has(key)) throw new Error('Art Blocks holdings returned a duplicate token.');
          tokens.set(key, token);
          projects.set(identity.key, token.project);
          if (tokens.size >= maxItems) { partial = true; break; }
        }
        onProgress(`Fetched ${tokens.size} verified Art Blocks pieces across production chains...`);
        if (partial) break;
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (error.name === 'AbortError') throw error;
      warnings.add(`${chain.name} holdings could not be completely fetched. Results are partial.`);
    }
    if (partial) break;
  }
  if (partial) warnings.add(`Stopped at ${maxItems} Art Blocks pieces. Remaining holdings/chains were not scanned.`);
  if (rejected) warnings.add(`${rejected} records failed exact contract/project/owner verification and were excluded.`);
  // Project aggregates are requested once per project, not repeated on every
  // owned token. The cohort key always includes chain, contract and project.
  for (const chain of ARTBLOCKS_CHAINS) {
    const group = [...projects.entries()].filter(([, project]) => project.chain_id === chain.id);
    for (let start = 0; start < group.length; start += 20) {
      const batch = group.slice(start, start + 20), expected = new Map(batch.map(([key, project]) => [project.id, { key, project }]));
      try {
        const data = await request(PROJECTS_QUERY, { chain: chain.id, ids: [...expected.keys()] }, signal);
        if (!Array.isArray(data.projects_metadata)) throw new Error('Missing project frequency data.');
        const received = new Set();
        for (const project of data.projects_metadata) {
          const entry = expected.get(project.id);
          if (!entry || received.has(project.id) || !validProject(project, chain.id, { id: entry.project.id, projectId: String(entry.project.project_id) }, entry.project.contract_address)) throw new Error('Project identity mismatch.');
          received.add(project.id); projects.set(entry.key, project);
        }
        if (received.size !== expected.size) warnings.add('Some Art Blocks project frequencies were not returned; missing-data rules apply.');
      } catch (error) {
        signal?.throwIfAborted();
        if (error.name === 'AbortError') throw error;
        warnings.add('Some Art Blocks project frequencies are unavailable; missing-data rules apply.');
      }
    }
  }
  return { catalog, tokens: [...tokens.values()], projects, warnings: [...warnings], partial: partial || warnings.size > 0, rejected };
}

export const PROJECT_POPULATION_QUERY = `query ArtBlocksProjectPopulation($chain: Int!, $project: String!, $after: Int!) {
  tokens_metadata(where: {chain_id: {_eq: $chain}, project_id: {_eq: $project}, invocation: {_gt: $after}}, order_by: {invocation: asc}, limit: 200) {
    id token_id project_id chain_id contract_address invocation features updated_at
  }
  tokens_metadata_aggregate(where: {chain_id: {_eq: $chain}, project_id: {_eq: $project}}) { aggregate { count max { updated_at } } }
}`;

const scoringSignature = project => JSON.stringify([Number(project.invocations), project.features?.features_generating,
  Object.entries(artBlocksTraitCounts(project)).sort(([a], [b]) => a.localeCompare(b))]);

export async function fetchArtBlocksProjectPopulation(project, request, { signal, onProgress = () => {}, maxItems = 20000 } = {}) {
  const supply = Number(project.invocations), chain = project.chain_id, address = project.contract_address;
  const identity = projectIdentity(chain, address, String(BigInt(project.project_id) * 1000000n));
  if (!identity || !validProject(project, chain, identity, address) || !Number.isSafeInteger(supply) || supply < 1) throw new Error('Invalid project population.');
  if (supply > maxItems) throw new Error(`Project rank not calculated: ${supply} minted pieces exceeds the ${maxItems}-piece project limit.`);
  const signature = scoringSignature(project);
  const checkProject = async () => {
    const data = await request(PROJECTS_QUERY, { chain, ids: [project.id] }, signal);
    const fresh = data.projects_metadata?.[0];
    if (data.projects_metadata?.length !== 1 || !validProject(fresh, chain, identity, address) || scoringSignature(fresh) !== signature) throw new Error('Project supply or feature frequencies changed. Run Portfolio again before calculating ranks.');
  };
  await checkProject();
  const tokens = []; let after = -1, stamp;
  while (true) {
    signal?.throwIfAborted();
    const data = await request(PROJECT_POPULATION_QUERY, { chain, project: project.id, after }, signal);
    const aggregate = data.tokens_metadata_aggregate?.aggregate;
    if (!Array.isArray(data.tokens_metadata) || aggregate?.count !== supply || typeof aggregate.max?.updated_at !== 'string') throw new Error('Project index is incomplete. Full-project percentage is unavailable.');
    if (stamp != null && stamp !== aggregate.max.updated_at) throw new Error('Project token data changed during ranking. Retry the project scan.');
    stamp = aggregate.max.updated_at;
    if (!data.tokens_metadata.length) break;
    for (const token of data.tokens_metadata) {
      const tokenIdentity = projectIdentity(token.chain_id, token.contract_address, token.token_id);
      if (token.chain_id !== chain || !tokenIdentity || tokenIdentity.key !== identity.key || token.project_id !== project.id ||
          token.id !== `${address.toLowerCase()}-${token.token_id}` || !Number.isInteger(token.invocation) ||
          token.invocation !== after + 1 || token.invocation >= supply || BigInt(token.token_id) % 1000000n !== BigInt(token.invocation)) throw new Error('Project population has a gap, duplicate or identity mismatch. No full-project rank was assigned.');
      after = token.invocation; tokens.push(token);
    }
    onProgress(tokens.length, supply);
  }
  if (tokens.length !== supply) throw new Error('Project population was truncated. No full-project rank was assigned.');
  await checkProject();
  return { tokens, project, updatedAt: stamp, fetchedAt: new Date().toISOString() };
}

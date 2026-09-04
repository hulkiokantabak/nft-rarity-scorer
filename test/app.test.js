import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { makeFixture, project as abProject, V1, FLEX, FAKE } from '../fixtures/artblocks.js';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const { window, document } = parseHTML(html);
const memory = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) }; };
const location = { href: 'http://localhost/', search: '' };
Object.assign(globalThis, { window, document, localStorage: memory(), sessionStorage: memory(), location, history: { replaceState(a, b, value) { location.href = new URL(value, location.href).href; location.search = new URL(location.href).search; } } });
// LinkeDOM intentionally lacks selection-state setters; supply browser-equivalent behavior.
Object.defineProperty(window.HTMLSelectElement.prototype, 'value', { configurable: true,
  get() { return this.querySelector('option[selected]')?.getAttribute('value') ?? this.querySelector('option')?.getAttribute('value') ?? ''; },
  set(value) { for (const o of this.querySelectorAll('option')) value === o.getAttribute('value') ? o.setAttribute('selected', '') : o.removeAttribute('selected'); } });
window.location = location;
let calls = [], failListings = false, omitted = false, failTraits = false, failCollection = false, cancelOwner = false, switchModeDuringFetch = false;
let fullCorpus = false, failScan = false, numericTraits = false, omitDetailTraits = false;
let abOptions = {}, abFixture = makeFixture(abOptions);
const address = '0x' + '1'.repeat(40), contracts = ['0x' + 'a'.repeat(40), '0x' + 'b'.repeat(40)];
const nft = (contract, id = '0') => ({ identifier: id, contract, collection: 'fixture', name: contract === contracts[0] ? 'Gold zero' : 'Blue zero', image_url: '', traits: [{ trait_type: 'Color', value: contract === contracts[0] ? 'Gold' : 'Blue' }, ...(numericTraits ? [{ trait_type: 'Level', value: contract === contracts[0] && id === '0' ? 2 : 1 }] : [])], owners: cancelOwner ? [{ address: '0x' + '3'.repeat(40) }] : [], rarity: { rank: contract === contracts[0] ? 1 : 90 }, opensea_url: `https://opensea.io/item/ethereum/${contract}/${id}` });
const listing = (contract, value, currency = 'ETH') => ({ status: 'ACTIVE', chain: 'ethereum', asset: { contract, identifier: '0' }, price: { current: { value, decimals: 0, currency } } });
globalThis.fetch = async (url, options = {}) => {
  const path = new URL(url).pathname; calls.push({ path, options });
  let body;
  if (url === 'https://data.artblocks.io/v1/graphql') {
    const { query, variables } = JSON.parse(options.body);
    body = { data: await abFixture.request(query, variables, options.signal) };
  } else if (path.endsWith('/nfts/batch')) {
    const ids = JSON.parse(options.body).identifiers;
    body = { nfts: ids.filter((_, i) => !omitted || i !== 0).map(i => nft(i.contract_address, i.token_id)).reverse() };
    if (omitDetailTraits) body.nfts.forEach(n => { delete n.traits; });
  } else if (path.startsWith('/api/v2/collections/')) {
    if (failCollection) return new Response('{}', { status: 404 });
    if (switchModeDuringFetch) window.setMode('all');
    body = { name: 'Fixture', total_supply: failTraits ? 2 : 100, contracts: contracts.map(address => ({ address, chain: 'ethereum' })) };
  }
  else if (path.startsWith('/api/v2/traits/')) {
    if (failTraits) return new Response('{}', { status: 404 });
    body = { categories: { Color: 'string', Level: 'number' }, counts: { Color: { Gold: 1, Blue: 99 }, Level: { min: 1, max: 99 } } };
  } else if (path.startsWith('/api/v2/listings/')) {
    if (failListings) return new Response('{}', { status: 404 });
    body = { listings: [listing(contracts[0], '1'), listing(contracts[1], '10')] };
  } else if (path.startsWith('/api/v2/collection/')) {
    if (failScan) return new Response('{}', { status: 404 });
    body = { nfts: [...contracts.map(c => nft(c)), ...(fullCorpus ? [nft(contracts[0], '1'), ...Array.from({ length: 97 }, (_, i) => nft(contracts[1], String(i + 1)))] : [])] };
  }
  else if (path.startsWith('/api/v2/accounts/resolve/')) body = { address };
  else if (path.includes('/account/') && path.endsWith('/nfts')) body = { nfts: contracts.map(c => nft(c)) };
  else if (path.startsWith('/api/v2/accounts/')) {
    if (cancelOwner) { window.cancelAnalysis(); options.signal.throwIfAborted(); }
    body = { address };
  }
  else throw new Error(`Unexpected fixture request: ${path}`);
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const app = await import('../app.js');
const input = (id, value) => { document.getElementById(id).value = value; };
const reset = () => {
  calls = []; failListings = false; omitted = false; failTraits = false; failCollection = false; cancelOwner = false; switchModeDuringFetch = false;
  fullCorpus = false; failScan = false; numericTraits = false; omitDetailTraits = false;
  abOptions = {}; abFixture = makeFixture(abOptions);
  app.applyImportedConfig({ v: 2, slug: 'fixture', mode: 'listed', standard_tiers: { thresholds: [2, 5, 20], points: [7, 3, 1] }, score_missing: false, score_pairs: false });
  input('apiKey', 'test-key-not-real');
};

test('initial markup wires every app event handler and labels fixed inputs', () => {
  for (const [, name] of html.matchAll(/on(?:click|change|input)="([\w]+)\(/g)) if (name !== 'document') assert.equal(typeof window[name], 'function', name);
  for (const el of document.querySelectorAll('input:not([type="checkbox"])')) {
    if (el.hidden || el.disabled) continue;
    assert.ok(el.getAttribute('aria-label') || document.querySelector(`label[for="${el.id}"]`), el.id);
  }
  assert.equal(document.querySelectorAll('[role="tab"]').length, 3);
  assert.equal(document.querySelectorAll('script[src^="//"]').length, 0);
  assert.match(document.querySelector('meta[http-equiv="Content-Security-Policy"]').content, /connect-src https:\/\/api\.opensea\.io https:\/\/data\.artblocks\.io;/);
});
test('no-key demo works without network and builds cards/table', () => {
  reset(); calls = []; input('apiKey', ''); app.loadDemo();
  assert.equal(calls.length, 0); assert.equal(app.getDisplayItems().length, 12);
  assert.match(document.getElementById('provenance').textContent, /Synthetic demo/);
  assert.equal(document.querySelectorAll('.item-card').length, 12);
  app.setView('table'); assert.equal(document.querySelectorAll('.row-toggle').length, 12);
  app.setView('cards');
});
test('listed analysis joins same token ID on distinct contracts correctly', async () => {
  reset(); await app.analyze();
  assert.equal(document.getElementById('errorMsg').classList.contains('visible'), false, document.getElementById('errorMsg').textContent);
  const items = app.getDisplayItems(); assert.equal(items.length, 2);
  assert.deepEqual(items.map(i => [i.contractAddress, i.totalScore, i.price]), [[contracts[0], 7, 1], [contracts[1], 0, 10]]);
  assert.ok(calls.some(c => c.path === '/api/v2/nfts/batch'));
});
test('changing mode during fetch does not mutate the active run population', async () => {
  reset(); switchModeDuringFetch = true; await app.analyze();
  assert.equal(app.getDisplayItems().length, 2);
  assert.match(document.getElementById('provenance').textContent, /\(listed\)/);
});
test('a failed new run cannot resurrect old cards with Show More', async () => {
  reset(); window.setMode('all'); app.loadDemo(); assert.equal(app.getDisplayItems().length, 100);
  failCollection = true; input('collectionInput', 'fixture'); await app.analyze(); window.showMore();
  assert.equal(app.getDisplayItems().length, 0); assert.equal(document.querySelectorAll('.item-card').length, 0);
  assert.equal(document.getElementById('provenance').hidden, true);
});
test('omitted batch NFT stays visible as unscored', async () => {
  reset(); omitted = true; await app.analyze();
  const missing = app.getDisplayItems().find(i => i.contractAddress === contracts[0]);
  assert.equal(missing.scoringMethod, 'Unscored'); assert.equal(missing.totalScore, 0);
});
test('cancel during the final owner lookup cannot publish completed results', async () => {
  reset(); cancelOwner = true; await app.analyze();
  assert.equal(app.getDisplayItems().length, 0);
  assert.match(document.getElementById('errorMsg').textContent, /cancelled/);
  assert.notEqual(document.getElementById('progressText').textContent, 'Done!');
});
test('all mode retains valid trait results when listing lookup fails', async () => {
  reset(); window.setMode('all'); failListings = true; await app.analyze();
  assert.equal(app.getDisplayItems().length, 2);
  assert.match(document.getElementById('provenance').textContent, /Listing prices unavailable/);
});

test('Listed, All and bonus-enabled runs retain the same available base frequencies', async () => {
  reset(); fullCorpus = true; await app.analyze();
  const gold = () => app.getDisplayItems().find(i => i.contractAddress === contracts[0] && i.tokenId === '0');
  assert.equal(gold().totalScore, 7);
  window.setMode('all'); await app.analyze();
  assert.equal(app.getDisplayItems().length, 100); assert.equal(gold().totalScore, 7); // scan has 2% Gold, API has 1%
  window.setMode('listed'); document.getElementById('scoreMissing').checked = true; await app.analyze();
  assert.equal(gold().totalScore, 7); assert.equal(gold().assumedTraits, 0);
});

test('Listed restores missing numeric frequencies with a complete scan', async () => {
  reset(); fullCorpus = true; numericTraits = true; await app.analyze();
  const gold = app.getDisplayItems().find(i => i.contractAddress === contracts[0]);
  assert.equal(gold.totalScore, 14); assert.equal(gold.coverage, 1);
  assert.match(gold.source, /full-scan additional/);
});

test('optional detail responses cannot erase All-mode traits', async () => {
  reset(); window.setMode('all'); omitDetailTraits = true; await app.analyze();
  const gold = app.getDisplayItems().find(i => i.contractAddress === contracts[0]);
  assert.equal(gold.totalScore, 7); assert.equal(gold.coverage, 1);
});

test('a failed optional baseline retains base scores and explains the limitation', async () => {
  reset(); failScan = true; document.getElementById('scorePairs').checked = true; await app.analyze();
  assert.equal(app.getDisplayItems()[0].totalScore, 7);
  assert.match(document.getElementById('provenance').textContent, /available base scores are retained/);
});

test('missing-data checkbox re-scores cached missing metadata on and off with clear labels', async () => {
  reset(); omitted = true; await app.analyze();
  const missing = () => app.getDisplayItems().find(i => i.contractAddress === contracts[0]);
  assert.equal(missing().totalScore, 0);
  document.getElementById('scoreMissing').checked = true;
  document.getElementById('scoreMissing').dispatchEvent(new window.Event('change'));
  assert.equal(missing().totalScore, 11); assert.equal(missing().assumedPoints, 11);
  assert.match(document.getElementById('resultsGrid').textContent, /Assumed rare/);
  app.setView('table');
  assert.match(document.getElementById('resultsTable').textContent, /11 assumed pts/);
  app.setView('cards');
  assert.match(document.getElementById('provenance').textContent, /not measured frequencies/);
  document.getElementById('scoreMissing').checked = false;
  document.getElementById('scoreMissing').dispatchEvent(new window.Event('change'));
  assert.equal(missing().totalScore, 0);
});

test('Portfolio respects the missing-data opt-in without inventing measured coverage', async () => {
  reset(); abOptions.unknownFrequency = true;
  input('walletInput', address); document.getElementById('scoreMissing').checked = true; await app.analyzePortfolio();
  assert.equal(app.getDisplayItems().length, 3);
  assert.ok(app.getDisplayItems().every(i => i.assumedTraits === 1 && i.assumedPoints === 7));
  assert.ok(app.getDisplayItems().every(i => i.coverage < 1));
});
test('comparison fallback scans the full population, not just listings', async () => {
  reset(); failTraits = true; input('compareSlugA', 'fixture-a'); input('compareSlugB', 'fixture-b'); await app.analyzeCompareTab();
  assert.ok(calls.some(c => c.path === '/api/v2/collection/fixture-a/nfts'));
  assert.ok(calls.some(c => c.path === '/api/v2/collection/fixture-b/nfts'));
  assert.match(document.getElementById('compareResultsArea').textContent, /not to infer relative market value/);
});
test('portfolio uses current zero points and canonical account resolver, not cached tiers', async () => {
  reset(); input('points1', '0'); input('walletInput', 'fixture.eth'); await app.analyzePortfolio();
  assert.ok(calls.some(c => c.path === '/api/v2/accounts/resolve/fixture.eth'));
  assert.ok(app.getDisplayItems().every(i => i.totalScore === 0));
  assert.equal(app.getDisplayItems().length, 3);
  assert.match(document.getElementById('portfolioSummary').textContent, /verified Engine\/Flex/);
});

test('address Portfolio needs no key, includes verified Engine and never fetches broad NFTs', async () => {
  reset(); input('apiKey', ''); input('walletInput', address); await app.analyzePortfolio();
  assert.equal(document.getElementById('errorMsg').classList.contains('visible'), false, document.getElementById('errorMsg').textContent);
  const items = app.getDisplayItems(); assert.equal(items.length, 3);
  assert.ok(items.some(i => i.contractAddress === FLEX));
  assert.ok(calls.every(c => c.path === '/v1/graphql' && !Object.hasOwn(c.options.headers, 'X-API-KEY')));
  assert.match(document.getElementById('provenance').textContent, /grouped by chain, contract and project/);
  assert.equal(document.getElementById('statAvg').textContent, '—');
  assert.ok(items.every(i => i.scoreColor === 'var(--accent)'));
  const links = [...document.querySelectorAll('#resultsGrid a[href*="/collection/"]')].map(a => a.getAttribute('href'));
  assert.ok(links.length > 0); assert.ok(links.every(href => /\/collection\/project-\d+$/.test(href)));
});

test('Portfolio does not enforce old 25-project limit or trust Art Blocks names', async () => {
  reset(); const projects = Array.from({ length: 28 }, (_, i) => abProject(V1, i));
  projects.push(abProject(FAKE, 0, 1, { name: 'Art Blocks Curated' }));
  abFixture = makeFixture({ projects }); input('walletInput', address); await app.analyzePortfolio();
  assert.equal(app.getDisplayItems().length, 28);
  assert.ok(app.getDisplayItems().every(i => i.contractAddress === V1));
  assert.match(document.getElementById('portfolioSummary').textContent, /1 records failed/);
});

test('unscored Portfolio records remain in their own project under both sort directions', async () => {
  reset(); input('walletInput', address); await app.analyzePortfolio();
  const values = [
    { collectionSlug: 'b', totalScore: 20, scoringMethod: 'Custom tiers' },
    { collectionSlug: 'a', totalScore: 0, scoringMethod: 'Unscored' },
    { collectionSlug: 'a', totalScore: 7, scoringMethod: 'Custom tiers' }
  ];
  for (const dir of ['asc', 'desc']) assert.deepEqual([...values].sort(app.makeSortFn('score', dir)).map(i => i.collectionSlug), ['a', 'a', 'b']);
});

test('Portfolio cancellation and catalog failure cannot restore previous broad results', async () => {
  reset(); app.loadDemo(); input('walletInput', address);
  abOptions.fail = query => query.includes('ArtBlocksContracts'); await app.analyzePortfolio();
  assert.equal(app.getDisplayItems().length, 0);
  assert.equal(document.getElementById('errorMsg').classList.contains('visible'), true);
  reset(); input('walletInput', address);
  abOptions.fail = query => { if (query.includes('ArtBlocksHoldings')) window.cancelAnalysis(); return false; };
  await app.analyzePortfolio(); assert.equal(app.getDisplayItems().length, 0);
  assert.match(document.getElementById('errorMsg').textContent, /cancelled/);
});
test('config import is atomic; zero weights reset when absent', () => {
  reset(); app.loadDemo();
  const config = app.buildConfigJSON(); config.trait_weights = { Background: 0 };
  app.applyImportedConfig(config); assert.equal(app.buildConfigJSON().trait_weights.Background, 0);
  delete config.trait_weights; app.applyImportedConfig(config); assert.deepEqual(app.buildConfigJSON().trait_weights, {});
  const before = app.buildConfigJSON();
  assert.throws(() => app.applyImportedConfig({ ...config, slug: 'bad', combo_bonus: 99 }));
  assert.equal(app.buildConfigJSON().slug, before.slug);
});
test('shared URL retains zeros and weights and excludes secrets', () => {
  reset(); input('points1', '0'); input('missingBonus', '0');
  const config = app.buildConfigJSON(); config.trait_weights = { Color: 0 }; app.applyImportedConfig(config);
  app.encodeStateToURL(); assert.ok(!location.href.includes('test-key-not-real'));
  app.loadStateFromURL(); const restored = app.buildConfigJSON();
  assert.equal(restored.standard_tiers.points[0], 0); assert.equal(restored.missing_bonus, 0); assert.equal(restored.trait_weights.Color, 0);
});
test('snapshot incompatible with a changed config cannot overlay', () => {
  reset(); app.loadDemo(); app.saveSnapshot(); input('points1', '0'); app.reScoreWithWeights(); app.loadSnapshot(0);
  assert.match(document.getElementById('errorMsg').textContent, /incompatible/);
});
test('unapplied zero weight stays in controls and exports after a new analysis', () => {
  reset(); app.loadDemo(); document.querySelector('.weight-input[data-type="Background"]').value = '0';
  app.loadDemo(); assert.equal(app.buildConfigJSON().trait_weights.Background, 0);
  assert.equal(document.querySelector('.weight-input[data-type="Background"]').value, '0');
});
test('re-score cannot relabel a listed cache as an all-mode scan', () => {
  reset(); app.loadDemo(); window.setMode('all'); app.reScoreWithWeights();
  assert.equal(app.getDisplayItems().length, 12);
  assert.match(document.getElementById('provenance').textContent, /12\/100 NFTs fetched \(listed\)/);
});
test('snapshot average excludes unscored NFTs just like the visible stats', async () => {
  reset(); omitted = true; await app.analyze(); app.saveSnapshot();
  const snapshots = JSON.parse(localStorage.getItem('nft_scorer_snapshots'));
  assert.equal(snapshots.fixture[0].scoredCount, 1);
  assert.equal(snapshots.fixture[0].avgScore, Number(document.getElementById('statAvg').textContent));
});
test('null price and rank remain last in both sort directions', () => {
  const values = [{ price: 1, rarityRank: 2, currency: 'ETH' }, { price: null, rarityRank: null, currency: null }];
  for (const field of ['price', 'rarity']) for (const dir of ['asc', 'desc']) assert.equal([...values].sort(app.makeSortFn(field, dir))[1][field === 'price' ? 'price' : 'rarityRank'], null);
});
test('CSV contains identity, currency and scoring provenance without API key', async () => {
  reset(); app.loadDemo(); let exported;
  const original = URL.createObjectURL; URL.createObjectURL = blob => { exported = blob; return 'blob:test'; };
  try { window.exportCSV(); } finally { URL.createObjectURL = original; }
  const csv = await exported.text(); assert.ok(!csv.includes('test-key-not-real')); assert.ok(!csv.includes('pts/ETH')); assert.match(csv, /Currency/);
  assert.match(csv, /Assumed rarity points/);
});

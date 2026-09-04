import test from 'node:test';
import assert from 'node:assert/strict';
import { artBlocksProjectLabels, fetchArtBlocksProjectLabels } from '../artblocks.js';
import { itemKey } from '../core.js';
import { project, token, tag, makeFixture, V1, FLEX, FAKE } from '../fixtures/artblocks.js';

const item = (contract = V1, tokenId = '1000000', chain = 'ethereum') => ({ contractAddress: contract, tokenId, chain,
  name: 'Untrusted marketplace name', traits: [{ type: 'Color', value: 'Blue' }], totalSupply: 200, collectionSlug: 'os-collection', price: 12, owner: 'owner', source: 'OpenSea frequencies', totalScore: 7 });

test('AB500 uses exact public heritage tags, never project number or is_artblocks', () => {
  const p = project(V1, 506, 1, { is_artblocks: false, tags: [tag('ab500')], series_id: null });
  assert.equal(artBlocksProjectLabels(p).ab500, true); assert.equal(artBlocksProjectLabels(p).series, null);
  assert.equal(artBlocksProjectLabels(project(FLEX, 0, 1, { is_artblocks: true })).ab500, false);
  for (const tags of [undefined, null, [{ tag_name: 'ab500', tag: null }], [tag('AB500')].map(t => ({ ...t, tag_name: 'ab500' })), [{ ...tag('ab500'), tag: { ...tag('ab500').tag, status: 'private' } }]]) {
    assert.equal(artBlocksProjectLabels({ ...p, tags }).ab500, null);
  }
  assert.equal(artBlocksProjectLabels({ ...p, tags: [tag('ab500'), { tag_name: 'scaling', tag: null }] }).ab500, true);
});

test('category and series do not misclassify Factory, Playground, Studio or Flex', () => {
  for (const category of ['factory', 'playground', 'studio', 'flex']) {
    const labels = artBlocksProjectLabels(project(V1, 1, 1, { vertical_name: category, vertical: { name: category, display_name: category }, curation_status: 'factory', series_id: 5, tags: [tag('ab500')] }));
    assert.equal(labels.category.toLowerCase(), category); assert.equal(labels.series, null);
  }
  const p = project(V1, 78, 1, { tags: [tag('ab500'), tag('curated series 3')] });
  assert.equal(artBlocksProjectLabels(p).series, 3);
  assert.equal(artBlocksProjectLabels({ ...p, tags: [], series_id: 8 }).series, 8);
  assert.equal(artBlocksProjectLabels({ ...p, tags: [], series_id: null }).series, null);
  assert.equal(artBlocksProjectLabels({ ...p, vertical_name: 'unassigned', vertical: { name: 'unassigned', display_name: 'Unassigned' }, tags: [], series_id: 5 }).category, null);
});

test('artist collaborations and branded collaboration category are preserved', () => {
  const labels = artBlocksProjectLabels(project(V1, 1, 1, { artist_name: 'Artist A x Artist B', artist_profiles: [{ display_name: 'Artist A' }],
    vertical_name: 'pace', vertical: { name: 'pace', display_name: 'Art Blocks × Pace', category_name: 'collaborations' } }));
  assert.equal(labels.artist, 'Artist A x Artist B'); assert.equal(labels.category, 'Collaborations · Art Blocks × Pace');
});

test('label-only enrichment validates exact token, chain, contract and project without altering scores', async () => {
  const projects = [project(), project(V1, 2), project(FLEX, 0, 8453)];
  const items = [item(), item(V1, '2000000'), item(FLEX, '0', 'base'), item(FAKE, '0'), item(V1, '999999')];
  const before = structuredClone(items), fixture = makeFixture({ projects });
  const { labels } = await fetchArtBlocksProjectLabels(items, fixture.request);
  assert.equal(labels.size, 3); assert.equal(labels.get(itemKey(items[0])).projectId, '1');
  assert.equal(labels.get(itemKey(items[1])).projectId, '2'); assert.equal(labels.get(itemKey(items[2])).chain, 'base');
  assert.deepEqual(items, before); assert.equal(labels.get(itemKey(items[3])), undefined); assert.equal(labels.get(itemKey(items[4])), undefined);
  assert.ok(fixture.calls.filter(c => c.query.includes('ArtBlocksTokenProjectLabels')).every(c => !c.variables.ids.some(id => id.startsWith(FAKE))));
});

test('wrong or duplicate label identities fail closed, and missing metadata stays unverified', async () => {
  const p = project(), valid = token(p);
  for (const rows of [[{ ...valid, chain_id: 8453 }], [{ ...valid, project: project(V1, 2) }], [valid, valid], [{ ...valid, token_id: '1000001' }]]) {
    const result = await fetchArtBlocksProjectLabels([item()], makeFixture({ labelRows: rows }).request);
    assert.equal(result.labels.size, 0); assert.equal(result.warnings.length, 1);
  }
  const result = await fetchArtBlocksProjectLabels([item()], makeFixture({ labelRows: [{ ...valid, project: { ...p, tags: undefined } }] }).request);
  assert.equal(result.labels.get(itemKey(item())).ab500, null);
});

test('label errors preserve scores while cancellation propagates and batches remain bounded', async () => {
  const items = [item()];
  const failed = await fetchArtBlocksProjectLabels(items, async () => { throw Error('offline'); });
  assert.equal(failed.labels.size, 0); assert.equal(failed.warnings.length, 1); assert.equal(items[0].totalScore, 7);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fetchArtBlocksProjectLabels(items, makeFixture().request, { signal: controller.signal }), { name: 'AbortError' });
  const p = project(V1, 1, 1, { invocations: 121 }), fixture = makeFixture({ projects: [p] });
  const batch = Array.from({ length: 121 }, (_, i) => item(V1, String(1000000 + i)));
  const result = await fetchArtBlocksProjectLabels(batch, fixture.request);
  assert.equal(result.labels.size, 121);
  assert.deepEqual(fixture.calls.filter(c => c.query.includes('ArtBlocksTokenProjectLabels')).map(c => c.variables.ids.length), [100, 21]);
});

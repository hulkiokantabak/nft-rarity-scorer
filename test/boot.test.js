import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { startScorer } from '../boot.js';

function fixture() {
  return parseHTML('<html><body><button id="themeToggle" disabled>Theme</button><div id="startupStatus"><span id="startupMessage">Loading</span></div><main id="main" inert></main></body></html>').document;
}
test('startup enables interaction only after the module finishes loading', async () => {
  const doc = fixture(); let complete;
  const ready = startScorer(doc, () => new Promise(resolve => { complete = resolve; }));
  assert.ok(doc.getElementById('main').hasAttribute('inert'));
  assert.equal(doc.getElementById('themeToggle').disabled, true);
  complete(); assert.equal(await ready, true);
  assert.equal(doc.getElementById('main').hasAttribute('inert'), false);
  assert.equal(doc.getElementById('themeToggle').disabled, false);
  assert.equal(doc.documentElement.dataset.appState, 'ready');
});
test('missing module or failed initialization shows a safe startup error', async () => {
  const doc = fixture();
  assert.equal(await startScorer(doc, async () => { throw new Error('private-key-never-render'); }), false);
  assert.equal(doc.getElementById('startupStatus').getAttribute('role'), 'alert');
  assert.equal(doc.documentElement.dataset.appState, 'failed');
  assert.ok(doc.getElementById('main').hasAttribute('inert'));
  assert.match(doc.getElementById('startupMessage').textContent, /could not start/);
  assert.ok(!doc.body.textContent.includes('private-key-never-render'));
});

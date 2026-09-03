import { ENGINE_VERSION, numberSetting, validateTiers, traitKey, parseTraitCounts, countTraits, buildTraitTypes, buildMissingCountByType, buildPairCounts, classifyTrait as classifyCore, scoreNFT, itemKey, listingAsset, normalizeNFT, addValueMetrics, configFingerprint } from './core.js?v=1.1.1';
import { createApiClient, abortableDelay, nextPage, fetchNFTBatches } from './api.js?v=1.1.1';
import { createKeyStore } from './storage.js?v=1.1.1';
import { validateConfig } from './config.js?v=1.1.1';
let resultConfig = null;
let resultMode = 'listed';
let runMode = 'listed';
const apiRequest = createApiClient();
const browserStorage = name => { try { return window[name]; } catch { return undefined; } };
const keyStore = createKeyStore(browserStorage('sessionStorage'), browserStorage('localStorage'));
const preferences = {
  getItem(key) { try { return browserStorage('localStorage')?.getItem(key) ?? null; } catch { return null; } },
  setItem(key, value) { try { browserStorage('localStorage')?.setItem(key, value); } catch {} },
  removeItem(key) { try { browserStorage('localStorage')?.removeItem(key); } catch {} }
};
let runConfig = null;
let runWarnings = new Set();
let collectionContracts = new Map();
function warn(message) { runWarnings.add(message); }
function currentConfig() {
  const config = getCurrentTierConfig();
  const bonus = getBonuses();
  const weights = new Map(traitWeights);
  document.querySelectorAll('.weight-input').forEach(i => weights.set(i.dataset.type, numberSetting(i.value, 1, 0, 10)));
  return { tiers: config.activeTiers, weights, scoreMissing: document.getElementById('scoreMissing').checked, scorePairs: document.getElementById('scorePairs').checked, missingBonus: bonus.missing, comboBonus: bonus.combo };
}
function beginConfig() {
  runConfig = currentConfig();
  traitWeights = new Map(runConfig.weights);
  runMode = currentMode;
  activeTiers = runConfig.tiers;
  runWarnings = new Set();
  return { thresholds: activeTiers.map(t => t.threshold), points: activeTiers.map(t => t.points) };
}
// ─── State ───
let currentMode = 'listed';
let currentSort = 'score';
let currentSortDir = 'desc';
let currentView = 'cards';
let scoredItems = [];
let abortController = null;
let isRunning = false;
let hideProgressTimer = null; // tracks the pending progress-hide so a new run can cancel it
let currentTierMode = 'standard'; // 'standard' or 'custom'
let activeTiers = []; // unified tier array used during rendering: [{name, color, threshold, points}, ...]
let displayCount = 50;
const PAGE_SIZE = 50;
let filteredItems = null; // null = no filter, use scoredItems
let renderParams = {}; // cached params for re-rendering
let traitWeights = new Map(); // traitType -> multiplier
let cachedFetchData = null; // {items, traitCounts, totalSupply, thresholds, points, allTraitTypes, slug, chain, contractAddress}
let compareResult = null; // set by analyzeCompare — {slug, name, count, topScore, avgScore, lowScore, totalSupply, floorPrice, floorCurrency, scoredItems}
let viewingPortfolio = false; // true when current scoredItems are cross-collection portfolio results

// Progress-bar phase boundaries for the top-level analyze() flow.
// Internal fetchers (fetchListingPrices, enrichItems) accept their own
// progressStart/progressEnd params so they can be reused in Listed vs All vs parallel paths.
const PROGRESS = {
  collectionMeta: 5,
  traitData: 10,
  itemsFetchStart: 15,
  // All-mode parallel phase: listings + enrichment run concurrently across this span
  parallelStart: 55,
  parallelEnd: 90,
  // Listed-mode ranges
  listedPricesStart: 25,
  listedPricesEnd: 55,
  // Owner resolution (both modes)
  ownersStart: 90,
  ownersEnd: 95,
  scoring: 95,
  done: 100
};

// ─── Tabs ───
function setTab(name) {
  if (!['analyze', 'compare', 'portfolio'].includes(name)) return;
  document.querySelectorAll('.tab-btn').forEach(b => { const selected = b.dataset.tab === name; b.classList.toggle('active', selected); b.setAttribute('aria-selected', String(selected)); b.tabIndex = selected ? 0 : -1; });
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.dataset.tab === name));
  try { preferences.setItem('nft_scorer_active_tab', name); } catch {}
}
function loadActiveTab() {
  const saved = preferences.getItem('nft_scorer_active_tab') || 'analyze';
  if (['analyze', 'compare', 'portfolio'].includes(saved)) setTab(saved);
}

// ─── Tier Mode ───
function setTierMode(mode) {
  currentTierMode = mode;
  document.querySelectorAll('.tier-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.tiermode === mode));
  document.getElementById('standardTiers').style.display = mode === 'standard' ? 'flex' : 'none';
  const ct = document.getElementById('customTiers');
  ct.classList.toggle('visible', mode === 'custom');
  if (mode === 'custom' && ct.children.length === 0) {
    // Seed with 3 default custom tiers
    addCustomTier('Ultra Rare', 1, 10, '#e74c3c');
    addCustomTier('Rare', 5, 5, '#9b59b6');
    addCustomTier('Uncommon', 15, 2, '#3498db');
  }
}

function addCustomTier(name, threshold, pts, color) {
  const container = document.getElementById('customTiers');
  const count = container.querySelectorAll('.custom-tier-row').length;
  if (count >= 10) return;
  const row = document.createElement('div');
  row.className = 'custom-tier-row';
  // Sanitize color to a strict 6-char hex; any other shape (CSS expressions, attribute-breaking
  // payloads, etc.) is replaced with the default. Defends against URL/config import injecting
  // arbitrary CSS into the rendered tier styling.
  const safeColor = safeHexColor(color);
  row.innerHTML = `
    <input type="color" aria-label="Tier color" class="ct-color" value="${safeColor}" title="Tier color">
    <input type="text" aria-label="Tier name" class="ct-name" value="${escapeHtml(name || 'Tier ' + (count + 1))}" placeholder="Tier name" maxlength="20">
    <span class="ct-sep">&lt;</span>
    <input type="number" aria-label="Tier threshold percent" class="ct-thresh" value="${threshold ?? 10}" min="0" max="100" step="0.5" title="Max rarity %">
    <span class="ct-sep">% &rarr;</span>
    <input type="number" aria-label="Tier points" class="ct-pts" value="${pts ?? 5}" min="0" max="1000" title="Points">
    <span class="ct-sep">pts</span>
    <button class="ct-remove" onclick="removeCustomTier(this)" title="Remove tier">&times;</button>
  `;
  // Insert before the actions row if it exists, otherwise append
  const actions = container.querySelector('.custom-tier-actions');
  if (actions) container.insertBefore(row, actions);
  else container.appendChild(row);
  ensureCustomActions();
  updateCustomTierNumbers();
}

function removeCustomTier(btn) {
  const container = document.getElementById('customTiers');
  const rows = container.querySelectorAll('.custom-tier-row');
  if (rows.length <= 1) return; // must keep at least 1
  btn.closest('.custom-tier-row').remove();
  updateCustomTierNumbers();
}

function ensureCustomActions() {
  const container = document.getElementById('customTiers');
  if (container.querySelector('.custom-tier-actions')) return;
  const actions = document.createElement('div');
  actions.className = 'custom-tier-actions';
  actions.innerHTML = `<button class="btn btn-secondary" onclick="addCustomTier()" style="font-size:0.78rem; padding:5px 12px;">+ Add Tier</button>
    <span style="font-size:0.72rem; color:var(--text-muted); align-self:center;">Traits above the last tier threshold score 0 pts</span>`;
  container.appendChild(actions);
  // Add preset controls
  if (!container.querySelector('.preset-controls')) {
    const presets = document.createElement('div');
    presets.className = 'preset-controls';
    presets.style.cssText = 'display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-top:8px;';
    presets.innerHTML = `<select aria-label="Saved tier preset" id="presetSelect" style="background:var(--bg); border:1px solid var(--border); color:var(--text); padding:4px 8px; border-radius:4px; font-size:0.78rem;"><option value="">Presets...</option></select>
      <button class="btn btn-secondary" onclick="loadPreset()" style="font-size:0.72rem; padding:4px 8px;">Load</button>
      <input type="text" aria-label="New preset name" id="presetName" placeholder="Preset name" maxlength="30" style="background:var(--bg); border:1px solid var(--border); color:var(--text); padding:4px 8px; border-radius:4px; font-size:0.78rem; width:120px;">
      <button class="btn btn-secondary" onclick="savePreset()" style="font-size:0.72rem; padding:4px 8px;">Save</button>
      <button class="btn btn-secondary" onclick="deletePreset()" style="font-size:0.72rem; padding:4px 8px; color:var(--danger);">Del</button>`;
    container.appendChild(presets);
    refreshPresetDropdown();
  }
}

function updateCustomTierNumbers() {
  const container = document.getElementById('customTiers');
  const rows = container.querySelectorAll('.custom-tier-row');
  const addBtn = container.querySelector('.custom-tier-actions button');
  if (addBtn) addBtn.style.display = rows.length >= 10 ? 'none' : 'inline-block';
}

function getCustomTiers() {
  const rows = document.querySelectorAll('#customTiers .custom-tier-row');
  return Array.from(rows).map(row => ({
    name: row.querySelector('.ct-name').value.trim() || 'Tier',
    color: row.querySelector('.ct-color').value,
    threshold: numberSetting(row.querySelector('.ct-thresh').value, 0, 0, 100),
    points: numberSetting(row.querySelector('.ct-pts').value, 0)
  })).sort((a, b) => a.threshold - b.threshold);
}

// ─── Tier Presets ───
function getPresets() {
  try { return JSON.parse(preferences.getItem('nft_scorer_tier_presets') || '[]'); } catch { return []; }
}
function refreshPresetDropdown() {
  const sel = document.getElementById('presetSelect');
  if (!sel) return;
  const presets = getPresets();
  sel.innerHTML = '<option value="">Presets...</option>' + presets.map((p, i) => `<option value="${i}">${escapeHtml(p.name)}</option>`).join('');
}
function savePreset() {
  const name = document.getElementById('presetName')?.value.trim();
  if (!name) return;
  const tiers = getCustomTiers();
  if (tiers.length === 0) return;
  const presets = getPresets();
  presets.push({ name, tiers });
  preferences.setItem('nft_scorer_tier_presets', JSON.stringify(presets));
  document.getElementById('presetName').value = '';
  refreshPresetDropdown();
}
function loadPreset() {
  const sel = document.getElementById('presetSelect');
  const idx = parseInt(sel?.value);
  if (isNaN(idx)) return;
  const presets = getPresets();
  if (!presets[idx]) return;
  // Clear existing custom tier rows
  const container = document.getElementById('customTiers');
  container.querySelectorAll('.custom-tier-row').forEach(r => r.remove());
  for (const t of presets[idx].tiers) addCustomTier(t.name, t.threshold, t.points, t.color);
}
function deletePreset() {
  const sel = document.getElementById('presetSelect');
  const idx = parseInt(sel?.value);
  if (isNaN(idx)) return;
  const presets = getPresets();
  presets.splice(idx, 1);
  preferences.setItem('nft_scorer_tier_presets', JSON.stringify(presets));
  refreshPresetDropdown();
}

// ─── Thumbnails ───
let thumbsVisible = true;
function toggleThumbs() {
  thumbsVisible = !thumbsVisible;
  document.body.classList.toggle('thumbs-off', !thumbsVisible);
  document.getElementById('thumbToggle').textContent = thumbsVisible ? 'Thumbs' : 'No Thumbs';
  preferences.setItem('nft_scorer_thumbs', thumbsVisible ? 'on' : 'off');
}
function loadThumbs() {
  if (preferences.getItem('nft_scorer_thumbs') === 'off') {
    thumbsVisible = false;
    document.body.classList.add('thumbs-off');
  }
}

// ─── Theme ───
function toggleTheme() {
  const html = document.documentElement;
  const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
  html.dataset.theme = next;
  preferences.setItem('nft_scorer_theme', next);
  document.getElementById('themeToggle').innerHTML = next === 'dark' ? '&#9790;' : '&#9788;';
}
function loadTheme() {
  const saved = preferences.getItem('nft_scorer_theme') || 'dark';
  document.documentElement.dataset.theme = saved;
  document.getElementById('themeToggle').innerHTML = saved === 'dark' ? '&#9790;' : '&#9788;';
}

// ─── API Key ───
function loadApiKey() {
  const { key, remembered } = keyStore.load();
  document.getElementById('apiKey').value = key;
  document.getElementById('rememberKey').checked = remembered;
  updateKeyStatus();
}
function saveApiKey() {
  const storage = keyStore.save(document.getElementById('apiKey').value, document.getElementById('rememberKey').checked);
  updateKeyStatus(storage);
}
function clearApiKey() {
  keyStore.clear();
  document.getElementById('apiKey').value = '';
  document.getElementById('rememberKey').checked = false;
  updateKeyStatus();
}
function updateKeyStatus(storage) {
  const el = document.getElementById('keyStatus');
  const key = document.getElementById('apiKey').value.trim();
  el.textContent = key ? (storage === 'memory' ? 'In memory only' : document.getElementById('rememberKey').checked ? 'Remembered on this device' : 'This tab only') : 'No key entered';
  el.className = 'key-status ' + (key ? 'key-saved' : 'key-missing');
}
function getApiKey() { return document.getElementById('apiKey').value.trim(); }

// ─── Last collection ───
function loadLastCollection() {
  const last = preferences.getItem('nft_scorer_last_collection');
  if (last) document.getElementById('collectionInput').value = last;
}
function saveLastCollection(slug) {
  preferences.setItem('nft_scorer_last_collection', slug);
}

// ─── Mode / View ───
function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
}
function setView(view) {
  currentView = view;
  document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('resultsGrid').style.display = view === 'cards' ? 'flex' : 'none';
  document.getElementById('resultsTable').className = 'results-table' + (view === 'table' ? ' visible' : '');
  if (scoredItems.length) rerenderCurrentView();
}

// ─── Tier sync ───
document.getElementById('thresh1').addEventListener('input', function() { document.getElementById('thresh1_upper').value = this.value; });
document.getElementById('thresh2').addEventListener('input', function() { document.getElementById('thresh2_upper').value = this.value; });

// Re-score instantly when the scoring-option toggles change, if we already have cached primary data.
// Guards: no concurrent run (isRunning), must have primary cache (cachedFetchData), not currently
// viewing a portfolio (reScoreWithWeights would otherwise clobber the portfolio view with a
// primary re-score — same pitfall as the Weights panel and the Snapshots panel).
function autoReScoreIfReady() {
  if (!isRunning && cachedFetchData && !viewingPortfolio) reScoreWithWeights();
}
document.getElementById('scoreMissing').addEventListener('change', autoReScoreIfReady);
document.getElementById('scorePairs').addEventListener('change', autoReScoreIfReady);
// 'change' fires on blur/Enter for number inputs (not on every keystroke) so this debounces naturally.
document.getElementById('missingBonus').addEventListener('change', autoReScoreIfReady);
document.getElementById('comboBonus').addEventListener('change', autoReScoreIfReady);

// ─── Helpers ───
function parseSlug(input) {
  input = input.trim();
  const match = input.match(/opensea\.io\/collection\/([a-z0-9_-]+)/i);
  if (match) return match[1].toLowerCase();
  if (/^[a-z0-9_-]+$/i.test(input)) return input.toLowerCase();
  return null;
}
function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function showError(msg) { const el = document.getElementById('errorMsg'); el.textContent = msg; el.classList.add('visible'); }
function hideError() { document.getElementById('errorMsg').classList.remove('visible'); }

let progressStartTime = 0;
function setProgress(pct, text) {
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressBar').setAttribute('aria-valuenow', String(Math.round(pct)));
  if (pct > 5 && pct < 95) {
    const elapsed = (Date.now() - progressStartTime) / 1000;
    const total = elapsed / (pct / 100);
    const remaining = Math.max(0, Math.round(total - elapsed));
    document.getElementById('progressText').textContent = text + (remaining > 2 ? ` (~${remaining}s remaining)` : '');
  } else {
    document.getElementById('progressText').textContent = text;
  }
}
function showProgress() {
  // If a new run starts before the previous run's delayed hide fires, cancel that pending hide
  // so the bar stays visible for the new run.
  if (hideProgressTimer) { clearTimeout(hideProgressTimer); hideProgressTimer = null; }
  document.getElementById('progress').classList.add('visible');
  // Reset the Cancel button (cancelAnalysis may have disabled it + changed its text during a prior run).
  const cancelBtn = document.getElementById('cancelBtn');
  if (cancelBtn) { cancelBtn.textContent = 'Cancel'; cancelBtn.disabled = false; }
  progressStartTime = Date.now();
}
function hideProgress() {
  if (hideProgressTimer) { clearTimeout(hideProgressTimer); hideProgressTimer = null; }
  document.getElementById('progress').classList.remove('visible');
}
function scheduleHideProgress(delayMs = 1000) {
  if (hideProgressTimer) clearTimeout(hideProgressTimer);
  hideProgressTimer = setTimeout(() => {
    hideProgressTimer = null;
    document.getElementById('progress').classList.remove('visible');
  }, delayMs);
}

function apiGet(url, apiKey) { return apiRequest(url, apiKey, { signal: abortController?.signal }); }
function sleep(ms) { return abortableDelay(ms, abortController?.signal); }
function formatPrice(price) {
  if (price == null) return null;
  if (price >= 1) return parseFloat(price.toFixed(4));
  return parseFloat(price.toPrecision(4));
}

// Shared link builders used by cards, table, and CSV export.
function openSeaItemUrl(chain, contractAddress, tokenId) {
  return `https://opensea.io/item/${encodeURIComponent(chain)}/${encodeURIComponent(contractAddress)}/${encodeURIComponent(tokenId)}`;
}
function ownerLinkHtml(item, extraAttrs = '') {
  if (!item.owner) return '—';
  const href = 'https://opensea.io/' + encodeURIComponent(item.ownerName || item.owner);
  const label = item.ownerName
    ? escapeHtml(item.ownerName)
    : escapeHtml(item.owner.slice(0,6)) + '...' + escapeHtml(item.owner.slice(-4));
  return `<a href="${href}" target="_blank" rel="noopener"${extraAttrs}>${label}</a>`;
}

// 6-char hex colors only — defense against CSS injection via tier color fields
// loaded from URL params or imported config files.
function isValidHexColor(c) {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
}
function safeHexColor(c, fallback = '#3498db') {
  return isValidHexColor(c) ? c : fallback;
}

function traitTagStyle(tierName) {
  // Standard tiers use CSS classes; for unified approach use inline styles from activeTiers
  const tier = (resultConfig?.tiers || activeTiers).find(t => t.name === tierName);
  if (tier && isValidHexColor(tier.color)) {
    const c = tier.color;
    return `background:${c}18; color:${c}; border-color:${c}55;`;
  }
  // common / unmatched / invalid color
  return 'background:rgba(149,165,166,0.06); color:#95a5a6; border-color:rgba(149,165,166,0.15);';
}

function scoreColor(score, min, max) {
  if (max === min) return 'var(--score-mid)';
  const ratio = (score - min) / (max - min);
  if (ratio >= 0.66) return 'var(--score-high)';
  if (ratio >= 0.33) return 'var(--score-mid)';
  return 'var(--score-low)';
}

function cancelAnalysis() {
  // Just abort the in-flight fetch. State cleanup happens in the running flow's
  // finally block when AbortError propagates — doing both here was a race: the
  // user could click Cancel then immediately Analyze and the OLD finally would
  // overwrite the NEW run's isRunning/button state.
  if (abortController) abortController.abort();
  // Brief visual feedback while the abort propagates through the pending fetches.
  // showProgress() resets this on the next run; hiding the progress container hides the button.
  const btn = document.getElementById('cancelBtn');
  if (btn) {
    btn.textContent = 'Cancelling...';
    btn.disabled = true;
  }
}

// ─── Main Analysis ───

function currencyLabel(item) {
  let token = null;
  try { token = JSON.parse(item.currencyKey)[2]; } catch {}
  return `${item.currency} · ${item.chain}${token && token !== 'native' ? ' · ' + token.slice(0, 6) + '…' + token.slice(-4) : item.priceComparable === false ? ' · token unverified' : ''}`;
}
function clearResultView() {
  scoredItems = []; filteredItems = null; displayCount = PAGE_SIZE; renderParams = {}; resultConfig = null;
  document.getElementById('resultsGrid').innerHTML = '';
  document.getElementById('resultsTable').innerHTML = '';
  document.getElementById('resultsHeader').classList.remove('visible');
  document.getElementById('collectionInfo').classList.remove('visible');
  document.getElementById('provenance').hidden = true;
  document.getElementById('showMoreWrap').style.display = 'none';
  document.getElementById('snapshotsPanel').style.display = 'none';
  document.getElementById('weightsPanel').style.display = 'none';
}

async function analyze() {
  if (isRunning) return;
  hideError();
  const apiKey = getApiKey();
  if (!apiKey) { showError('Enter an OpenSea API key, or try the demo without one.'); return; }
  const slug = parseSlug(document.getElementById('collectionInput').value);
  if (!slug) { showError('Enter a valid OpenSea collection URL or slug.'); return; }
  let thresholds, points;
  try { ({ thresholds, points } = beginConfig()); } catch (e) { showError(e.message); return; }
  const mode = runMode;
  clearResultView();
  compareResult = null; renderCompareStats(); clearPortfolioSummary(); viewingPortfolio = false;
  cachedFetchData = null;
  isRunning = true;
  const btn = document.getElementById('analyzeBtn');
  btn.disabled = true; btn.textContent = 'Analyzing...';
  abortController = new AbortController();
  showProgress();
  document.getElementById('resultsGrid').innerHTML = '';
  document.getElementById('resultsTable').innerHTML = '';
  document.getElementById('resultsHeader').classList.remove('visible');
  try {
    const colData = await apiGet(`/api/v2/collections/${encodeURIComponent(slug)}`, apiKey);
    const totalSupply = colData.total_supply;
    if (!Number.isInteger(totalSupply) || totalSupply <= 0) throw new Error('Collection supply is unavailable. Cannot calculate trustworthy frequencies.');
    const contracts = colData.contracts || [];
    collectionContracts.set(slug, contracts);
    const chain = contracts[0]?.chain || 'ethereum';
    const contractAddress = contracts[0]?.address || '';
    saveLastCollection(slug); showCollectionInfo(colData, totalSupply);
    let traitCounts;
    try { traitCounts = parseTraitCounts(await apiGet(`/api/v2/traits/${encodeURIComponent(slug)}`, apiKey), totalSupply); }
    catch (e) { if (e.name === 'AbortError') throw e; warn('Trait endpoint unavailable; using a full metadata scan.'); traitCounts = {}; }
    // Missing and combination frequencies require a full population, not a listed subset.
    let baseline = null;
    if (mode === 'all' || !Object.keys(traitCounts).length || runConfig.scoreMissing || runConfig.scorePairs) {
      baseline = await fetchAllItems(slug, apiKey, totalSupply);
      if (baseline.some(i => !i.traitsKnown)) await enrichItems(baseline, chain, contractAddress, apiKey);
      const fullCounts = countTraits(baseline, totalSupply);
      if (fullCounts._meta.complete) traitCounts = fullCounts;
      else {
        warn(`Metadata scan returned ${baseline.length}/${totalSupply} NFTs or incomplete traits. Missing/pair bonuses are unavailable.`);
        if (!Object.keys(traitCounts).length) traitCounts = fullCounts;
      }
    }
    let items;
    if (mode === 'all') {
      items = baseline;
      // Listing and owner enrichment are optional; failure must not discard valid trait scores.
      try { applyListingPrices(items, await fetchListingPrices(slug, apiKey, 55, 65)); }
      catch (e) { if (e.name === 'AbortError') throw e; warn('Listing prices unavailable; trait scores are still shown.'); }
      try { await enrichItems(items, chain, contractAddress, apiKey); }
      catch (e) { if (e.name === 'AbortError') throw e; warn('Some owner/rank metadata could not be enriched.'); }
    } else items = await fetchListedItems(slug, chain, contractAddress, apiKey);
    if (!items.length) throw new Error('No items found. This collection may have no active listings.');
    await resolveOwnerNames(items, apiKey);
    const allTraitTypes = buildTraitTypes(traitCounts);
    const missingCountByType = buildMissingCountByType(traitCounts, totalSupply);
    const pairCounts = baseline ? buildPairCounts(baseline, totalSupply) : null;
    cachedFetchData = { mode, items, traitCounts, totalSupply, thresholds, points, allTraitTypes, missingCountByType, pairCounts, slug, chain, contractAddress, fetchedAt: new Date().toISOString(), warnings: [...runWarnings] };
    populateWeightsPanel(allTraitTypes);
    const scored = items.map(item => scoreNFT(item, traitCounts, totalSupply, runConfig, pairCounts));
    finishAnalysis(scored, totalSupply, slug, chain, contractAddress, thresholds, points);
  } catch (e) { showError(e.name === 'AbortError' ? 'Analysis cancelled.' : e.message); }
  finally { isRunning = false; btn.disabled = false; btn.textContent = 'Analyze Collection'; scheduleHideProgress(); }
}

function finishAnalysis(items, totalSupply, slug, chain, contractAddress, thresholds, points, isFinal = true) {
  if (items.length === 0) return;
  resultConfig = { ...runConfig, tiers: activeTiers.map(t => ({ ...t })), weights: new Map(runConfig.weights) };
  resultMode = viewingPortfolio ? 'portfolio' : cachedFetchData?.mode || runMode;
  compareResult = null; renderCompareStats();
  currentSort = 'score'; currentSortDir = 'desc';
  document.querySelectorAll('.sort-btn[data-sort]').forEach(b => b.classList.toggle('active', b.dataset.sort === 'score'));
  // Compute value scores and bargain flags
  const scores = items.filter(i => i.scoringMethod !== 'Unscored').map(i => i.totalScore);
  const minScore = scores.length ? Math.min(...scores) : 0;
  const maxScore = scores.length ? Math.max(...scores) : 0;

  addValueMetrics(items);
  items.forEach(item => { item.scoreColor = scoreColor(item.totalScore, minScore, maxScore); });
  items.sort(makeSortFn('score', 'desc'));
  scoredItems = items;

  if (isFinal) setProgress(PROGRESS.done, 'Done!');
  renderResults(items, totalSupply, slug, chain, contractAddress, thresholds, points, minScore, maxScore);
  if (isFinal) {
    if (!viewingPortfolio) encodeStateToURL();
    refreshSnapshotsPanel();
  }
}

// Progressive render: score current raw items with current traitCounts and
// paint results without marking the analysis complete. Safe to call multiple
// times as more data comes in (prices, owners, rarity).
function renderProgressive(rawItems, traitCounts, totalSupply, slug, chain, contractAddress, thresholds, points) {
  if (!rawItems || rawItems.length === 0) return;
  if (!traitCounts || Object.keys(traitCounts).length === 0) return;
  const allTraitTypes = buildTraitTypes(traitCounts);
  const scoreMissing = document.getElementById('scoreMissing').checked;
  const scorePairs = document.getElementById('scorePairs').checked;
  const missingCountByType = buildMissingCountByType(traitCounts, totalSupply);
  const pairCounts = scorePairs ? buildPairCounts(rawItems) : null;
  const bonuses = getBonuses();
  const scored = rawItems.map(item => scoreItem(item, traitCounts, totalSupply, thresholds, points, allTraitTypes, scoreMissing, missingCountByType, scorePairs, pairCounts, bonuses.missing, bonuses.combo));
  finishAnalysis(scored, totalSupply, slug, chain, contractAddress, thresholds, points, false);
}

function showCollectionInfo(colData, totalSupply) {
  const el = document.getElementById('collectionInfo');
  const img = document.getElementById('colImage');
  const name = document.getElementById('colName');
  const meta = document.getElementById('colMeta');
  const imgUrl = colData.image_url || '';
  if (imgUrl.startsWith('https://')) img.src = imgUrl; else img.removeAttribute('src');
  img.hidden = !imgUrl.startsWith('https://');
  img.style.display = img.hidden ? 'none' : 'block';
  name.textContent = colData.name || colData.collection || '';
  meta.textContent = `${totalSupply} items · ${runMode === 'listed' ? 'Listed' : 'All'} mode`;
  el.classList.add('visible');
}

// Stamp per-item chain/contract so renderers can build OpenSea links
// without plumbing chain/contract through render calls. No-op if already set
// (portfolio / compare may have pre-stamped items).
function stampItemContext(items, chain, contractAddress) {
  for (const item of items) {
    if (!item.chain) item.chain = chain;
    if (!item.contractAddress) item.contractAddress = contractAddress;
  }
}

// ─── Fetch Listing Prices ───
async function fetchListingPrices(slug, apiKey, progressStart = 25, progressEnd = 55) {
  const base = `/api/v2/listings/collection/${encodeURIComponent(slug)}/all?limit=200`;
  let url = base, count = 0;
  const seen = new Set(), tokenMap = new Map();
  do {
    const data = await apiGet(url, apiKey);
    for (const listing of data.listings || []) {
      if (listing.status && listing.status !== 'ACTIVE') continue;
      const asset = listingAsset(listing);
      if (!asset) { warn('Some listings lacked an exact NFT identity or valid price and were excluded.'); continue; }
      const key = itemKey(asset), previous = tokenMap.get(key);
      if (!previous) tokenMap.set(key, { ...asset, collectionSlug: slug });
      else if (previous.currencyKey === asset.currencyKey && !previous.mixedCurrencies && asset.price < previous.price) tokenMap.set(key, { ...asset, collectionSlug: slug });
      else if (previous.currencyKey !== asset.currencyKey) {
        // Do not manufacture an exchange rate or pick an arbitrary cheapest currency.
        previous.price = null; previous.currency = null; previous.mixedCurrencies = true;
        warn('NFTs listed in multiple currencies have no single comparison price.');
      }
      count++;
    }
    setProgress(Math.min(progressEnd, progressStart + count / 100), `Fetched ${count} listings...`);
    url = nextPage(base, data.next, seen);
  } while (url);
  return tokenMap;
}
function applyListingPrices(items, tokenMap) {
  for (const item of items) {
    const listing = tokenMap.get(itemKey(item));
    if (listing) Object.assign(item, { price: listing.price, currency: listing.currency, currencyKey: listing.currencyKey, priceComparable: listing.priceComparable, mixedCurrencies: listing.mixedCurrencies });
  }
}
async function fetchListedItems(slug, chain, contractAddress, apiKey) {
  const tokenMap = await fetchListingPrices(slug, apiKey);
  const items = await fetchNFTBatches([...tokenMap.values()], apiRequest, apiKey, abortController?.signal,
    (done, total) => setProgress(55 + done / total * 30, `Loaded NFT metadata: ${done}/${total}`));
  if (items.some(i => i.metadataUnavailable)) warn('Some NFTs were omitted by OpenSea. They remain visible as unscored.');
  return items;
}
async function fetchAllItems(slug, apiKey, totalSupply) {
  const base = `/api/v2/collection/${encodeURIComponent(slug)}/nfts?limit=200`;
  let url = base;
  const seen = new Set(), items = new Map(), contracts = collectionContracts.get(slug) || [];
  do {
    const data = await apiGet(url, apiKey);
    for (const nft of data.nfts || []) {
      const candidates = contracts.filter(c => c.address?.toLowerCase() === nft.contract?.toLowerCase());
      const urlChain = nft.opensea_url?.match(/\/(?:assets|item)\/([^/]+)\//)?.[1];
      const chain = nft.chain || urlChain || (new Set(candidates.map(c => c.chain)).size === 1 ? candidates[0]?.chain : null);
      if (!chain || !nft.contract) { warn('Skipped NFT metadata with ambiguous chain/contract identity.'); continue; }
      const item = normalizeNFT(nft, { chain, collectionSlug: slug });
      items.set(itemKey(item), item);
    }
    setProgress(15 + Math.min(items.size / totalSupply * 40, 40), `Fetched ${items.size}/${totalSupply} NFTs...`);
    url = nextPage(base, data.next, seen);
  } while (url);
  return [...items.values()];
}

// ─── Owner Name Resolution ───
let ownerNameCache = new Map(); // address -> {name, ts}
const OWNER_CACHE_KEY = 'nft_scorer_owner_cache';
const OWNER_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const OWNER_CACHE_MAX_ENTRIES = 5000; // bound localStorage growth; defends against bloat from large portfolios or hostile API responses

function loadOwnerCache() {
  try {
    const raw = preferences.getItem(OWNER_CACHE_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw);
    if (!stored || typeof stored !== 'object') return;
    const now = Date.now();
    for (const [addr, entry] of Object.entries(stored)) {
      if (entry && typeof entry === 'object' && typeof entry.ts === 'number' && now - entry.ts < OWNER_CACHE_TTL_MS) {
        ownerNameCache.set(addr, { name: entry.name || null, ts: entry.ts });
      }
    }
  } catch {}
}

function saveOwnerCache() {
  try {
    // FIFO eviction by timestamp once we exceed the cap, so a Portfolio scan over many
    // wallets or a hostile API can't bloat localStorage indefinitely.
    if (ownerNameCache.size > OWNER_CACHE_MAX_ENTRIES) {
      const entries = [...ownerNameCache.entries()]
        .filter(([, e]) => e && typeof e === 'object' && typeof e.ts === 'number')
        .sort((a, b) => a[1].ts - b[1].ts); // oldest first
      const toEvict = entries.slice(0, ownerNameCache.size - OWNER_CACHE_MAX_ENTRIES);
      for (const [addr] of toEvict) ownerNameCache.delete(addr);
    }
    const obj = {};
    for (const [addr, entry] of ownerNameCache.entries()) {
      if (entry && typeof entry === 'object') obj[addr] = { name: entry.name, ts: entry.ts };
    }
    preferences.setItem(OWNER_CACHE_KEY, JSON.stringify(obj));
  } catch (e) {
    // Quota or serialization errors — silently degrade to session-only cache
    console.warn('Owner cache write failed:', e.message);
  }
}

async function resolveOwnerNames(items, apiKey) {
  const unique = [...new Set(items.map(i => i.owner).filter(Boolean))];
  // Only resolve addresses we haven't seen yet
  const toResolve = unique.filter(addr => !ownerNameCache.has(addr));
  if (toResolve.length === 0) { applyOwnerNames(items); return; }

  const batchSize = 10;

  for (let i = 0; i < toResolve.length; i += batchSize) {
    const chunk = toResolve.slice(i, i + batchSize);
    await Promise.all(chunk.map(async addr => {
      try {
        const data = await apiGet(`https://api.opensea.io/api/v2/accounts/${encodeURIComponent(addr)}`, apiKey);
        const name = data.username || data.ens_name || null;
        ownerNameCache.set(addr, { name, ts: Date.now() });
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        warn('Some owner names are unavailable. Addresses remain visible.');
      }
    }));
    setProgress(90 + Math.round((Math.min(i + batchSize, toResolve.length) / toResolve.length) * 5),
      `Resolving owner names (${Math.min(i + batchSize, toResolve.length)}/${toResolve.length})...`);
    if (i + batchSize < toResolve.length) await sleep(200);
  }
  applyOwnerNames(items);
  saveOwnerCache();
}

function applyOwnerNames(items) {
  for (const item of items) {
    if (item.owner && ownerNameCache.has(item.owner)) {
      const entry = ownerNameCache.get(item.owner);
      if (entry && entry.name) item.ownerName = entry.name;
    }
  }
}

// ─── Enrich All-Mode Items (owner + rarity) ───
async function enrichItems(items, chain, contractAddress, apiKey, progressStart = 65, progressEnd = 90) {
  const missing = items.filter(i => !i.owner || !i.rarity || !i.traitsKnown);
  if (!missing.length) return;
  const enriched = await fetchNFTBatches(missing, apiRequest, apiKey, abortController?.signal,
    (done, total) => setProgress(progressStart + done / total * (progressEnd - progressStart), `Enriched ${done}/${total} NFTs...`));
  const byId = new Map(enriched.map(i => [itemKey(i), i]));
  for (const item of items) { const update = byId.get(itemKey(item)); if (update && !update.metadataUnavailable) Object.assign(item, update); }
}
function toggleWeightsPanel() {
  const content = document.getElementById('weightsContent');
  const icon = document.getElementById('weightsToggleIcon');
  const open = content.style.display === 'none';
  content.style.display = open ? 'block' : 'none';
  icon.innerHTML = open ? '&#9662;' : '&#9656;';
  document.getElementById(icon.id === 'weightsToggleIcon' ? 'weightsDisclosure' : 'snapshotsDisclosure').setAttribute('aria-expanded', String(open));
}

function populateWeightsPanel(allTraitTypes) {
  document.getElementById('weightsPanel').style.display = '';
  const list = document.getElementById('weightsList');
  list.innerHTML = '';
  for (const type of [...allTraitTypes].sort()) {
    const weight = traitWeights.get(type) ?? 1.0;
    const el = document.createElement('div');
    el.style.cssText = 'display:flex; align-items:center; gap:4px; padding:4px 8px; border:1px solid var(--border); border-radius:6px; background:var(--bg); font-size:0.78rem;';
    el.innerHTML = `<span style="color:var(--text-muted); max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(type)}">${escapeHtml(type)}</span>
      <input type="number" class="weight-input" aria-label="${escapeHtml(type)} weight" data-type="${escapeHtml(type)}" value="${weight}" min="0" max="10" step="0.1" style="width:48px; background:var(--card-bg); border:1px solid var(--border); color:var(--text); padding:2px 4px; border-radius:4px; font-size:0.78rem; text-align:center;">
      <span style="color:var(--text-muted); font-size:0.7rem;">x</span>`;
    list.appendChild(el);
  }
}

function reScoreWithWeights() {
  if (!cachedFetchData || isRunning || viewingPortfolio) return;
  try {
    const nextWeights = new Map(traitWeights);
    document.querySelectorAll('.weight-input').forEach(input => nextWeights.set(input.dataset.type, numberSetting(input.value, 1, 0, 10)));
    traitWeights = nextWeights;
    const { thresholds, points } = beginConfig();
    const d = cachedFetchData;
    (d.warnings || []).forEach(warn);
    if ((runConfig.scorePairs && !d.pairCounts?._meta?.complete) || (runConfig.scoreMissing && !d.traitCounts._meta?.present)) {
      warn('Missing/pair bonuses need a new analysis with those options enabled, so a full population can be fetched.');
    }
    Object.assign(d, { thresholds, points });
    const scored = d.items.map(item => scoreNFT(item, d.traitCounts, d.totalSupply, runConfig, d.pairCounts));
    finishAnalysis(scored, d.totalSupply, d.slug, d.chain, d.contractAddress, thresholds, points);
  } catch (e) { showError(e.message); }
}

// ─── Portfolio summary rendering ───
function renderPortfolioSummary(s) {
  const el = document.getElementById('portfolioSummary');
  if (!el) return;
  const totalScored = s.buckets.tier;
  const pctScored = s.walletNfts > 0 ? Math.round((totalScored / s.walletNfts) * 100) : 0;
  const shortAddr = `${s.addr.slice(0, 6)}…${s.addr.slice(-4)}`;
  const unscoredList = s.unscoredCollections.length > 0
    ? `<details style="margin-top:8px;"><summary style="cursor:pointer; font-size:0.78rem; color:var(--text-muted);">${s.unscoredCollections.length} collection${s.unscoredCollections.length === 1 ? '' : 's'} not scored</summary>
        <ul style="margin:6px 0 0 18px; font-size:0.75rem; color:var(--text-muted);">
          ${s.unscoredCollections.map(c => `<li><a href="https://opensea.io/collection/${encodeURIComponent(c.slug)}" target="_blank" rel="noopener" style="color:var(--accent);">${escapeHtml(c.name)}</a> &mdash; ${c.count} item${c.count === 1 ? '' : 's'} (${escapeHtml(c.reason)})</li>`).join('')}
        </ul>
      </details>`
    : '';
  const skippedNote = s.skippedCollectionsCount > 0
    ? `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:6px;">Only the top ${s.collectionsScanned} collections by holding count were scanned &mdash; ${s.skippedCollectionsCount} additional collection${s.skippedCollectionsCount === 1 ? '' : 's'} (${s.skippedCollectionItems} item${s.skippedCollectionItems === 1 ? '' : 's'}) weren't processed.</div>`
    : '';
  el.innerHTML = `
    <div class="panel-title">Portfolio &middot; ${escapeHtml(shortAddr)}</div>
    <div style="display:flex; gap:18px; flex-wrap:wrap; align-items:baseline;">
      <div><span style="font-size:1.6rem; font-weight:700;">${s.walletNfts}</span> <span style="font-size:0.75rem; color:var(--text-muted);">items</span></div>
      <div><span style="font-size:1.2rem; font-weight:600;">${s.collectionsTotal}</span> <span style="font-size:0.75rem; color:var(--text-muted);">collections</span></div>
      <div style="flex:1;"></div>
      <div style="font-size:0.82rem;">
        <span style="color:var(--score-high); font-weight:600;">${s.buckets.tier}</span> <span style="color:var(--text-muted);">tier-scored</span>
        &middot; <span style="color:var(--score-low); font-weight:600;">${s.buckets.unscored}</span> <span style="color:var(--text-muted);">unscored</span>
        <span style="color:var(--text-muted);">(${pctScored}% scored overall)</span>
      </div>
    </div>
    <div style="font-size:0.72rem; color:var(--text-muted); margin-top:6px; line-height:1.5;">
      Custom tier scores are grouped by collection, not ranked across collections. Partial data is labelled on each item.
      OpenSea ranks are shown separately and never converted into trait points. Missing/pair bonuses are not inferred from wallet holdings.
    </div>
    ${skippedNote}
    ${unscoredList}
  `;
  el.style.display = '';
}

function clearPortfolioSummary() {
  const el = document.getElementById('portfolioSummary');
  if (el) { el.style.display = 'none'; el.innerHTML = ''; }
}

// ─── Portfolio (score a wallet's holdings across collections) ───
async function analyzePortfolio() {
  if (isRunning) return;
  hideError();
  const apiKey = getApiKey(), input = document.getElementById('walletInput').value.trim();
  if (!apiKey || !input) { showError('Enter an API key and an Ethereum wallet address, ENS name, or OpenSea username.'); return; }
  let thresholds, points;
  try { ({ thresholds, points } = beginConfig()); } catch (e) { showError(e.message); return; }
  clearResultView(); cachedFetchData = null;
  isRunning = true; viewingPortfolio = true;
  const btn = document.getElementById('portfolioBtn');
  btn.disabled = true; btn.textContent = 'Scoring...';
  abortController = new AbortController(); showProgress();
  compareResult = null; renderCompareStats(); clearPortfolioSummary(); refreshSnapshotsPanel();
  document.getElementById('weightsPanel').style.display = 'none';
  document.getElementById('resultsGrid').innerHTML = '';
  document.getElementById('resultsTable').innerHTML = '';
  document.getElementById('resultsHeader').classList.remove('visible');
  try {
    let addr = input;
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) addr = (await apiGet(`/api/v2/accounts/resolve/${encodeURIComponent(input)}`, apiKey)).address;
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr || '')) throw new Error('This Portfolio view supports Ethereum addresses only.');
    const base = `/api/v2/chain/ethereum/account/${encodeURIComponent(addr)}/nfts?limit=200`;
    let url = base;
    const seen = new Set(), nftsById = new Map();
    do {
      const data = await apiGet(url, apiKey);
      for (const nft of data.nfts || []) if (nft.contract) nftsById.set(itemKey({ chain: 'ethereum', contractAddress: nft.contract, tokenId: nft.identifier }), nft);
      url = nextPage(base, data.next, seen);
      if (nftsById.size >= 10000 && url) { warn('Portfolio stopped at 10,000 NFTs; this is a partial wallet scan.'); break; }
      setProgress(20, `Fetched ${nftsById.size} Ethereum NFTs...`);
    } while (url);
    const nfts = [...nftsById.values()];
    if (!nfts.length) throw new Error('No Ethereum NFTs found for this wallet.');
    const groups = new Map();
    for (const nft of nfts) { const slug = nft.collection; if (!slug) continue; if (!groups.has(slug)) groups.set(slug, []); groups.get(slug).push(nft); }
    const slugs = [...groups.keys()].sort((a, b) => groups.get(b).length - groups.get(a).length), topSlugs = slugs.slice(0, 25);
    if (!topSlugs.length) throw new Error('Wallet NFTs were returned without collection identifiers; no trustworthy portfolio score is available.');
    const portfolioItems = [], unscoredCollections = [], buckets = { tier: 0, rank: 0, unscored: 0 };
    // No collection-wide corpus is fetched for each wallet collection. These bonuses cannot be inferred from holdings.
    if (runConfig.scoreMissing || runConfig.scorePairs) warn('Portfolio omits missing/pair bonuses: wallet holdings are not a complete collection population.');
    const portfolioConfig = { ...runConfig, scoreMissing: false, scorePairs: false };
    for (const [index, slug] of topSlugs.entries()) {
      abortController.signal.throwIfAborted();
      setProgress(35 + index / topSlugs.length * 60, `Scoring ${slug}...`);
      let colData = { name: slug, total_supply: 0 }, counts = parseTraitCounts({}, 0);
      try {
        colData = await apiGet(`/api/v2/collections/${encodeURIComponent(slug)}`, apiKey);
        counts = parseTraitCounts(await apiGet(`/api/v2/traits/${encodeURIComponent(slug)}`, apiKey), colData.total_supply);
      } catch (e) { if (e.name === 'AbortError') throw e; warn(`${slug}: collection frequencies unavailable.`); }
      const items = groups.get(slug).map(nft => normalizeNFT(nft, { chain: 'ethereum', owner: addr, collectionSlug: slug, collectionName: colData.name || slug }));
      try { await enrichItems(items, 'ethereum', '', apiKey, 35, 90); }
      catch (e) { if (e.name === 'AbortError') throw e; warn(`${slug}: incomplete NFT metadata.`); }
      const scored = items.map(item => scoreNFT(item, counts, colData.total_supply, portfolioConfig, null));
      const unscored = scored.filter(i => i.scoringMethod === 'Unscored').length;
      buckets.tier += scored.length - unscored; buckets.unscored += unscored;
      if (unscored) unscoredCollections.push({ slug, name: colData.name || slug, count: unscored, reason: 'no usable categorical frequencies or NFT traits; OpenSea rank shown separately when available' });
      portfolioItems.push(...scored);
    }
    renderPortfolioSummary({ walletNfts: nfts.length, collectionsScanned: topSlugs.length, collectionsTotal: slugs.length, skippedCollectionsCount: slugs.length - topSlugs.length, skippedCollectionItems: slugs.slice(25).reduce((n, slug) => n + groups.get(slug).length, 0), buckets, unscoredCollections, addr });
    if (portfolioItems.length) finishAnalysis(portfolioItems, nfts.length, 'portfolio', 'ethereum', '', thresholds, points);
    document.getElementById('statCountLabel').textContent = 'Fetched holdings';
    document.getElementById('statSupply').textContent = `${topSlugs.length}/${slugs.length} collections`;
  } catch (e) { showError(e.name === 'AbortError' ? 'Portfolio scoring cancelled.' : e.message); }
  finally { isRunning = false; btn.disabled = false; btn.textContent = 'Score Portfolio'; scheduleHideProgress(); }
}

// ─── Compare Tab (two-input self-contained comparison) ───
function getBonuses() {
  return { missing: numberSetting(document.getElementById('missingBonus').value, 1.5, 0, 10), combo: numberSetting(document.getElementById('comboBonus').value, 2, 0, 10) };
}
function getCurrentTierConfig() {
  const names = ['orange', 'purple', 'blue'], colors = ['#ff8c00', '#b77cce', '#3498db'];
  const defaults = [2, 5, 20], defaultPoints = [7, 3, 1];
  const tiers = validateTiers(currentTierMode === 'standard'
    ? names.map((name, i) => ({ name, color: colors[i], threshold: numberSetting(document.getElementById('thresh' + (i + 1)).value, defaults[i], 0, 100), points: numberSetting(document.getElementById('points' + (i + 1)).value, defaultPoints[i]) }))
    : getCustomTiers());
  return { thresholds: tiers.map(t => t.threshold), points: tiers.map(t => t.points), activeTiers: tiers };
}

async function verifyCompareSlug(slug, apiKey) {
  // Returns the colData when the slug resolves to a usable collection. Throws on any problem —
  // the caller distinguishes which slug failed by catching per-promise.
  const colData = await apiGet(`https://api.opensea.io/api/v2/collections/${slug}`, apiKey);
  const totalSupply = colData.total_supply || 0;
  const contracts = colData.contracts || [];
  const contractAddress = contracts[0]?.address || '';
  if (!totalSupply) throw new Error('missing total supply');
  if (!contractAddress) throw new Error('missing contract address');
  return colData;
}

async function analyzeCompareTab() {
  if (isRunning) return;
  hideError();
  const apiKey = getApiKey();
  if (!apiKey) { showError('Please enter your OpenSea API key first.'); return; }
  const slugA = parseSlug(document.getElementById('compareSlugA').value);
  const slugB = parseSlug(document.getElementById('compareSlugB').value);
  if (!slugA) { showError('Enter a valid Collection A slug.'); return; }
  if (!slugB) { showError('Enter a valid Collection B slug.'); return; }
  if (slugA === slugB) { showError('Collections A and B must differ.'); return; }

  let tierConfig;
  try { tierConfig = beginConfig(); } catch (e) { showError(e.message); return; }
  isRunning = true;
  const btn = document.getElementById('compareBtn');
  btn.disabled = true;
  btn.textContent = 'Verifying...';
  abortController = new AbortController();
  showProgress();
  document.getElementById('compareResultsArea').style.display = 'none';

  try {
    // Pre-flight: confirm BOTH slugs resolve before starting the heavy fetch. If either fails,
    // report specifically which one and abort without any partial rendering or wasted listing fetches.
    setProgress(3, 'Verifying both collections...');
    const verdicts = await Promise.allSettled([
      verifyCompareSlug(slugA, apiKey),
      verifyCompareSlug(slugB, apiKey)
    ]);
    abortController.signal.throwIfAborted();
    const failures = [];
    if (verdicts[0].status === 'rejected') failures.push(`"${slugA}" — ${verdicts[0].reason.message || 'not found'}`);
    if (verdicts[1].status === 'rejected') failures.push(`"${slugB}" — ${verdicts[1].reason.message || 'not found'}`);
    if (failures.length > 0) throw new Error('Could not verify collection' + (failures.length > 1 ? 's' : '') + ': ' + failures.join('; '));
    const colA = verdicts[0].value, colB = verdicts[1].value;

    btn.textContent = 'Comparing...';
    const A = await runCompareAnalysis(slugA, apiKey, tierConfig, 5, 48, colA);
    const B = await runCompareAnalysis(slugB, apiKey, tierConfig, 50, 98, colB);
    renderCompareTabResults(A, B);
    setProgress(PROGRESS.done, 'Compare complete!');
  } catch (e) {
    if (e.name === 'AbortError') showError('Compare cancelled.');
    else showError(e.message);
  } finally {
    isRunning = false;
    btn.disabled = false;
    btn.textContent = 'Compare';
    scheduleHideProgress();
  }
}

async function runCompareAnalysis(slug, apiKey, tierConfig, pStart, pEnd, prefetchedColData) {
  const span = pEnd - pStart;
  let colData = prefetchedColData;
  if (!colData) {
    setProgress(pStart, `[${slug}] fetching collection info...`);
    colData = await apiGet(`https://api.opensea.io/api/v2/collections/${slug}`, apiKey);
  }
  const totalSupply = colData.total_supply || 0;
  const contracts = colData.contracts || [];
  const chain = contracts[0]?.chain || 'ethereum';
  const contractAddress = contracts[0]?.address || '';
  if (!totalSupply) throw new Error(`${slug}: could not determine total supply`);
  if (!contractAddress) throw new Error(`${slug}: could not determine contract address`);

  setProgress(pStart + Math.round(span * 0.1), `[${slug}] fetching trait data...`);
  collectionContracts.set(slug, contracts);
  let traitCounts = {};
  try { traitCounts = parseTraitCounts(await apiGet(`/api/v2/traits/${encodeURIComponent(slug)}`, apiKey), totalSupply); }
  catch (e) { if (e.name === 'AbortError') throw e; }
  let baseline = null;
  if (!Object.keys(traitCounts).length || runConfig.scoreMissing || runConfig.scorePairs) {
    baseline = await fetchAllItems(slug, apiKey, totalSupply);
    if (baseline.some(i => !i.traitsKnown)) await enrichItems(baseline, chain, contractAddress, apiKey);
    const counts = countTraits(baseline, totalSupply);
    if (counts._meta.complete || !Object.keys(traitCounts).length) traitCounts = counts;
  }
  const items = await fetchListedItems(slug, chain, contractAddress, apiKey);
  if (!items.length) throw new Error(`${slug}: no listed items`);
  const pairCounts = baseline ? buildPairCounts(baseline, totalSupply) : null;
  const scored = items.map(item => scoreNFT(item, traitCounts, totalSupply, runConfig, pairCounts));

  const scores = scored.filter(i => i.scoringMethod !== 'Unscored').map(i => i.totalScore);
  const listed = scored.filter(i => i.price != null && i.price > 0);
  let floorPrice = null, floorCurrency = null;
  if (listed.length > 0 && new Set(listed.map(i => i.currencyKey || i.currency)).size === 1 && listed.every(i => i.priceComparable !== false)) {
    const f = listed.reduce((a, b) => a.price <= b.price ? a : b);
    floorPrice = f.price;
    floorCurrency = f.currency || 'ETH';
  }

  const minS = scores.length ? Math.min(...scores) : 0, maxS = scores.length ? Math.max(...scores) : 0;
  const sortedScores = [...scores].sort((a, b) => a - b);
  const median = sortedScores.length === 0 ? null
    : sortedScores.length % 2 === 0
      ? Math.round((sortedScores[sortedScores.length / 2 - 1] + sortedScores[sortedScores.length / 2]) / 2)
      : sortedScores[Math.floor(sortedScores.length / 2)];

  // "% in rarest tier" = share of listed items with at least one trait in the rarest-configured tier.
  // activeTiers is sorted by threshold ascending, so activeTiers[0] is the rarest band.
  const rarestTierName = activeTiers[0]?.name || 'orange';
  const rarestCount = scored.filter(it => it.mainTraits.some(t => t.status === 'known' && !t.isMissing && t.tier === rarestTierName)).length;
  const rarestTierPct = scores.length > 0 ? Math.round((rarestCount / scored.length) * 100) : null;

  const BINS = 12;
  const binWidth = Math.max(1, (maxS - minS) / BINS);
  const bins = Array(BINS).fill(0);
  for (const s of scores) {
    const idx = Math.min(Math.floor((s - minS) / binWidth), BINS - 1);
    bins[idx]++;
  }

  return {
    slug, totalSupply,
    name: colData.name || slug,
    imageUrl: colData.image_url || '',
    count: scored.length,
    coverage: Math.round(scored.filter(i => i.coverage === 1).length / scored.length * 100),
    source: traitCounts._meta?.source || 'Unavailable frequencies',
    warnings: [...runWarnings],
    topScore: maxS,
    avgScore: scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null,
    medianScore: median,
    lowScore: minS,
    rarestTierName,
    rarestTierPct,
    floorPrice, floorCurrency,
    histogram: { min: minS, max: maxS, bins }
  };
}

function renderCompareTabResults(A, B) {
  const el = document.getElementById('compareResultsArea');

  // Shared histogram axis — this is what makes the two cards actually comparable.
  const sMinRaw = Math.min(A.histogram?.min ?? Infinity, B.histogram?.min ?? Infinity);
  const sMaxRaw = Math.max(A.histogram?.max ?? -Infinity, B.histogram?.max ?? -Infinity);
  const sharedValid = isFinite(sMinRaw) && isFinite(sMaxRaw) && sMaxRaw > sMinRaw;
  const sMin = sharedValid ? sMinRaw : null;
  const sMax = sharedValid ? sMaxRaw : null;

  const rarestTierName = A.rarestTierName || B.rarestTierName || activeTiers[0]?.name || 'orange';
  const rarestTierColor = (activeTiers.find(t => t.name === rarestTierName) || {}).color || 'var(--score-high)';
  const isValidHex = isValidHexColor(rarestTierColor);
  const heroColor = isValidHex ? rarestTierColor : 'var(--score-high)';

  const cardFor = (r) => {
    const floor = r.floorPrice != null ? `${formatPrice(r.floorPrice)} ${escapeHtml(r.floorCurrency)}` : '—';
    const safeImg = r.imageUrl && r.imageUrl.startsWith('https://') ? r.imageUrl : '';
    const histHtml = renderMiniHistogram(r.histogram, sMin, sMax);
    return `
      <div class="compare-card">
        <h3>
          ${safeImg ? `<img src="${escapeHtml(safeImg)}" alt="" style="width:28px; height:28px; border-radius:4px; object-fit:cover;">` : ''}
          <span>${escapeHtml(r.name)}</span>
        </h3>
        <div class="col-sub"><a href="https://opensea.io/collection/${encodeURIComponent(r.slug)}" target="_blank" rel="noopener" style="color:var(--accent); text-decoration:none;">${escapeHtml(r.slug)}</a> &middot; ${r.totalSupply} items total &middot; ${r.count} listed</div>
        <p class="help-text">${r.coverage}% of listed NFTs have full trait coverage. ${escapeHtml(r.source)}.</p>
        <div style="padding:10px 0; border-top:1px solid var(--border); border-bottom:1px solid var(--border); text-align:center;">
          <div style="font-size:2rem; font-weight:800; line-height:1; color:${heroColor};">${r.rarestTierPct == null ? 'N/A' : r.rarestTierPct + '%'}</div>
          <div style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.8px; margin-top:2px;">in rarest tier (${escapeHtml(rarestTierName)})</div>
        </div>
        <div class="compare-stat-row">
          <div class="compare-stat"><div class="num">${r.medianScore ?? 'N/A'}</div><div class="lbl">Median (scored NFTs)</div></div>
          <div class="compare-stat"><div class="num">${floor}</div><div class="lbl">Floor</div></div>
        </div>
        ${histHtml ? `<div style="margin-top:2px;">${histHtml}</div>` : ''}
      </div>`;
  };

  const explainer = `
    <div style="grid-column:1 / -1; padding:8px 12px; background:var(--bg); border:1px dashed var(--border); border-radius:6px; margin-bottom:4px; font-size:0.78rem; color:var(--text-muted); line-height:1.5;">
      <strong style="color:var(--text);">How to read this:</strong>
      the headline <strong>% in rarest tier</strong> is the share of listed items with at least one trait in your currently-defined rarest band (${escapeHtml(rarestTierName)}).
      These are fetched listings, not random collection samples. Raw scores depend on each collection's trait structure; a higher score does not mean an NFT is rarer across collections. Missing frequencies are not rare traits. Floors are shown only when payment currencies are comparable.
      Histograms show custom point distributions on a shared point axis.
    </div>`;

  const summary = buildCompareSummary(A, B, rarestTierName);
  const summaryBlock = `
    <div style="grid-column:1 / -1; padding:10px 12px; margin-top:4px; background:var(--card-bg); border:1px solid var(--border); border-radius:6px; font-size:0.86rem; line-height:1.5;">
      ${summary}
    </div>`;

  el.innerHTML = explainer + cardFor(A) + cardFor(B) + summaryBlock;
  el.style.display = 'grid';
}

function buildCompareSummary(A, B) {
  const notes = [...new Set([...(A.warnings || []), ...(B.warnings || [])])];
  return 'Use this comparison to inspect each collection under the same rules, not to infer relative market value or multiply rarity. ' + notes.map(escapeHtml).join(' ');
}

// Renders a histogram, optionally on a caller-supplied shared axis (sharedMin/sharedMax).
// Shared axis is what makes two Compare-tab histograms visually comparable — a uniform
// collection (min===max) then renders as a single narrow bar at its position within the
// shared range, so the eye can compare shape across cards.
function renderMiniHistogram(h, sharedMin, sharedMax) {
  if (!h || !Array.isArray(h.bins) || h.bins.length === 0) return '';
  if (typeof h.min !== 'number' || typeof h.max !== 'number') return '';
  const W = 380, H = 40;
  const useShared = typeof sharedMin === 'number' && typeof sharedMax === 'number' && sharedMax > sharedMin;
  const axisMin = useShared ? sharedMin : h.min;
  const axisMax = useShared ? sharedMax : h.max;
  const axisSpan = axisMax - axisMin;
  if (axisSpan <= 0) return '';
  const maxCount = Math.max(...h.bins);
  if (maxCount <= 0) return '';
  const baseLine = `<line x1="0" y1="${H-0.5}" x2="${W}" y2="${H-0.5}" stroke="var(--border)" stroke-width="0.5"/>`;

  // Uniform distribution — every listed item has the same score. Show a single narrow bar at
  // the correct position within the axis so the eye still knows where this collection sits.
  if (h.min === h.max) {
    const frac = (h.min - axisMin) / axisSpan;
    const x = frac * W;
    const barW = Math.max(3, W / 60);
    const color = frac < 0.33 ? 'var(--score-low)' : frac < 0.66 ? 'var(--score-mid)' : 'var(--score-high)';
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="max-width:100%;" aria-label="All items score ${h.min}"><rect x="${Math.max(0, x - barW/2)}" y="0" width="${barW}" height="${H}" fill="${color}" rx="2"><title>All ${h.bins.reduce((s,v)=>s+v,0)} items score ${h.min}</title></rect>${baseLine}</svg>`;
  }

  const BINS = h.bins.length;
  const binOwnSpan = (h.max - h.min) / BINS;
  const binScreenW = (binOwnSpan / axisSpan) * W;
  const rects = h.bins.map((count, i) => {
    const hh = (count / maxCount) * H;
    const binLeft = h.min + i * binOwnSpan;
    const x = ((binLeft - axisMin) / axisSpan) * W;
    const ratio = ((binLeft + binOwnSpan / 2) - axisMin) / axisSpan;
    const color = ratio < 0.33 ? 'var(--score-low)' : ratio < 0.66 ? 'var(--score-mid)' : 'var(--score-high)';
    const lo = Math.round(binLeft), hi = Math.round(binLeft + binOwnSpan);
    return `<rect x="${x}" y="${H - hh}" width="${Math.max(1, binScreenW - 1)}" height="${hh}" fill="${color}" rx="2"><title>Score ${lo}-${hi}: ${count} items</title></rect>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="max-width:100%;">${rects}${baseLine}</svg>`;
}

function clearCompareTab() {
  document.getElementById('compareSlugA').value = '';
  document.getElementById('compareSlugB').value = '';
  const el = document.getElementById('compareResultsArea');
  el.style.display = 'none';
  el.innerHTML = '';
  hideError();
}

// Snapshot overlay (in Analyze tab results header) still uses compareResult + renderCompareStats.
function renderCompareStats() {
  const el = document.getElementById('compareStatsBar');
  if (!el) return;
  if (!compareResult) { el.style.display = 'none'; el.innerHTML = ''; return; }
  const c = compareResult;
  const floorHtml = c.floorPrice != null
    ? `<div class="stat" style="padding:2px 10px;"><div class="num" style="font-size:1rem;">${formatPrice(c.floorPrice)} ${escapeHtml(c.floorCurrency)}</div><div class="lbl">Floor</div></div>`
    : '';
  const histHtml = c.histogram ? renderMiniHistogram(c.histogram) : '';
  el.innerHTML = `
    <div style="display:flex; align-items:center; gap:6px; justify-content:center; flex-wrap:wrap;">
      <span style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px;">overlay</span>
      <strong style="font-size:0.82rem;">${escapeHtml(c.name)}</strong>
      <div class="stat" style="padding:2px 10px;"><div class="num" style="font-size:1rem;">${c.count}</div><div class="lbl">Items</div></div>
      <div class="stat" style="padding:2px 10px;"><div class="num" style="font-size:1rem;">${c.topScore}</div><div class="lbl">Top</div></div>
      <div class="stat" style="padding:2px 10px;"><div class="num" style="font-size:1rem;">${c.avgScore}</div><div class="lbl">Avg</div></div>
      <div class="stat" style="padding:2px 10px;"><div class="num" style="font-size:1rem;">${c.lowScore}</div><div class="lbl">Low</div></div>
      <div class="stat" style="padding:2px 10px;"><div class="num" style="font-size:1rem;">${c.totalSupply}</div><div class="lbl">Supply</div></div>
      ${floorHtml}
      <button class="btn btn-secondary" onclick="clearSnapshotOverlay()" style="padding:2px 8px; font-size:0.7rem;">&times; Clear</button>
    </div>
    ${histHtml ? `<div style="margin-top:4px; text-align:center; opacity:0.85;">${histHtml}</div>` : ''}
  `;
  el.style.display = 'block';
}

function clearSnapshotOverlay() {
  compareResult = null;
  renderCompareStats();
}

// ─── Scoring ───
function classifyTrait(pct, thresholds, points) {
  return classifyCore(pct, thresholds.map((threshold, i) => ({ threshold, points: points[i], name: activeTiers[i]?.name || 'tier' + i })));
}
function scoreItem(item, traitCounts, totalSupply, thresholds, points, allTraitTypes, scoreMissing, missingCountByType, scorePairs, pairCounts, missingBonus, comboBonus) {
  const config = runConfig || currentConfig();
  return scoreNFT(item, traitCounts, totalSupply, { ...config, scoreMissing, scorePairs, missingBonus, comboBonus }, pairCounts);
}

// ─── Rendering ───
function renderResults(items, totalSupply, slug, chain, contractAddress, thresholds, points, minScore, maxScore) {
  const scores = items.filter(i => i.scoringMethod !== 'Unscored').map(i => i.totalScore);
  document.getElementById('statCount').textContent = items.length;
  document.getElementById('statCountLabel').textContent = resultMode === 'listed' ? 'Listed Items' : 'Fetched Items';
  document.getElementById('statTop').textContent = !viewingPortfolio && scores.length ? Math.max(...scores) : '—';
  document.getElementById('statAvg').textContent = !viewingPortfolio && scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : '—';
  document.getElementById('statLow').textContent = !viewingPortfolio && scores.length ? Math.min(...scores) : '—';
  document.getElementById('statSupply').textContent = totalSupply;
  const floors = new Map();
  for (const i of items) if (i.price > 0 && i.priceComparable !== false) {
    const key = i.currencyKey || JSON.stringify([i.chain, i.currency]);
    if (!floors.has(key) || i.price < floors.get(key).price) floors.set(key, i);
  }
  document.getElementById('statFloor').textContent = [...floors.values()].map(i => `${formatPrice(i.price)} ${currencyLabel(i)}`).join(' · ');
  document.getElementById('statFloorWrap').style.display = floors.size ? '' : 'none';
  const currencies = new Map(items.filter(i => i.currency).map(i => [i.currencyKey || i.currency, currencyLabel(i)]));
  document.getElementById('filterCurrency').innerHTML = '<option value="">All currencies</option>' + [...currencies].map(([key, label]) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`).join('');
  for (const id of ['filterSearch', 'filterPriceMin', 'filterPriceMax']) document.getElementById(id).value = '';
  const available = items.filter(i => i.scoringMethod !== 'Unscored').length;
  const partial = items.filter(i => i.scoringMethod !== 'Unscored' && i.coverage < 1).length;
  const warnings = [...runWarnings];
  if (resultConfig.scoreMissing && items.some(i => !i.missingAvailable)) warnings.push('Missing-trait bonus unavailable for items without a complete baseline.');
  if (resultConfig.scorePairs && items.some(i => !i.pairsAvailable)) warnings.push('Pair bonus unavailable without a complete collection population.');
  if (items.some(i => i.priceComparable === false)) warnings.push('Some payment-token identities are unavailable; these prices are excluded from value/floor comparisons.');
  const provenance = document.getElementById('provenance');
  provenance.hidden = false;
  provenance.innerHTML = `<strong>${slug === 'demo' ? 'Synthetic demo · ' : ''}Custom weighted trait tiers · v${ENGINE_VERSION}</strong><br>${available}/${items.length} NFTs scored; ${partial} partial. ${viewingPortfolio ? 'Ethereum holdings; grouped by collection.' : `${items.length}/${totalSupply} NFTs fetched (${resultMode}).`} Config ${configFingerprint(resultConfig)}. Data fetched ${escapeHtml((viewingPortfolio ? null : cachedFetchData?.fetchedAt) || new Date().toISOString())}. ${escapeHtml([...new Set(items.map(i => i.source))].join('; '))}. ${warnings.map(escapeHtml).join(' ')}`;
  document.getElementById('resultsHeader').classList.add('visible');

  renderParams = { totalSupply, chain, contractAddress, minScore, maxScore };
  displayCount = PAGE_SIZE;
  filteredItems = null;
  renderHistogram(viewingPortfolio ? [] : items.filter(i => i.scoringMethod !== 'Unscored'));
  document.getElementById('filterPriceMin').disabled = true;
  document.getElementById('filterPriceMax').disabled = true;
  rerenderCurrentView();
}

function renderHistogram(items) {
  const el = document.getElementById('histogram');
  if (items.length < 3) { el.innerHTML = ''; return; }
  const scores = items.map(i => i.totalScore);
  const min = Math.min(...scores), max = Math.max(...scores);
  if (min === max) { el.innerHTML = ''; return; }
  const BINS = Math.min(12, max - min + 1);
  const binWidth = (max - min) / BINS;
  const bins = Array(BINS).fill(0);
  for (const s of scores) {
    const idx = Math.min(Math.floor((s - min) / binWidth), BINS - 1);
    bins[idx]++;
  }
  const maxCount = Math.max(...bins);
  const W = 400, H = 50, gap = 2;
  const barW = (W - gap * (BINS - 1)) / BINS;
  const rects = bins.map((count, i) => {
    const h = maxCount > 0 ? (count / maxCount) * H : 0;
    const x = i * (barW + gap);
    const ratio = i / (BINS - 1 || 1);
    const color = ratio < 0.33 ? 'var(--score-low)' : ratio < 0.66 ? 'var(--score-mid)' : 'var(--score-high)';
    const lo = Math.round(min + i * binWidth), hi = Math.round(min + (i + 1) * binWidth);
    return `<rect x="${x}" y="${H - h}" width="${barW}" height="${h}" fill="${color}" rx="2"><title>Score ${lo}-${hi}: ${count} items</title></rect>`;
  }).join('');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="max-width:100%;">${rects}</svg>`;
}

function getDisplayItems() {
  return filteredItems || scoredItems;
}

function rerenderCurrentView() {
  const items = getDisplayItems();
  const p = renderParams;
  const slice = items.slice(0, displayCount);
  if (currentView === 'cards') renderCards(slice, p.totalSupply, p.chain, p.contractAddress, p.minScore, p.maxScore);
  else renderTable(slice, p.totalSupply, p.chain, p.contractAddress, p.minScore, p.maxScore);
  updateShowMore();
}

function showMore() {
  if (isRunning) return;
  displayCount += PAGE_SIZE;
  rerenderCurrentView();
}

function updateShowMore() {
  const items = getDisplayItems();
  const wrap = document.getElementById('showMoreWrap');
  const count = document.getElementById('showMoreCount');
  const btn = wrap.querySelector('button');
  if (displayCount < items.length) {
    wrap.style.display = 'block';
    btn.style.display = '';
    count.textContent = `Showing ${Math.min(displayCount, items.length)} of ${items.length}` + (filteredItems ? ` (${scoredItems.length} total)` : '');
  } else if (items.length > PAGE_SIZE) {
    wrap.style.display = 'block';
    btn.style.display = 'none';
    count.textContent = `Showing all ${items.length} items`;
  } else {
    wrap.style.display = 'none';
  }
}

function renderCards(items, totalSupply, chain, contractAddress, minScore, maxScore) {
  const grid = document.getElementById('resultsGrid');
  grid.innerHTML = items.map((item, idx) => {
    const itemChain = item.chain || chain;
    const itemContract = item.contractAddress || contractAddress;
    const itemSupply = item.totalSupply || totalSupply;
    return `
    <div class="item-card${item.isBargain ? ' bargain' : ''}">
      <div class="item-header">
        <div class="item-header-left">
          ${item.image && item.image.startsWith('https://') ? `<img class="item-thumb" src="${escapeHtml(item.image)}" alt="" loading="lazy">` : ''}
          <div>
          <div class="item-name"><span class="item-idx">#${idx + 1}</span> ${escapeHtml(item.name)}</div>
          ${item.collectionName ? `<div style="font-size:0.72rem; color:var(--text-muted);">from <a href="https://opensea.io/collection/${encodeURIComponent(item.collectionSlug)}" target="_blank" rel="noopener" style="color:var(--accent);">${escapeHtml(item.collectionName)}</a></div>` : ''}
          <div class="item-badges">
            ${item.isBargain ? '<span class="badge badge-bargain">High score / lower price</span>' : ''}
          </div>
          <div class="item-rank">OS Rarity: ${item.rarityRank || 'N/A'} / ${itemSupply}</div>
          <div class="item-price">${item.price != null ? `<span class="eth">${formatPrice(item.price)} ${escapeHtml(item.currency)}</span>` : `<span style="color:var(--text-muted)">${item.mixedCurrencies ? 'Multiple payment currencies' : 'Price unavailable'}</span>`}</div>
          ${item.owner ? `<div class="item-owner">Owner: ${ownerLinkHtml(item)}</div>` : ''}
          ${item.valueScore != null ? `<div class="value-ratio">Score/price: ${item.valueScore} pts/${escapeHtml(item.currency)}</div>` : ''}
          </div>
        </div>
        <div class="item-score" style="color:${item.scoreColor}">
          ${item.scoringMethod === 'Unscored' ? '—' : item.totalScore}
          <div class="score-method">${escapeHtml(item.scoringMethod)}${item.coverage < 1 && item.scoringMethod !== 'Unscored' ? ' · partial' : ''}</div>
          <div class="score-breakdown">
            ${(resultConfig?.tiers || activeTiers).map(t => `<span style="color:${t.color}">${item.tierCounts[t.name] || 0} ${escapeHtml(t.name)}</span>`).join(' · ')}
          </div>
        </div>
      </div>
      <div class="traits-section">
        <div class="traits-label">Main Traits</div>
        <div class="traits-grid">
          ${item.mainTraits.length === 0 ? '<span style="color:var(--text-muted); font-size:0.8rem;">No traits available</span>' : ''}
          ${[...item.mainTraits].sort((a, b) => b.points - a.points || a.pct - b.pct).map(t => `
            <div class="trait-tag" style="${traitTagStyle(t.tier)}">
              <span class="trait-type">${escapeHtml(t.type)}</span>
              <span class="trait-value">${escapeHtml(t.value)}</span>
              <span class="trait-pct">${t.status === 'known' ? t.pct + '% (' + t.count + '/' + itemSupply + ')' : t.status === 'excluded' ? 'Excluded from scoring' : 'Frequency unavailable'}${t.points > 0 ? ' +' + t.points : ''}</span>
            </div>`).join('')}
        </div>
      </div>
      ${item.pairScores && item.pairScores.length > 0 ? `
      <div class="traits-section" style="margin-top:8px;">
        <div class="traits-label">Rare Combinations (top ${item.pairScores.length})</div>
        <div class="traits-grid">
          ${item.pairScores.map(p => `
            <div class="trait-tag" style="${traitTagStyle(p.tier)}" title="${escapeHtml(p.a.type + ': ' + p.a.value + ' + ' + p.b.type + ': ' + p.b.value)} — ${p.count} items (${p.pct}%)">
              <span class="trait-type">${escapeHtml(p.a.type)} + ${escapeHtml(p.b.type)}</span>
              <span class="trait-value">${escapeHtml(p.a.value)} &amp; ${escapeHtml(p.b.value)}</span>
              <span class="trait-pct">${p.pct}% +${p.points}</span>
            </div>`).join('')}
        </div>
      </div>` : ''}
      ${item.specialTraits.length > 0 ? `
      <div class="special-traits">
        <button class="special-toggle" onclick="toggleSpecial(this)">&#9656; Show ${item.specialTraits.length} Scoring Special Traits</button>
        <div class="special-content">
          ${[...item.specialTraits].sort((a, b) => b.points - a.points || a.pct - b.pct).map(t => `
            <div class="trait-tag" style="${traitTagStyle(t.tier)}">
              <span class="trait-type">${escapeHtml(t.type.replace(/^_/, ''))}</span>
              <span class="trait-value">${escapeHtml(t.value)}</span>
              <span class="trait-pct">${t.pct}% +${t.points}</span>
            </div>`).join('')}
        </div>
      </div>` : ''}
      ${item.demo ? '<span class="score-method">Synthetic example — no marketplace listing</span>' : `<a class="opensea-link" href="${openSeaItemUrl(itemChain, itemContract, item.tokenId)}" target="_blank" rel="noopener">View on OpenSea &#8599;</a>`}
    </div>
  `;
  }).join('');
}

function renderTable(items, totalSupply, chain, contractAddress, minScore, maxScore) {
  const el = document.getElementById('resultsTable');
  el.innerHTML = `<table>
    <caption class="score-method">Custom trait scores. Expand an NFT name to inspect its traits.</caption>
    <thead><tr>
      <th>#</th>
      <th></th>
      <th scope="col" aria-sort="${currentSort === 'score' ? (currentSortDir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button onclick="sortResults('score')">Score</button></th>
      <th scope="col" aria-sort="${currentSort === 'value' ? (currentSortDir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button onclick="sortResults('value')">Score/price</button></th>
      <th scope="col" aria-sort="${currentSort === 'price' ? (currentSortDir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button onclick="sortResults('price')">Price</button></th>
      <th>Name</th>
      <th scope="col" aria-sort="${currentSort === 'owner' ? (currentSortDir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button onclick="sortResults('owner')">Owner</button></th>
      <th scope="col" aria-sort="${currentSort === 'rarity' ? (currentSortDir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button onclick="sortResults('rarity')">OS Rank</button></th>
      <th>Tiers</th>
      <th></th>
    </tr></thead>
    <tbody>
    ${items.map((item, idx) => {
      const itemChain = item.chain || chain;
      const itemContract = item.contractAddress || contractAddress;
      return `
      <tr class="expandable${item.isBargain ? ' bargain-row' : ''}">
        <td><span class="tbl-idx">${idx + 1}</span></td>
        <td>${item.image && item.image.startsWith('https://') ? `<img class="tbl-thumb" src="${escapeHtml(item.image)}" alt="" loading="lazy">` : ''}</td>
        <td class="score-cell" style="color:${item.scoreColor}">${item.scoringMethod === 'Unscored' ? '—' : item.totalScore}</td>
        <td>${item.valueScore != null ? item.valueScore : '—'}</td>
        <td class="price-cell">${item.price != null ? formatPrice(item.price) + ' ' + escapeHtml(item.currency) : '—'}</td>
        <td><button class="row-toggle" aria-expanded="false" aria-controls="expand-${idx}" onclick="toggleTableRow(this.closest('tr'))">${escapeHtml(item.name)}</button><div class="score-method">${escapeHtml(item.scoringMethod)} · ${Math.round(item.coverage * 100)}% coverage</div>${item.collectionName ? ` <span style="color:var(--text-muted); font-size:0.72rem;">· ${escapeHtml(item.collectionName)}</span>` : ''}${item.isBargain ? ' <span class="badge badge-bargain">High score / lower price</span>' : ''}</td>
        <td>${ownerLinkHtml(item, ' onclick="event.stopPropagation()"')}</td>
        <td>${item.rarityRank || 'N/A'}</td>
        <td><div class="tier-dots">
          ${(resultConfig?.tiers || activeTiers).map(t => `<span style="color:${t.color}">${item.tierCounts[t.name] || 0}</span>`).join('/')}
        </div></td>
        <td>${item.demo ? 'Demo' : `<a aria-label="View ${escapeHtml(item.name)} on OpenSea" href="${openSeaItemUrl(itemChain, itemContract, item.tokenId)}" target="_blank" rel="noopener">&#8599;</a>`}</td>
      </tr>
      <tr class="expand-row" id="expand-${idx}">
        <td colspan="10" class="expand-cell">
          <div class="traits-grid">
            ${[...item.mainTraits].sort((a, b) => b.points - a.points || a.pct - b.pct).map(t => `
              <div class="trait-tag" style="${traitTagStyle(t.tier)}">
                <span class="trait-type">${escapeHtml(t.type)}</span>
                <span class="trait-value">${escapeHtml(t.value)}</span>
                <span class="trait-pct">${t.status === 'known' ? t.pct + '%' : t.status === 'excluded' ? 'Excluded' : 'Frequency unavailable'}${t.points > 0 ? ' +' + t.points : ''}</span>
              </div>`).join('')}
          </div>
        </td>
      </tr>
    `;
    }).join('')}
    </tbody></table>`;
}

function toggleSpecial(btn) {
  const content = btn.nextElementSibling;
  const isOpen = content.classList.toggle('open');
  const count = content.children.length;
  btn.innerHTML = isOpen ? `&#9662; Hide ${count} Scoring Special Traits` : `&#9656; Show ${count} Scoring Special Traits`;
}

function toggleTableRow(row) {
  const tokenId = row.nextElementSibling?.id?.replace('expand-', '');
  if (tokenId != null) { const open = row.nextElementSibling.classList.toggle('open'); row.querySelector('.row-toggle')?.setAttribute('aria-expanded', String(open)); }
}

// ─── Sorting ───
function sortResults(field) {
  if (field === currentSort) currentSortDir = currentSortDir === 'desc' ? 'asc' : 'desc';
  else { currentSort = field; currentSortDir = (field === 'rarity' || field === 'owner') ? 'asc' : 'desc'; }
  document.querySelectorAll('.sort-btn[data-sort]').forEach(b => {
    if (b.dataset.sort !== 'toggle') b.classList.toggle('active', b.dataset.sort === field);
  });
  applySorting();
}
function toggleSortDir() { currentSortDir = currentSortDir === 'desc' ? 'asc' : 'desc'; applySorting(); }

function applySorting() {
  const cmp = makeSortFn(currentSort, currentSortDir);
  scoredItems.sort(cmp);
  if (filteredItems) filteredItems.sort(cmp);
  displayCount = PAGE_SIZE;
  rerenderCurrentView();
}

function makeSortFn(field, dir) {
  return (a, b) => {
    const value = i => field === 'owner' ? i.ownerName || i.owner || null : field === 'price' ? i.price : field === 'value' ? i.valueScore : field === 'rarity' ? i.rarityRank : i.scoringMethod === 'Unscored' ? null : i.totalScore;
    const va = value(a), vb = value(b);
    if (va == null || vb == null) return va == null ? vb == null ? 0 : 1 : -1;

    if (viewingPortfolio) { const group = (a.collectionSlug || '').localeCompare(b.collectionSlug || ''); if (group) return group; }
    if (field === 'price' || field === 'value') {
      const group = (a.currencyKey || a.currency || '').localeCompare(b.currencyKey || b.currency || '');
      if (group) return group;
      if (a.priceComparable === false || b.priceComparable === false) return itemKey(a).localeCompare(itemKey(b));
    }
    const comparison = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return dir === 'desc' ? -comparison : comparison;
  };
}

// ─── Filtering ───
function applyFilters() {
  const search = (document.getElementById('filterSearch').value || '').toLowerCase().trim();
  const minP = parseFloat(document.getElementById('filterPriceMin').value);
  const maxP = parseFloat(document.getElementById('filterPriceMax').value);
  const currency = document.getElementById('filterCurrency').value;
  const allowed = !!currency && scoredItems.filter(i => (i.currencyKey || i.currency) === currency).every(i => i.priceComparable !== false);
  document.getElementById('filterPriceMin').disabled = !allowed;
  document.getElementById('filterPriceMax').disabled = !allowed;
  const hasFilter = search || currency || (allowed && (!isNaN(minP) || !isNaN(maxP)));
  if (!hasFilter) { filteredItems = null; displayCount = PAGE_SIZE; rerenderCurrentView(); return; }
  filteredItems = scoredItems.filter(item => {
    if (currency && (item.currencyKey || item.currency) !== currency) return false;
    if (search) {
      const hay = [item.name, item.ownerName || '', item.owner || '', ...item.mainTraits.map(t => t.type + ' ' + t.value)].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (allowed && !isNaN(minP) && (item.price == null || item.price < minP)) return false;
    if (allowed && !isNaN(maxP) && (item.price == null || item.price > maxP)) return false;
    return true;
  });
  displayCount = PAGE_SIZE;
  rerenderCurrentView();
}

function clearFilters() {
  document.getElementById('filterCurrency').value = '';
  document.getElementById('filterPriceMin').disabled = true;
  document.getElementById('filterPriceMax').disabled = true;
  document.getElementById('filterSearch').value = '';
  document.getElementById('filterPriceMin').value = '';
  document.getElementById('filterPriceMax').value = '';
  filteredItems = null;
  displayCount = PAGE_SIZE;
  rerenderCurrentView();
}

// ─── CSV Export ───
function csvSafe(val) {
  let s = String(val == null ? '' : val);
  // Prevent formula injection in spreadsheets
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  // Escape double quotes and wrap if contains comma, quote, or newline
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function exportCSV() {
  const exportItems = getDisplayItems();
  if (exportItems.length === 0) return;
  const tierHeaders = (resultConfig?.tiers || activeTiers).map(t => csvSafe(t.name + ' Traits'));
  const headers = ['Position', 'Name', 'Token ID', 'Score', 'Score per quoted currency unit', 'Price', 'Currency', 'Owner', 'OS Rarity Rank', ...tierHeaders, 'High score lower price', 'OpenSea URL', 'Chain', 'Contract', 'Scoring method', 'Trait coverage', 'Engine', 'Config fingerprint', 'Frequency source'];
  const rows = exportItems.map((item, idx) => [
    idx + 1, csvSafe(item.name), csvSafe(item.tokenId), item.scoringMethod === 'Unscored' ? '' : item.totalScore,
    item.valueScore ?? '', item.price != null ? formatPrice(item.price) : '',
    csvSafe(item.currency), csvSafe(item.ownerName || item.owner || ''), item.rarityRank || '',
    ...(resultConfig?.tiers || activeTiers).map(t => item.tierCounts[t.name] || 0),
    item.isBargain ? 'Yes' : '', item.demo ? '' : csvSafe(openSeaItemUrl(item.chain || '', item.contractAddress || '', item.tokenId)),
    csvSafe(item.chain), csvSafe(item.contractAddress), csvSafe(item.scoringMethod), item.coverage, ENGINE_VERSION, csvSafe(configFingerprint(resultConfig)), csvSafe(item.source)
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rarity_scores_${parseSlug(document.getElementById('collectionInput').value) || 'export'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Snapshots (per-collection, localStorage) ───
const SNAPSHOT_KEY = 'nft_scorer_snapshots';
const SNAPSHOT_MAX_PER_COLLECTION = 50;

function getSnapshotsAll() {
  try {
    const raw = preferences.getItem(SNAPSHOT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function setSnapshotsAll(all) {
  try { preferences.setItem(SNAPSHOT_KEY, JSON.stringify(all)); }
  catch (e) { console.warn('Snapshot save failed:', e.message); }
}

function toggleSnapshotsPanel() {
  const content = document.getElementById('snapshotsContent');
  const icon = document.getElementById('snapshotsToggleIcon');
  const open = content.style.display === 'none';
  content.style.display = open ? 'block' : 'none';
  icon.innerHTML = open ? '&#9662;' : '&#9656;';
  document.getElementById(icon.id === 'weightsToggleIcon' ? 'weightsDisclosure' : 'snapshotsDisclosure').setAttribute('aria-expanded', String(open));
  if (open) renderSnapshotList();
}

function saveSnapshot() {
  if (isRunning || viewingPortfolio || !cachedFetchData || !scoredItems || scoredItems.length === 0) {
    showError('Analyze a primary collection first.');
    return;
  }
  const slug = cachedFetchData.slug;
  const scores = scoredItems.filter(i => i.scoringMethod !== 'Unscored').map(i => i.totalScore);
  if (!scores.length) { showError('No scorable NFT data to save as a score snapshot.'); return; }
  const listed = scoredItems.filter(i => i.price != null && i.price > 0);
  let floorPrice = null, floorCurrency = null;
  if (listed.length > 0 && new Set(listed.map(i => i.currencyKey || i.currency)).size === 1 && listed.every(i => i.priceComparable !== false)) {
    const f = listed.reduce((a, b) => a.price <= b.price ? a : b);
    floorPrice = f.price;
    floorCurrency = f.currency || 'ETH';
  }
  const min = Math.min(...scores), max = Math.max(...scores);
  const BINS = 12;
  const binWidth = Math.max(1, (max - min) / BINS);
  const bins = Array(BINS).fill(0);
  for (const s of scores) {
    const idx = Math.min(Math.floor((s - min) / binWidth), BINS - 1);
    bins[idx]++;
  }
  const snap = {
    t: Date.now(),
    engine: ENGINE_VERSION,
    config: configFingerprint(resultConfig),
    source: cachedFetchData.traitCounts._meta?.source,
    fetchedAt: cachedFetchData.fetchedAt,
    fullCoverage: scoredItems.filter(i => i.coverage === 1).length,
    scoredCount: scores.length,
    slug,
    name: (document.getElementById('colName').textContent || slug).trim(),
    mode: resultMode,
    count: scoredItems.length,
    totalSupply: cachedFetchData.totalSupply,
    topScore: max,
    avgScore: scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null,
    lowScore: min,
    floorPrice, floorCurrency,
    histogram: { min, max, bins }
  };
  const all = getSnapshotsAll();
  if (!all[slug]) all[slug] = [];
  all[slug].unshift(snap);
  if (all[slug].length > SNAPSHOT_MAX_PER_COLLECTION) all[slug] = all[slug].slice(0, SNAPSHOT_MAX_PER_COLLECTION);
  setSnapshotsAll(all);
  renderSnapshotList();
  refreshSnapshotsPanel();
}

function renderSnapshotList() {
  const slug = cachedFetchData?.slug;
  const el = document.getElementById('snapshotList');
  if (!el) return;
  if (!slug) { el.innerHTML = ''; return; }
  const all = getSnapshotsAll();
  const list = all[slug] || [];
  if (list.length === 0) {
    el.innerHTML = '<span style="color:var(--text-muted); font-size:0.75rem;">No snapshots yet for this collection.</span>';
    return;
  }
  el.innerHTML = list.map((s, i) => {
    const date = new Date(s.t).toLocaleString();
    const floor = s.floorPrice != null ? `${formatPrice(s.floorPrice)} ${escapeHtml(s.floorCurrency)}` : '—';
    return `<div style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom: 1px solid var(--border); font-size:0.75rem;">
      <span style="color:var(--text-muted); min-width:150px;">${escapeHtml(date)}</span>
      <span>avg ${s.avgScore}, top ${s.topScore}, floor ${floor}, ${s.count} items (${escapeHtml(s.mode)})</span>
      <button class="btn btn-secondary" onclick="loadSnapshot(${i})" style="font-size:0.7rem; padding:2px 8px; margin-left:auto;" title="Show this snapshot in the compare stats row">Overlay</button>
      <button class="btn btn-secondary" onclick="deleteSnapshot(${i})" style="font-size:0.7rem; padding:2px 8px; color:var(--danger);" title="Delete">&times;</button>
    </div>`;
  }).join('');
}

function loadSnapshot(idx) {
  const slug = cachedFetchData?.slug;
  if (!slug) return;
  const all = getSnapshotsAll();
  const list = all[slug] || [];
  const s = list[idx];
  if (!s) return;
  if (s.count !== scoredItems.length || s.scoredCount !== scoredItems.filter(i => i.scoringMethod !== 'Unscored').length || s.config !== configFingerprint(resultConfig) || s.mode !== resultMode || s.totalSupply !== cachedFetchData.totalSupply || s.source !== cachedFetchData.traitCounts._meta?.source || s.fullCoverage !== scoredItems.filter(i => i.coverage === 1).length) {
    showError('Snapshot is incompatible: configuration, engine, population, coverage, or frequency source differs. Older snapshots without provenance cannot be overlaid.'); return;
  }
  const date = new Date(s.t).toLocaleString();
  compareResult = {
    slug: s.slug,
    name: `${s.name} @ ${date}`,
    count: s.count,
    totalSupply: s.totalSupply,
    topScore: s.topScore,
    avgScore: s.avgScore,
    lowScore: s.lowScore,
    floorPrice: s.floorPrice,
    floorCurrency: s.floorCurrency,
    histogram: s.histogram // pulled through for visual overlay in renderCompareStats
  };
  renderCompareStats();
}

function deleteSnapshot(idx) {
  const slug = cachedFetchData?.slug;
  if (!slug) return;
  const all = getSnapshotsAll();
  if (!all[slug]) return;
  all[slug].splice(idx, 1);
  if (all[slug].length === 0) delete all[slug];
  setSnapshotsAll(all);
  renderSnapshotList();
  refreshSnapshotsPanel();
}

function refreshSnapshotsPanel() {
  const slug = cachedFetchData?.slug;
  const panel = document.getElementById('snapshotsPanel');
  const countEl = document.getElementById('snapshotsCount');
  if (!panel) return;
  if (!slug || viewingPortfolio) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = '';
  const all = getSnapshotsAll();
  const count = (all[slug] || []).length;
  countEl.textContent = count === 0 ? '' : `(${count})`;
}

// ─── Config Export / Import ───
function buildConfigJSON() {
  const c = currentConfig(), tiers = c.tiers;
  return { v: 2, engine: ENGINE_VERSION, exported_at: new Date().toISOString(),
    slug: parseSlug(document.getElementById('collectionInput').value), mode: currentMode, tier_mode: currentTierMode,
    score_missing: c.scoreMissing, score_pairs: c.scorePairs, missing_bonus: c.missingBonus, combo_bonus: c.comboBonus,
    thumbs_visible: thumbsVisible, active_tab: document.querySelector('.tab-btn.active')?.dataset.tab || 'analyze',
    ...(currentTierMode === 'standard' ? { standard_tiers: { thresholds: tiers.map(t => t.threshold), points: tiers.map(t => t.points) } } : { custom_tiers: tiers }),
    trait_weights: Object.fromEntries([...c.weights].filter(([, w]) => w !== 1)) };
}

function exportConfig() {
  let config;
  try { config = buildConfigJSON(); } catch (e) { showError(e.message); return; }
  const json = JSON.stringify(config, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const slugPart = config.slug ? `_${config.slug}` : '';
  a.download = `nft_scorer_config${slugPart}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importConfig(file) {
  try {
    if (file.size > 100000) throw new Error('Config files must be smaller than 100 KB.');
    const text = await file.text();
    const config = JSON.parse(text);
    if (!config || typeof config !== 'object') throw new Error('Config file is not a JSON object');
    applyImportedConfig(config);
    hideError();
  } catch (e) {
    showError('Failed to import config: ' + e.message);
  }
}

function applyImportedConfig(input) {
  if (isRunning) throw new Error('Wait for the current analysis or cancel it before importing settings.');
  const config = validateConfig(input); // Validate everything before changing any control.
  if (typeof config.slug === 'string') document.getElementById('collectionInput').value = config.slug;
  setMode(config.mode); setTierMode(config.tier_mode);
  if (config.tier_mode === 'standard') config.tiers.forEach((t, i) => {
    document.getElementById('thresh' + (i + 1)).value = t.threshold;
    document.getElementById('points' + (i + 1)).value = t.points;
    if (i < 2) document.getElementById('thresh' + (i + 1) + '_upper').value = t.threshold;
  });
  else {
    document.getElementById('customTiers').innerHTML = '';
    for (const t of config.tiers) addCustomTier(t.name, t.threshold, t.points, t.color);
  }
  document.getElementById('scoreMissing').checked = config.score_missing;
  document.getElementById('scorePairs').checked = config.score_pairs;
  document.getElementById('missingBonus').value = config.missing_bonus;
  document.getElementById('comboBonus').value = config.combo_bonus;
  traitWeights = config.weights;
  document.querySelectorAll('.weight-input').forEach(i => { i.value = traitWeights.get(i.dataset.type) ?? 1; });
  if (typeof config.thumbs_visible === 'boolean' && config.thumbs_visible !== thumbsVisible) toggleThumbs();
  if (config.active_tab) setTab(config.active_tab);
  if (cachedFetchData && !viewingPortfolio && cachedFetchData.slug === config.slug && resultMode === config.mode) reScoreWithWeights();
}

function handleImportFile(event) {
  const file = event.target.files && event.target.files[0];
  if (file) importConfig(file);
  // Allow re-selecting the same file later
  event.target.value = '';
}

// ─── Copy shareable URL ───
async function copyShareableUrl() {
  const btn = document.getElementById('copyUrlBtn');
  try {
    // location.href is read from the tab itself — no cross-origin access.
    // Requires a secure context (https / localhost); the GitHub Pages deploy is https.
    encodeStateToURL();
    await navigator.clipboard.writeText(location.href);
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      btn.disabled = true;
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1500);
    }
  } catch (e) {
    showError('Copy failed — please copy the URL from your address bar. (' + (e.message || 'clipboard unavailable') + ')');
  }
}

// ─── Shareable URL ───
function encodeStateToURL() {
  const config = buildConfigJSON();
  const params = new URLSearchParams();
  const slug = parseSlug(document.getElementById('collectionInput').value);
  if (slug) params.set('slug', slug);
  params.set('mode', currentMode);
  params.set('tierMode', currentTierMode);
  if (currentTierMode === 'standard') {
    params.set('t', [
      document.getElementById('thresh1').value,
      document.getElementById('thresh2').value,
      document.getElementById('thresh3').value
    ].join(','));
    params.set('p', [
      document.getElementById('points1').value,
      document.getElementById('points2').value,
      document.getElementById('points3').value
    ].join(','));
  } else {
    const custom = getCustomTiers();
    params.set('ct', JSON.stringify(custom.map(c => ({
      n: c.name, c: c.color, t: c.threshold, p: c.points
    }))));
  }
  if (document.getElementById('scoreMissing').checked) params.set('miss', '1');
  if (document.getElementById('scorePairs').checked) params.set('pairs', '1');
  const mb = parseFloat(document.getElementById('missingBonus').value);
  const cb = parseFloat(document.getElementById('comboBonus').value);
  // Only serialize bonuses if they differ from defaults, to keep shared URLs tidy.
  if (!isNaN(mb) && mb !== 1.5) params.set('mb', String(mb));
  if (!isNaN(cb) && cb !== 2.0) params.set('cb', String(cb));
  if (Object.keys(config.trait_weights).length) params.set('w', JSON.stringify(config.trait_weights));
  history.replaceState(null, '', '?' + params.toString());
}

function loadStateFromURL() {
  const p = new URLSearchParams(window.location.search);
  if (!p.has('slug') && !p.has('tierMode')) return;
  try {
    const custom = p.get('tierMode') === 'custom';
    applyImportedConfig({ v: 2, slug: p.get('slug') || '', mode: p.get('mode'), tier_mode: custom ? 'custom' : 'standard',
      standard_tiers: { thresholds: (p.get('t') || '2,5,20').split(',').map(Number), points: (p.get('p') || '7,3,1').split(',').map(Number) },
      custom_tiers: custom ? JSON.parse(p.get('ct') || '[]').map(t => ({ name: t.n, color: t.c, threshold: t.t, points: t.p })) : undefined,
      trait_weights: JSON.parse(p.get('w') || '{}'), score_missing: p.get('miss') === '1', score_pairs: p.get('pairs') === '1',
      missing_bonus: p.get('mb') ?? 1.5, combo_bonus: p.get('cb') ?? 2 });
  } catch (e) { showError('Shared settings could not be loaded: ' + e.message); }
}

function loadDemo() {
  if (isRunning) return;
  hideError(); setTab('analyze'); viewingPortfolio = false; clearPortfolioSummary();
  let thresholds, points;
  try { ({ thresholds, points } = beginConfig()); } catch (e) { showError(e.message); return; }
  const baseline = Array.from({ length: 100 }, (_, i) => ({
    tokenId: String(i), chain: 'ethereum', contractAddress: 'demo', collectionSlug: 'demo', demo: true,
    name: 'Demo NFT ' + i, image: '', traitsKnown: true,
    traits: [{ type: 'Background', value: i === 0 ? 'Gold' : i < 5 ? 'Violet' : 'Blue' }, { type: 'Shape', value: i < 12 ? 'Star' : 'Circle' }],
    price: i < 12 ? (i + 1) / 100 : null, currency: i < 12 ? 'ETH' : null, priceComparable: true
  }));
  const items = currentMode === 'all' ? baseline : baseline.slice(0, 12);
  const traitCounts = countTraits(baseline, 100), pairCounts = buildPairCounts(baseline, 100);
  cachedFetchData = { mode: currentMode, items, traitCounts, pairCounts, totalSupply: 100, slug: 'demo', chain: 'ethereum', contractAddress: 'demo', thresholds, points, allTraitTypes: buildTraitTypes(traitCounts), fetchedAt: new Date().toISOString() };
  document.getElementById('collectionInput').value = 'demo';
  showCollectionInfo({ name: 'Synthetic demo — not a real collection' }, 100);
  populateWeightsPanel(cachedFetchData.allTraitTypes);
  const scored = items.map(i => scoreNFT(i, traitCounts, 100, runConfig, pairCounts));
  finishAnalysis(scored, 100, 'demo', 'ethereum', 'demo', thresholds, points);
}

function wireAccessibility() {
  document.getElementById('apiKey').addEventListener('input', updateKeyStatus);
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  for (const tab of tabs) tab.addEventListener('keydown', event => {
    let idx = tabs.indexOf(tab);
    if (event.key === 'ArrowRight') idx = (idx + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') idx = (idx + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') idx = 0;
    else if (event.key === 'End') idx = tabs.length - 1;
    else return;
    event.preventDefault(); setTab(tabs[idx].dataset.tab); tabs[idx].focus();
  });
  for (const id of ['weightsDisclosure', 'snapshotsDisclosure']) document.getElementById(id).addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.click(); }
  });
  for (const [id, action] of [['collectionInput', analyze], ['compareSlugA', analyzeCompareTab], ['compareSlugB', analyzeCompareTab], ['walletInput', analyzePortfolio], ['apiKey', saveApiKey]]) {
    document.getElementById(id).addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); action(); } });
  }
}

// Compatibility bridge for the existing declarative HTML event handlers.
Object.assign(window, { setTab, toggleTheme, saveApiKey, clearApiKey, loadDemo, setMode, setView, setTierMode, addCustomTier, removeCustomTier, loadPreset, savePreset, deletePreset, analyze, analyzeCompareTab, clearCompareTab, analyzePortfolio, exportConfig, handleImportFile, toggleWeightsPanel, reScoreWithWeights, cancelAnalysis, sortResults, toggleSortDir, exportCSV, toggleThumbs, copyShareableUrl, applyFilters, clearFilters, toggleSnapshotsPanel, saveSnapshot, loadSnapshot, deleteSnapshot, showMore, toggleSpecial, toggleTableRow, clearSnapshotOverlay });

// ─── Init ───
loadTheme();
loadThumbs();
loadApiKey();
loadLastCollection();
loadOwnerCache();
loadActiveTab();
loadStateFromURL();
wireAccessibility();


export { analyze, analyzeCompareTab, analyzePortfolio, loadDemo, reScoreWithWeights, applyImportedConfig, buildConfigJSON, loadStateFromURL, encodeStateToURL, makeSortFn, setView, saveSnapshot, loadSnapshot, getDisplayItems, saveApiKey, clearApiKey };

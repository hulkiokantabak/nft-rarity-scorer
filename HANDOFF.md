# NFT Rarity Scorer — Handoff Document

## Overview
A single-page web app that scores NFTs from OpenSea collections based on trait rarity. Zero dependencies, pure HTML/CSS/JS, deploys as a static site.

- **Live:** https://hulkiokantabak.github.io/nft-rarity-scorer/
- **Repo:** `hulkiokantabak/nft-rarity-scorer` (branch: `master`)
- **Deploy:** GitHub Pages, served from `master` root
- **Single file:** `nft-rarity-scorer/index.html` (~1600 lines, CSS + JS inline)

## Running Locally
Open `index.html` directly in a browser, or serve with any static server. No build step.

Requires an OpenSea API key (https://docs.opensea.io/reference/api-keys). Key is stored in `localStorage` under `opensea_api_key` — never transmitted anywhere except `api.opensea.io` (enforced by CSP `connect-src`).

## Two Analysis Modes

### Listed mode (fast)
Fetches only currently-listed items in the collection.
```
fetchListedItems (0→70%)   ← /listings/collection/{slug}/all  (bulk, has price + rarity)
resolveOwnerNames (70→85%) ← /accounts/{addr}                 (batch 10 concurrent)
score + render (85→100%)
```
Typical: ~5–30 seconds for most collections.

### All mode (slow, complete)
Fetches every NFT in the collection plus enriches with individual data.
```
fetchAllItems (15→55%)       ← /collection/{slug}/nfts         (bulk, NO owner/rarity/price)
fetchListingPrices (55→65%)  ← /listings/collection/{slug}/all (adds prices)
enrichItems (65→90%)         ← /chain/{c}/contract/{a}/nfts/{id} per item (owner + rarity)
resolveOwnerNames (90→95%)   ← /accounts/{addr}                (batch 10 concurrent)
score + render (95→100%)
```
Typical: many minutes for a 1000-item collection (~100 enrichment calls + owner lookups). **Known tradeoff:** slow, but necessary because the bulk "all NFTs" endpoint lacks owner, rarity rank, and price data. Running concurrent tabs shares the OpenSea rate limit and slows both.

## Features Implemented (10 + extras)

1. **Responsive table** — hides Value/Owner/Tiers columns under 640px via CSS nth-child.
2. **Thumbnail toggle** — persisted to `nft_scorer_thumbs` localStorage.
3. **Score missing traits** — checkbox in Scoring Tiers panel; builds `allTraitTypes` set and scores "missing" as its own rarity bucket.
4. **Floor price in stats bar** — computed from listed items, shown with actual currency (not hardcoded ETH).
5. **Pagination** — "Show 50 More" button; `applySorting()` refactored from DOM reorder to array sort + re-render slice.
6. **Search/filter** — text + price min/max; filtered set flows into CSV export.
7. **Trait weight multipliers** — collapsible panel after first analysis; re-scores from `cachedFetchData` without re-fetching.
8. **Tier presets** — save/load/delete custom tier configs in `nft_scorer_tier_presets`.
9. **Score histogram** — inline SVG, 12 bins, gradient fill, hover tooltips.
10. **Shareable URL** — encodes slug, mode, tierMode, thresholds, points, custom tiers, missing-trait flag to query params via `history.replaceState`. API key never in URL.

**Extras added during session:**
- **ENS / username display** — resolves owner addresses via `/accounts/{addr}`, shows `ens_name` or `username` when available (falls back to shortened address). In-memory `ownerNameCache` Map avoids duplicate lookups.
- **Full enrichment in All mode** — individual NFT fetches for owner + rarity data.
- **Listing price merge in All mode** — bulk + listings endpoint results combined.

## Key State Variables (globals at top of `<script>`)
```javascript
let currentMode = 'listed';        // 'listed' | 'all'
let currentSort = 'score';         // active sort column
let currentSortDir = 'desc';
let currentView = 'cards';         // 'cards' | 'table'
let scoredItems = [];              // full scored set
let filteredItems = null;          // filter result or null
let displayCount = 50;             // pagination cursor
const PAGE_SIZE = 50;
let activeTiers = [];              // [{name, color, threshold, points}]
let currentTierMode = 'standard';  // 'standard' | 'custom'
let traitWeights = new Map();      // trait_type → multiplier
let cachedFetchData = null;        // raw items + traitCounts for reweighting
let thumbsVisible = true;
let ownerNameCache = new Map();    // address → {name, type} | {name: null}
let abortController = null;        // cancellable fetch controller
let isRunning = false;
```

## Key Functions Reference

### Data fetching
- `apiGet(url, apiKey)` — wraps fetch with 429 retry (exponential backoff) and abort support. Throws after final retry.
- `fetchCollection(slug, apiKey)` — collection metadata + total supply.
- `fetchListedItems(slug, apiKey)` — paginates `/listings/collection/{slug}/all`.
- `fetchAllItems(slug, apiKey, totalSupply)` — paginates `/collection/{slug}/nfts`.
- `fetchListingPrices(slug, apiKey, progressStart, progressEnd)` — extracted so All mode can reuse listings endpoint.
- `applyListingPrices(items, priceMap)` — merges token → price into items.
- `enrichItems(items, chain, contract, apiKey)` — batches of 10 concurrent individual NFT fetches.
- `resolveOwnerNames(items, apiKey)` — batches of 10 concurrent account lookups; caches in `ownerNameCache`.
- `applyOwnerNames(items)` — writes `ownerName` onto items from cache.

### Scoring & rendering
- `buildTraitCounts(items)` — trait_type → {value → count}.
- `scoreItem(item, traitCounts, totalSupply, activeTiers, allTraitTypes, scoreMissing, traitWeights)` — returns scored object with `mainTraits`, `specialTraits`, `tierCounts`, `totalScore`, `ownerName`.
- `renderResults()` — stats bar, histogram, cards/table.
- `renderCards(slice)` / `renderTable(slice)` — operate on pagination slice.
- `applySorting()` — sorts `scoredItems` array in place, resets pagination, re-renders.
- `applyFilters()` — populates `filteredItems`, resets pagination.
- `rerenderCurrentView()` — renders from `filteredItems ?? scoredItems`.

### Persistence
- `encodeStateToURL()` / `loadStateFromURL()` — shareable URL.
- Tier presets: `saveTierPreset()`, `loadTierPreset()`, `deleteTierPreset()`.

### Security helpers
- `escapeHtml(str)` — all user-provided strings pass through this before insertion.
- `csvSafe(str)` — prefixes `=`, `+`, `-`, `@` with `'` to prevent CSV formula injection.
- `encodeURIComponent` used on every dynamic URL segment.

## Security Measures
- **CSP meta tag** (line 6): `default-src 'none'; connect-src https://api.opensea.io; img-src https: data: blob:; ...`
- API key: only in `localStorage`, only sent to `api.opensea.io` via `X-API-KEY` header, excluded from shareable URLs.
- XSS: all rendered strings go through `escapeHtml()`.
- CSV injection: tier names + any text field go through `csvSafe()`.
- URL injection: all dynamic URL components wrapped in `encodeURIComponent()`.

## Known Tradeoffs
- **All mode is slow** — unavoidable given OpenSea's bulk endpoint lacks owner/rarity/price. Could be mitigated with higher batch concurrency but would risk 429 throttling.
- **Rate limit is shared across tabs** — running Listed + All in parallel slows both.
- **Owner name cache is in-memory only** — resets on page reload. Could persist to localStorage but TTL concerns make this non-obvious.
- **No server-side component** — no way to background-process long All-mode scans; closing the tab aborts.

## Recent Commit History (context)
- `56ccd91` — Final editorial pass (apiGet retry fallthrough, dead state cleanup, array-mutation fix, progress bar regression)
- `62aefb8` — Fix `batch is not defined` error in resolveOwnerNames
- `e8257bd` — Fetch listing prices in All mode
- `ff2ceab` — Remove 200-owner cap on name resolution
- Earlier: feature commits for 10 planned improvements + ENS display + All-mode enrichment

## File Layout
```
nft-rarity-scorer/
  index.html       ← the entire app
  HANDOFF.md       ← this document
```

## Extension Points
If picking this up later:
- **Faster All mode:** could parallelize `enrichItems` and `resolveOwnerNames` phases instead of serializing.
- **Persistent name cache:** localStorage with 24h TTL keyed by address.
- **Multi-collection portfolios:** current architecture is per-collection; portfolio view would need a new top-level route.
- **Trait combination scoring:** current model scores each trait independently; rare *combinations* aren't rewarded.
- **Export settings:** save/load entire scorer config (tiers + weights + filters) as JSON file.

## Testing Checklist (when making changes)
1. Listed mode on a small collection (e.g., ~100 items) — verify score + sort + pagination.
2. All mode on same collection — verify owner names, rarity ranks, and prices all populate.
3. Trait weight sliders — verify re-score uses `cachedFetchData` (no re-fetch).
4. Save/load tier preset — verify round-trips.
5. Shareable URL — copy URL, paste in new tab, verify fields repopulate (API key must be re-entered).
6. CSV export with active filter — verify only filtered set exports.
7. Mobile (resize to <640px) — verify Value/Owner/Tiers columns hide in table mode.
8. Cancel mid-run — verify abort button stops all in-flight fetches cleanly.

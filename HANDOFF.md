# v1.1.1 release handoff

## Scope
Focused correctness, API, privacy and usability improvements, retaining the existing vanilla/static architecture and GitHub Pages hosting.

## Changes
- Startup now shows a loading/error state, waits for handlers before enabling interaction, and pins runtime asset requests to release 1.1.1. Handler registration precedes saved-setting restoration.
- Extracted deterministic scoring, API, configuration and storage modules.
- Corrected zero-value handling, numeric trait ranges, unknown trait scoring, duplicate traits and NFT identities.
- Full-collection baselines for missing/pair bonuses; no listed/wallet subset masquerades as collection-wide frequencies.
- Removed OpenSea-rank-to-tier fallback in Portfolio; results grouped by collection.
- Currency-aware listings, sorting/filtering, floors and score/price labels. Unsupported bundles and quantity offers are skipped.
- Modern NFT metadata batch endpoint, canonical account resolver, header-aware retries and cancellation.
- Optional enrichment/price failure no longer discards valid All-mode scores.
- Session-first key storage with explicit persistence; removed blocked third-party analytics.
- Synthetic no-key demo, methodology and provenance.
- Settings validation, atomic JSON import, share-link weights, snapshot compatibility.
- Input labels, tab semantics/keyboard navigation, expandable table buttons, progress/error announcements, mobile wrapping and larger controls.
- Node unit and DOM integration tests, locked dev dependency, read-only CI.

## Verification
Local verification on 2026-09-04: 53 unit/DOM integration tests passed, including module-load failure and startup gating; syntax and whitespace checks passed. npm reported zero dependency vulnerabilities after installation.

Real-browser verification: fresh initialization, light/dark switch, Compare and Portfolio clicks, arrow-key tab navigation, no-key demo, table view and row expansion. Layouts at 320px, 390px and 1280px had no document-level horizontal overflow. No console errors were observed.
Authenticated Listed/All/Compare/Portfolio data requests and batch CORS remain a real-key smoke-test follow-up. Keys were not extracted from the user's browser or added to files.

The user authorized full deployment of this release to the existing GitHub Pages master root. Publish all .js/.css assets with index.html; .nojekyll keeps delivery static. Do not change repository visibility or hosting.

## Deliberate limits
- Ethereum-only Portfolio, cap 10,000 NFTs and top 25 collections, explicitly labelled.
- No exact OpenRarity implementation, AI-generated rarity, live exchange conversion, price prediction, backend, or framework migration.
- Unidentified payment-token prices are display-only and excluded from value/floor comparisons.
- Rate-limit coordination is within one tab, not cross-tab.
- Full scans are not atomic API snapshots; data can change mid-scan.
- Existing inline event handlers remain supported through a window compatibility bridge. CSP still includes unsafe-inline for scripts/styles.
- Browser-local settings and snapshots share this GitHub Pages origin with other projects.
- Licensing and repository visibility are unchanged.

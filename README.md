# NFT Rarity Scorer

A lightweight, browser-based tool for exploring NFT trait frequencies with custom weighted tiers. No wallet connection, server-side account, or runtime framework.

[Live website](https://hulkiokantabak.github.io/nft-rarity-scorer/) · [OpenSea API keys](https://docs.opensea.io/reference/api-keys)

## Local development

Requires Node.js 22 or newer for development and tests:

```sh
npm ci
npm test
npm run check
npm start
```

Open the local address printed by the server. Native JavaScript modules require an HTTP server; opening index.html as a file is no longer supported. There is still no production build step and no browser runtime dependency. LinkeDOM is used only by tests.

## Using the tool

- Try the synthetic demo without an API key, or enter your own OpenSea key.
- Keys stay in the current tab by default. “Remember on this device” explicitly opts into persistent browser storage.
- Choose Listed or All mode, adjust standard/custom tiers, and analyze a collection.
- Re-score cached data with current thresholds, points, bonuses, and trait weights.
- Compare two collections descriptively under the same rules.
- Portfolio supports Ethereum only, up to 10,000 NFTs and the 25 largest collections by holding count; incomplete coverage is reported.
- Export filtered results as CSV, export/import configuration JSON, or share a configuration URL. Keys never appear in exports or links.

## What the score means

This is a **custom weighted trait-tier heuristic**, not OpenRarity, a valuation, or an investment recommendation.

For a known categorical trait, frequency is count / collection supply. Thresholds are exclusive: with thresholds 2%, 5%, 20%, a trait at exactly 2% belongs to the second band. Contribution is rounded tier points × trait weight. Zero points, weights, and multipliers are valid.

Numeric ranges and internal underscore-prefixed traits are excluded. Missing or invalid frequencies do not become rare traits; they contribute no points and are labelled unavailable. Unscored NFTs are distinct from known common NFTs that legitimately score zero.

Missing and pair bonuses require complete per-token metadata for the entire collection. Selecting either can trigger a full scan even in Listed mode. A cached re-score cannot invent that baseline: rerun analysis with the option selected if needed. At most three rarest eligible pairs contribute; each uses the lower weight of its two traits. Portfolio omits these bonuses because holdings are not a full collection population.

Scores depend on each collection's trait structure. Portfolio results are grouped by collection. OpenSea ranks remain separate metadata and are never converted to fallback trait points.

“High score / lower price” requires a top-quartile custom score and a lower-half price among at least three fully covered, priced NFTs in the same fetched collection, chain, and payment currency. It is a sample heuristic, not evidence of underpricing. No exchange rates are assumed. Ambiguous multi-currency NFTs, unsupported bundle/quantity listings, and unidentified payment-token comparisons are excluded from price comparisons.

## Data and privacy

Data is requested directly from api.opensea.io. Metadata batches are matched by chain, contract, and token ID, not response order. Missing entries remain visibly unscored. Rate-limit headers and cancellation are respected. Pagination loops are rejected.

Only HTTPS NFT images load. There are no third-party analytics scripts. Browser storage on a GitHub Pages origin is shared with other projects on that same origin; do not persist an API key on a device/origin you do not trust. Legacy automatically saved keys migrate to session-only storage unless explicit remember consent exists.

Snapshots record engine version, configuration fingerprint, frequency source, supply, mode, coverage, and fetch time. Incompatible or legacy snapshots cannot be overlaid. A snapshot is a local summary, not an immutable historical market dataset. OpenSea metadata and listings can change during or after a scan.

## Files

- boot.js — visible startup status, module failure handling and release-pinned loading
- index.html — semantic interface
- styles.css, accessibility.css — existing theme plus responsive/keyboard refinements
- app.js — application flows and rendering
- core.js — deterministic scoring, identity, prices, and metrics
- api.js — queued requests, retries, pagination, metadata batches
- config.js, storage.js — validated settings and key storage
- test/ — unit and DOM integration tests with synthetic OpenSea fixtures
- scripts/serve.mjs — local static preview
- .github/workflows/test.yml — checks and tests; no deployment action

## Deployment

The existing GitHub Pages configuration serves the repository root from master. Publish the HTML, CSS, and JavaScript files together. Do not publish only index.html now that assets are separate. Development/test files are not required at runtime.

Repository visibility, licensing, and hosting have not been changed by this upgrade. No license is selected automatically.

## Verification limits

The 53-test regression suite uses synthetic fixtures and a non-browser DOM. Release 1.1.1 additionally received real-browser checks for fresh startup, theme switching, tabs, keyboard navigation, demo results, table expansion, and 320px/390px/1280px layouts. Browser CORS and authenticated OpenSea availability still require a real-key smoke test on a small collection; no real API key is present in the repository or fixtures.

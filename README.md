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

For a known trait, frequency is count / collection supply. The original default remains 7/3/1 points below 2%/5%/20%. Thresholds are exclusive: a trait at exactly 2% belongs to the second band. Contribution is rounded tier points × trait weight. Zero points, weights, and multipliers are valid.

Underscore-prefixed special traits contribute again. Numeric values contribute when a complete collection scan establishes exact frequencies; API min/max ranges are never interpreted as counts. Available OpenSea frequency distributions take precedence in Listed, All and Compare. A complete scan supplements missing whole trait types, without changing the existing distributions or splicing individual values into them. If an API category omits a particular value, it remains unavailable (or assumed with the checkbox), even after a scan.

**Score missing traits / unavailable data** is an explicit opt-in, off by default. When checked:

- An absent main trait uses measured absence frequency when a complete per-token scan exists, multiplied by the missing bonus.
- Otherwise, absent traits receive the rarest nonempty band's points × trait weight × missing bonus; missing individual frequencies receive that band's points × trait weight. Default examples: 11 points for an assumed absent type, 7 for an unavailable present value.
- These contributions say **Assumed rare**, retain `N/A` frequency and null count, and are excluded from measured coverage. Missing metadata can receive these points only for known collection trait types; no imaginary types are created.
- A zero-percent band remains empty/disabled. Known common absence remains common, not automatically rare.

Unchecked: absent traits and unavailable frequencies receive no points. Toggling the checkbox re-scores cached Analyze results immediately. Portfolio respects the opt-in too; it does not pretend wallet holdings establish measured collection absence. CSV exports identify assumed contributions and points separately.

Missing-frequency measurement, numeric restoration and pair scoring can require a full scan, including in Listed/Compare. Optional scan failure preserves available base scores. Pair bonuses still require a complete collection population. At most three rarest eligible cross-type pairs contribute using their own multiplier (default 2), independent of positive single-trait weights. A zero trait weight disables its pairs. Special traits do not receive missing/pair bonuses. Portfolio omits pair bonuses.

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

The regression suite uses synthetic fixtures and a non-browser DOM. Release 1.2.0 adds original-scoring parity cases, stable base frequencies across modes, exact numeric/special traits, optional-enrichment protection, and checkbox on/off assumption checks. Release 1.1.1 received real-browser startup, theme, tabs, keyboard, demo, table and responsive checks; those historical checks are not a claim of live authenticated scoring validation for this release. Browser CORS and authenticated OpenSea availability still require a real-key smoke test on a small collection; no real API key is present in the repository or fixtures.

See [Scoring review](SCORING_REVIEW.md) for the before/after analysis and deliberate policy choices.

# NFT Rarity Scorer — repository guide

## Architecture
Vanilla JavaScript static site, no production build and no browser runtime dependencies.
Native modules: app.js, core.js, api.js, config.js, storage.js.
HTML: index.html. Styles: styles.css + accessibility.css.
Use an HTTP server, not file://, because native modules require it.

## Local commands
npm ci
npm run check
npm test
npm start

Node 22+; LinkeDOM is a dev-only dependency. Tests use synthetic data, never real credentials.

## Invariants
- Trait frequencies must be known, positive integer counts no greater than supply.
- OpenSea numeric categories contain ranges, not frequency counts.
- Unknown or omitted metadata must never earn rare or missing-trait points.
- Pair and missing scores require a complete, deduplicated collection corpus.
- Zero settings remain valid through UI, JSON, URL and scoring.
- NFT identity is chain + contract + token ID. Preserve non-EVM case.
- Do not compare payment currencies without matching token identity.
- Keep OpenSea rank distinct from custom tier points; group portfolios by collection.
- API keys go only to the OpenSea origin; no redirects with credential headers.
- Key storage defaults to the current tab; persistence needs explicit opt-in.
- Result provenance describes the applied config, not subsequent control edits.
- Snapshot compatibility checks include engine/config, population, source, mode and coverage.
- Escape untrusted text in HTML and defend CSV fields against formulas.

## Deployment
Existing GitHub Pages serves master root. All runtime assets must be released together.
Do not change repository visibility, license, or hosting as incidental cleanup.
Do not push master or deploy without release authorization.

## Working practices
Preserve unrelated user edits. Keep changes proportionate to this small personal tool.
Add regression tests for correctness fixes. Use official OpenSea schemas when modifying API contracts.
CSP still permits existing inline event handlers; this is not a claim of a strict no-inline policy.
No analytics script should be added beside a stored key without a separate privacy/security review.

# NFT Rarity Scorer — repository guide

## Architecture
Vanilla JavaScript static site, no production build and no browser runtime dependencies.
Native modules: app.js, core.js, api.js, artblocks.js, config.js, storage.js.
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
- Unknown/omitted data earns no points by default. Per explicit user request, the missing-data checkbox opts into assumed rare contributions; keep their status assumed, count null, frequency N/A, and exclude them from measured coverage/value flags.
- Measured absence and pair frequencies require a complete, deduplicated collection corpus. Never confuse assumed absence with measured absence.
- Exact numeric frequencies and underscore-prefixed special traits are scoreable; API numeric min/max are not counts. Special traits do not get missing/pair bonuses.
- Preserve available API frequency distributions across modes; full scans supplement missing whole types and provide per-token presence/pairs. Optional enrichment cannot replace known traits within a run.
- Pair points use the independent combo multiplier, not positive trait weights; zero trait weight excludes its pairs.
- Zero settings remain valid through UI, JSON, URL and scoring.
- NFT identity is chain + contract + token ID. Preserve non-EVM case.
- Do not compare payment currencies without matching token identity.
- Keep OpenSea rank distinct from custom tier points. Portfolio is Art Blocks-only, including verified Engine/Flex, on Ethereum/Arbitrum/Base/Shape. Verify the live official catalog and exact owner/chain/contract/project identity; never rely on names/slugs/prefixes or filter is_artblocks=true.
- Portfolio frequencies use official project counts and minted invocations. Group by chain + contract + project, not shared core. No cross-project rank, color scale or average. No 25-project cap; report the 10,000 verified-piece cap and partial data.
- Wallet subsets/Art Blocks value aggregates do not establish per-token absence or pairs. Unsupported structured fields must not invalidate measured scalar siblings.
- artblocks-contracts.json is an audit snapshot, not a fallback allowlist. Catalog failure must not widen scope. Read ARTBLOCKS_SCOPE.md before changing coverage.
- API keys go only to the OpenSea origin; no redirects with credential headers. Art Blocks queries never take a key or send cookies; address-only Portfolio is key-free.
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

# NFT Rarity Scorer — repository guide

## Architecture
Vanilla JavaScript static site, no production build and no browser runtime dependencies.
Native modules: app.js, core.js, api.js, artblocks.js, rankings.js, config.js, storage.js.
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
- Portfolio frequencies use official project counts and minted invocations, grouped by chain + contract + project. Held rarity means rank within the entire project, never wallet subsets. Force missing traits and combinations on for Portfolio. Total points are inventory sums, not cross-project rarity. Keep neutral colors and explicit 10,000 verified-piece cap/partial notices; no 25-project cutoff.
- OpenSea Top % requires exact NFT/collection slug match, matching rarity strategy/version and 1 <= rank <= max_rank <= rarity.total_supply. Never substitute general/project/held supply. Copy only rank metadata, preserving Art Blocks traits/owner/supply/scores. No key means no OpenSea lookup, not a failed Portfolio.
- Automatic full-project scores/ranks require all minted invocations, stable count/update signatures and project aggregates, complete supported metadata, resolved scores and matching held evidence including canonical pairs. Preserve official distributions; supplement missing whole types only. Both displayed score and rank use both bonuses. Incomplete baselines leave the requested score/rank unavailable. Show tie intervals and assumption counts. Limits: 20k/project, 50k/run, 1m pair observations/project; yield between batches. Filters/sorts never recompute ranks.
- Wallet subsets/value aggregates do not establish per-token absence or pairs. Unsupported fields are never counted as synthetic values and block complete project scoring; general scalar scoring remains valid independently.
- C34’s supplied address is prefilled and editable; never auto-scan on load. Project disclosures preserve expansion and independent paging. Summary columns are identity, OS rarity and whole-project Held rarity only; no wallet-relative rank columns in CSV.
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

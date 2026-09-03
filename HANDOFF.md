# v1.2.0 scoring correction handoff

## Scope
Correct the scoring-policy regressions introduced in v1.1.1, retaining the existing vanilla/static architecture, privacy/startup fixes and GitHub Pages hosting. The user explicitly requested that checked missing-data scoring award rare points.

## Changes
- Original 7/3/1 tiers and exclusive boundaries are unchanged.
- Restored known special traits, exact numeric frequencies from complete scans, and the original independent pair multiplier. Zero weights still disable contributions/pairs.
- Preserve available API frequency distributions across Listed, All and Compare; complete scans supplement missing whole types and provide measured presence/pairs.
- Missing-data checkbox now explicitly permits assumed rarity. Default unavailable present value: 7 points; assumed absent main type: 11 points. Measured absence uses its actual frequency. Unchecked: no points for missing/unavailable data.
- Assumptions show N/A frequency/null count, reduce measured coverage, do not qualify for high-score/lower-price flags, and are identified in cards, table, Compare, provenance and CSV. Portfolio respects the checkbox.
- Optional owner/rank enrichment preserves already-known traits within a run. Optional scan failures retain available base scores; cancellation still stops.
- Expanded scoring and integration tests. Runtime assets and engine version now 1.2.0; incompatible old snapshots remain separate.

## Verification
Local verification on 2026-09-04: all 70 tests passed; syntax checks passed. The suite covers restored scoring, opt-in assumptions and checkbox re-scoring, measured multi-valued/zero-present absence, mode consistency, enrichment protection, optional failures, numeric scans, zero settings, keys, startup and prior API cases. Independent review also ran 2,000 deterministic original-vs-current comparisons on complete distributions with positive weights and pair bonuses; totals matched.

Historical v1.1.1 real-browser checks covered fresh initialization, theme, tabs, keyboard, demo, table and responsive layouts. This scoring correction is validated with deterministic and DOM integration tests, not a new authenticated browser run. Authenticated Listed/All/Compare/Portfolio requests and batch CORS remain a real-key smoke-test follow-up. Keys were not extracted or added to files.

This is a correction to the user's fully deployed website. Publish every runtime asset together to the existing GitHub Pages master root; .nojekyll keeps delivery static. Repository visibility and hosting remain unchanged.

## Deliberate limits
- Ethereum-only Portfolio, cap 10,000 NFTs and top 25 collections, explicitly labelled.
- No exact OpenRarity implementation, AI-generated rarity, live exchange conversion, price prediction, backend, or framework migration.
- Unidentified payment-token prices are display-only and excluded from value/floor comparisons.
- Rate-limit coordination is within one tab, not cross-tab.
- Full scans are not atomic API snapshots; data can change mid-scan.
- A value missing within an existing API category is left unavailable/assumed, not spliced into that category from another source.
- Numeric-only Portfolio frequencies are not full-scanned per collection; the checkbox can opt into assumed points instead.
- Existing inline event handlers remain supported through a window compatibility bridge. CSP still includes unsafe-inline for scripts/styles.
- Browser-local settings and snapshots share this GitHub Pages origin with other projects.
- Licensing and repository visibility are unchanged.

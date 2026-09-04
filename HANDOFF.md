# v1.3.0 Art Blocks Portfolio handoff

## Scope and changes

Portfolio is now Art Blocks-only, including verified independently branded Engine/Flex projects as explicitly requested. Manual Analyze/Compare remain general-purpose. Existing vanilla/static architecture, GitHub Pages hosting, visibility and key storage are preserved.

- Official live catalog: 205 audited cores across Ethereum (186), Arbitrum (12), Base (6), Shape (1). Legacy V0/V1 included. New indexed cores on these chains appear on subsequent scans.
- Exact chain + contract + owner + token/project verification, not names/slugs/prefixes. A catalog failure stops safely; no unrelated fallback.
- Key-free wallet-address queries directly to Art Blocks. ENS/OpenSea usernames still require OpenSea resolution/key. No credentials go to Art Blocks.
- Per-project minted invocations and feature-value counts. Shared-contract projects never share a scoring baseline.
- Existing 7/3/1 scoring and checked missing-data rare points preserved. Assumptions remain labelled/N/A/excluded from measured coverage. Exact scalar numeric/boolean traits work. Unsupported structured fields do not invalidate known siblings.
- No pair bonuses, price/rank lookup, cross-project ranking/colors/average or top-25 cutoff in Portfolio. Explicit 10,000 verified-piece cap and partial-data warnings. Re-run Portfolio after changing scoring settings.
- Full dated inventory and primary-source methodology in ARTBLOCKS_SCOPE.md and artblocks-contracts.json. The snapshot is not a runtime fallback.
- Runtime assets and engine version pinned together to 1.3.0; old incompatible snapshots remain separate.

## Verification

Local checks on 2026-09-04: all 90 tests passed; syntax checks passed. Tests cover four-chain identity, legacy/independent cores, shared-contract project isolation, key-free DOM integration, spoofed names/owners/contracts, BigInt project IDs, short pages, more than 25 projects, generating/missing aggregates, assumptions, invalid structured features, cancellation, caps and partial failures, plus all previous scoring/startup/storage/API regressions.

Live runtime-client checks confirmed all 205 catalog entries and a public Chromie Squiggle token's identity/features (9 traits, 10,000 supply, 584 count entries). HTTP checks confirmed Art Blocks CORS support for the deployed origin. No real user's stored API key was used/extracted. Verification is deterministic/DOM integration, API and HTTP checks, not a new real-browser or authenticated OpenSea run.

Release authorization comes from this ongoing change/deploy request. Publish every runtime asset together to existing master-root GitHub Pages, including the new artblocks.js. Do not change visibility, hosting, licensing or stored keys.

## Deliberate limits

- Official-index coverage, not every unofficial fork; new chains require an explicit update.
- Ownership/features may lag. Multi-page scans are not atomic and transfers/mints can change results.
- Art Blocks value aggregates do not prove per-token absence/pairs; never derive these from wallet holdings.
- Partial chains/project frequencies/rejected records/caps are visible; complete catalog verification is mandatory.
- No price prediction, AI rarity, cross-currency conversion, backend or framework migration.
- Existing inline handlers/CSP unsafe-inline remain. Browser-local settings/snapshots share the Pages origin.
- Original scoring-policy analysis remains in SCORING_REVIEW.md; its v1.2.0 Portfolio coverage limits are historical and superseded here.

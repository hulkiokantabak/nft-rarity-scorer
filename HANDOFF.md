# v1.4.0 Portfolio ranking and inspection handoff

## Delivered scope

- Art Blocks-only holdings remain verified against the official live catalog, including legacy/Engine/Flex across four chains.
- Optional OpenSea NFT rarity enrichment uses the user's existing OpenSea key, only for verified held tokens, without overwriting Art Blocks scores/traits/ownership/supply. Detailed collection metadata is fetched once per returned NFT.collection.
- OpenSea Top % = supplied rank / matching collection.rarity.total_supply ×100. Exact collection identity, matching strategy/version, positive safe integers and rank <= max_rank <= rarity.total_supply are mandatory. Missing/inconsistent metadata leaves a raw rank without a percentage. Ranking timestamp is shown only with valid matching metadata.
- Custom raw-score ranks among scored holdings overall and within each project. Full tie intervals, including all-zero ties; unscored is not zero.
- On-demand full-project custom ranks, for selected or all held projects. Every project piece uses the same applied score config and official aggregate baseline. Exact minted identities, contiguous invocations, count/update stability, unchanged project frequencies, resolved population/held scores and matching scoring evidence are required.
- Full-project ranks include labelled opt-in assumptions consistently. Missing-data behavior and 7/3/1 defaults are unchanged. Pair bonuses remain disabled in Portfolio.
- Held point totals and project totals/averages, assumption subtotals, available-rank counts, project drill-down, grouped/all-holdings views and percent sorts. Raw point summaries are inventory descriptions, not cross-project rarity or valuation.
- Cards/table show both systems independently. CSV includes project identities, cohort sizes, tie endpoints, percentages, assumptions, timestamps and rank config.
- Full-project budgets: 20,000 pieces/project and 50,000/run. Existing holdings cap: 10,000. Completed project ranks survive cancellation. New Portfolio runs clear prior ranks; later control edits cannot silently relabel the applied config.
- Existing design, static vanilla architecture, GitHub Pages hosting, visibility and storage retained. No runtime dependencies added. Assets/engine pinned together at 1.4.0.

## Validation

103 deterministic/DOM integration tests passed locally; syntax checks passed. New tests cover tie math/zero/unscored/assumed cases, exact OpenSea collection/strategy populations, identity joins, key-free operation, isolated enrichment failures, full-project short pages/gaps/mutations/caps, held-vs-population scoring evidence, selected-project ranking, applied settings, totals/filter stability, cancellation and CSV.

Live runtime-client check on 2026-09-04: all 40 minted Monochronos pieces scanned and scored with 100% measured coverage. Token 12: score 5, rank 1/40, Top 2.5%; token 7: score 4, tied rank 2–5/40, Top 5–12.5%. OpenSea integration uses current official schemas plus synthetic responses; no user's key extracted or used. No new browser UI QA/authenticated OpenSea test claimed.

Publish all runtime assets together to existing master-root GitHub Pages, including rankings.js. Site/publishing checks preserve existing hosting; no migration. Stop local preview after release.

## Sources and deliberate limits

See ARTBLOCKS_SCOPE.md for exact ranking formulas, privacy, source links, index boundaries and the complete 205-contract audit. OpenSea rank-position % is our explicit derivation, not a claim of matching an undocumented hover formula. OpenSea ties are not returned and are not invented.

Live indexes may lag or change; consistency checks do not create an atomic historical snapshot. Full-project results can be unavailable for incomplete/changed/unresolved/over-limit populations; held scores remain useful. No broader NFT fetches, listing/price enrichment, pair recalculation, AI rarity, valuation model or backend was added.

Earlier scoring-policy history remains in SCORING_REVIEW.md. Earlier Portfolio limits/policies are superseded by the current requested granular/ranking workflow.

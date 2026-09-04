# v1.5.0 Portfolio whole-project scoring handoff

## Delivered behavior

- C34's supplied public address is prefilled and editable. No wallet scan until Score is clicked.
- Held rarity means the owned work's score rank within its entire minted Art Blocks project. Old wallet-relative ranks are removed from UI and CSV.
- Automatic whole-project scans score all pieces and held works with missing traits and combinations enabled. Analyze/Compare checkbox defaults and existing tiers, weights and multipliers are preserved.
- Official distributions stay stable; complete metadata supplies per-token presence, pair counts and wholly missing trait types. Unsupported/incomplete metadata cannot establish bonus completeness.
- Rank evidence includes canonical pair identities/counts/points. Equal-frequency top-three pairs are independent of feature order. Owner, image and OpenSea metadata survive rescoring.
- Failed/incomplete/capped projects leave the requested score and Held rarity unavailable; optional OS rarity remains. Retry targets a selected project or unfinished projects.
- Summary columns: project/work identity, OS rarity, whole-project Held rarity. Rows follow filters; total/selected point sums elsewhere are inventory descriptions.
- Detailed projects start collapsed, with persistent expansion and independent 50-work paging. Every matching header stays visible. Stable table expansion IDs distinguish contracts/chains.
- Existing verified Art Blocks/Engine/Flex coverage, privacy, vanilla architecture and GitHub Pages hosting are unchanged.

## Limits

10,000 verified holdings; 20,000 pieces/project; 50,000 pieces/run; one million pair observations/project. Pair/scoring batches yield for cancellation. Completed project results survive cancellation. Stable signatures and exact full populations are required; live index scans are not atomic snapshots. OpenSea uses only its own matching strategy/version and rarity population.

## Validation

113 unit/DOM integration tests passed locally. Tests cover simultaneous missing-plus-pair points (25 = 11 measured-missing + 14 pair; rank 1/100 for one held piece), complete denominators, canonical pair order, unsupported data, cancellation, bounded work, applied config, C34 markup, project paging/collapse, synchronized filters, OS metadata and CSV.

Live runtime-client check on 2026-09-04: all 40 Monochronos pieces scored with both bonuses available. Token 12: score 23 (18 pair points), rank 1/40, Top 2.5%; token 7: score 22 (18 pair points), rank 2–5/40, Top 5–12.5%. No user's key extracted or used; no new browser UI QA/authenticated OpenSea test claimed.

Publish all runtime assets together to existing master-root GitHub Pages at version 1.5.0. Stop preview after deployment. ARTBLOCKS_SCOPE.md records methodology/sources and the earlier contract audit; SCORING_REVIEW.md retains earlier scoring policy history.

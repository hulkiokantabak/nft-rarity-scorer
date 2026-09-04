# v1.6.0 Editable Portfolio options and project labels

## Delivered

- Missing traits and trait combinations are checked by default but independently clickable. Changes recalculate all held works and their entire project rank populations, not only the selected project.
- Invalidate old points/ranks in state and visible cards/table immediately. Keep applied options and configuration fingerprints consistent. Portfolio choices round-trip separately through JSON and shared links.
- Cache up to 50,000 verified population tokens in the tab for recalculation. Uncached projects use the existing key-free scan; existing caps/cancellation and incomplete-score guards remain.
- Move the OpenSea collection label out of OS rarity cells and below project titles.
- Shared project metadata shows artist, AB500 membership, category and numbered Curated Series in Portfolio summaries/disclosures/selectors, cards/table, Analyze header, Compare and CSV.
- AB500 uses exact official public heritage tags, not numeric IDs or is_artblocks. Categories use vertical metadata, not legacy curation_status. Numbered series require a Curated Series tag or a Curated vertical. Artist credits preserve co-creators.
- Analyze/Compare labels are separate display metadata. Exact chain/contract/token/nested project and catalog verification are required. No label query alters trait frequencies, supply, owner, price, scoring or collection identity; failures preserve results.

## Validation

126 local unit/DOM tests pass. New coverage includes all four bonus combinations, cached recalculation, immediate stale-display clearing, independent settings round-trips, metadata placement across views, tri-state tags, category/series pitfalls, identity mismatches, batching, failures/cancellation and safe CSV/HTML.

Live metadata review on 2026-09-04 checked all 500 AB500 members and 67 numbered Curated Series. Quine (project 506), false-is_artblocks members and Studio/Flex examples classify correctly. Main-agent checks confirmed Fidenza → Tyler Hobbs / AB500 / Curated Series 3 and Monochronos → Heeey / Not AB500 / Studio. No stored user key was used and no browser UI QA/authenticated OpenSea test is claimed.

Publish all runtime files together at 1.6.0 to the existing GitHub Pages setup; stop preview after deployment. ARTBLOCKS_SCOPE.md has current sources, formulas and limits. Existing design, privacy, C34 prefill and deployment target are retained.

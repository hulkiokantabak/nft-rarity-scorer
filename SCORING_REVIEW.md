# Scoring review — 4 September 2026

## Conclusion

The previous release changed more than implementation details. The user's observation is supported by deterministic comparisons with the original scorer at `c23a396`. Standard 7/3/1 points and 2%/5%/20% exclusive thresholds were unchanged, but eligibility and bonus policies changed. No specific live collection was supplied, so these reproduce code-level causes rather than identify the exact NFT the user saw.

## Reproduced changes

All examples use synthetic data, a 100-NFT collection and default settings unless stated.

| Case | Original | v1.1.1 | Correction |
| --- | ---: | ---: | --- |
| Ordinary categorical trait occurring once | 7 | 7 | Unchanged |
| Numeric value occurring once in a complete scan | 7 | 0 | Restore 7 from exact counts |
| Special `_type` value occurring once | 7 | 0 | Restore 7 and its special-trait detail |
| Rare Hat + Eyes, Hat weight 0.25 | 23 | 13 | Restore 23: single contributions 2 + 7, pair 14 |
| API says 1 occurrence; full scan says 2 | 7 | Could become 3 in All or bonus mode | Preserve the API distribution across modes |
| Known trait erased by optional detail response without traits | 7 | Could become unscored | Preserve known run metadata |

The numeric fix does not use numeric ranges as frequency counts. It counts exact values across a complete population. Existing API distributions retain precedence; scans add otherwise missing whole types. Per-token presence and pair frequencies are explicitly scan-derived. These sources can reflect slightly different moments, not an atomic marketplace snapshot. Official category/count structure: [OpenSea SDK types](https://github.com/ProjectOpenSea/opensea-js/blob/main/src/api/types.ts).

## Explicit missing-data policy

The user clarified: “Missing data should receive rare points if we tick the box.”

The checkbox is off by default and has these rules:

- **Off:** no missing-type contributions; observed values with unavailable frequencies earn no points.
- **On, measured absence:** score its actual absence frequency, including the missing multiplier. A type absent on 20% of NFTs is common at the default boundaries and earns zero, not automatic rare points.
- **On, unavailable frequency:** assume the rarest nonempty tier, but display `Assumed rare` and `N/A`, not a fabricated 0% frequency. An observed value earns 7 at defaults; an assumed absent type earns round(7 × 1.5) = 11. Custom weights/tiers still apply; a zero-percent band stays empty.
- **NFT metadata missing:** assumption points can use known collection trait types, but no nonexistent type is invented. Underscore special types are not synthesized as missing types.

Assumed points are part of the requested custom score. They are not measured rarity: coverage excludes them, CSV identifies them, and they cannot qualify an NFT for the measured high-score/lower-price flag. Compare totals/histograms include them; its measured-rarest-trait percentage does not.

## Kept safeguards

Zero weights and points remain zero. Duplicated traits/tokens cannot multiply points. Measured absence counts NFT presence rather than summing multi-valued categories. Pair rarity requires a complete collection population and uses the three rarest eligible cross-type pairs. Positive trait weights do not scale the pair multiplier; zero disables pairs involving that trait. OpenSea rank remains separate from custom points. API/storage/startup improvements are retained.

## Evidence and limits

Unit and DOM integration regressions cover the cases above, including checkbox on/off re-scoring, Portfolio opt-in, optional scan failure, stable modes, unknown metadata, numeric restoration and unchanged startup. Independent review compared 2,000 deterministic original/current total scores using complete distributions and positive weights/pair bonuses; all matched.

This does not establish agreement on a real collection's latest metadata. A specific collection/token example would allow that final comparison. No actual API key was read or used during this correction.

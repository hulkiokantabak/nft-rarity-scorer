# Art Blocks Portfolio coverage

Portfolio includes Art Blocks' legacy and current core contracts, partners, Studio, Collaborations, and independently branded **verified Engine/Flex** projects. Manual Analyze and Compare remain general-purpose OpenSea tools. No wallet signature or connection is needed.

## Contract inventory

Every Portfolio scan reads Art Blocks' public `contracts_metadata` catalog. It does not identify projects by collection names, OpenSea slugs, address prefixes, or the `is_artblocks` flag (which would omit legitimate Engine/Studio contracts). Here “verified” means exact chain and contract membership in the official index, not a quality/curation endorsement.

Audit on **2026-09-04** found **205 core contracts**:

| Production chain | Chain ID | Indexed cores |
| --- | ---: | ---: |
| Ethereum | 1 | 186 |
| Arbitrum | 42161 | 12 |
| Base | 8453 | 6 |
| Shape | 360 | 1 |

The [complete 205-contract inventory](artblocks-contracts.json) records every address, chain, indexed name, contract type and version returned during the audit. Null legacy names/versions are intentional. This is an audit snapshot, **not a runtime fallback allowlist**. Catalogued contracts can have no public projects; Shape's current entry is an example. Presence does not imply a wallet owns a piece there.

The snapshot contains 1 V0, 1 V1, 21 V2 PBAB, 2 V3, 65 V3 Engine and 115 V3 Engine Flex cores. It includes both original Ethereum flagship cores, `0x059edd72cd353df5106d2b9cc5ab83a52287ac3a` (including Chromie Squiggle) and `0xa7d8d9ef8d8ce8992df33d8b8cf4aebabd5bd270` (including Fidenza), plus current flagship, Explorations, Pace, Bright Moments and independent Engine/Flex cores.

New entries on the four supported chains are picked up on subsequent live scans without a site release. New chains need an explicit support update. The modern on-chain CoreRegistry alone is insufficient for old deployments; the V0 core need not be registered there.

## Verification and scoring

1. Fetch the official catalog with keyset pagination and verify each chain's aggregate count. Require both original Ethereum flagship cores. A truncated/broken catalog stops the run, never silently broadening or narrowing its scope.
2. Query indexed tokens for the exact lowercased wallet on each supported chain. Verify chain, catalogued contract, token ID, returned owner and linked project. Reject mismatches.
3. Derive the project ID with `BigInt(tokenId) / 1_000_000n`. Cohorts use **chain + contract + project ID**. Identical project/token numbers on other contracts/chains remain distinct.
4. Fetch official feature-value counts once per project. Divide by that project's minted `invocations`, not maximum edition size, shared-contract supply, a similarly named OpenSea collection or wallet holdings.
5. Automatically fetch every project piece and score the whole population plus owned works with missing traits and combinations enabled. Complete supported metadata establishes per-token presence and pairs. Unsupported structured fields or generating/unavailable aggregates cannot establish full scoring completeness.

Defaults remain **7/3/1 points below 2%/5%/20%**, with exclusive boundaries. Portfolio always enables missing traits and trait combinations independently of Analyze’s checkboxes. Preserve official feature-value distributions; supplement only whole missing types from the complete scan. Measured absence uses per-token presence, never aggregate value sums. Unavailable individual frequencies may receive assumed rare points, labelled N/A and excluded from measured coverage. The top three rarest eligible pairs use the combination multiplier. No OpenSea rank becomes custom points.

Detailed results start collapsed by project. Every matching project header is visible, with independent 50-work pagination inside it. Expansion survives filtering, sorting, retries and Cards/Table switches. The summary shows only project/work identity, OS rarity and whole-project Held rarity. Total and selected point sums elsewhere are inventory descriptions, not cross-project rarity or valuations; unscored works are excluded. There is no 25-project cutoff. The 10,000 verified-piece holdings cap remains explicit. Re-run Portfolio after changing tiers, weights or bonus multipliers.

## Ranks and percentages (v1.5.0)

**Held rarity is the owned artwork’s score rank within its entire minted Art Blocks project, never the wallet.** Earlier holdings-relative ranks are removed. Filtering and pagination never change the denominator. Ties show both occupied endpoints: an entire project scoring [10,10,5] gives #1–2, #1–2, #3 out of 3 and Top ranges 33.33–66.67%, 33.33–66.67%, 100%.

Each Portfolio scan automatically downloads every held project using the key-free Art Blocks API. Owned pieces and the population use the same baseline and applied configuration, with missing traits and combinations enabled. The rank range is `(1 + strictly higher scores)` through `(higher + equal scores)`; divide both endpoints by the full minted population for the Top % interval. **Retry unavailable project scores** targets the selected project or all unfinished projects using the original applied settings.

Project-wide ranks require exact identities, contiguous invocations, matching fetched/indexed/minted counts, stable token-update signatures and unchanged project supply/frequencies. Complete supported metadata must establish absence and pairs. All scores must resolve, and held scoring evidence must match its population counterpart, including canonical pair identities/counts/points. Failed, truncated, changed or unsupported projects leave both requested score and Held rarity unavailable; OS rarity remains visible when provided. Assumed frequencies may be ranked consistently and labelled. These guards do not create an atomic historical snapshot. Limits: 20,000 pieces/project, 50,000 pieces/run and one million pair observations/project. Pair/scoring batches yield for cancellation; completed projects survive cancellation. A new Portfolio scan clears prior scores/ranks.

**OpenSea rarity** is optional, enabled by default when a key is available. Only verified held NFTs are requested, in chain-specific batches. Their `collection` slug determines the detailed OpenSea collection lookup. The NFT's `rarity.rank` remains separate from custom points. A percentage is derived only when:

- The returned detailed collection's `collection` matches that slug exactly.
- NFT and collection rarity strategy ID/version match.
- Integers satisfy `1 ≤ rank ≤ rarity.max_rank ≤ rarity.total_supply`.

The displayed OpenSea Top % is `100 × rank / collection.rarity.total_supply`. It uses the ranking population, **not** `max_rank`, general collection supply, Art Blocks project supply or the held count. This is a derived rank-position percentage, not an assertion about OpenSea's exact hover formula or the fraction of tokens strictly rarer. OpenSea's tie interval is not returned and is not fabricated. Missing/inconsistent denominators retain valid raw ranks but show percentage unavailable. Collection, strategy and ranking timestamp are displayed; API failures never replace Art Blocks metadata or discard custom scores.

CSV includes project identity, independent ranking populations, tie endpoints, percentages, assumptions, dates, configuration fingerprint and both enabled flags. Wallet-subset rank columns are removed. Summary rows follow selected-project/search filters without changing full-project rank populations.

Sources: [OpenSea NFT batch schema](https://docs.opensea.io/reference/get_nfts_batch.md), [detailed collection schema](https://docs.opensea.io/reference/get_collection.md), [NFT schema](https://docs.opensea.io/reference/get_nft.md), and [OpenRarity tie implementation](https://github.com/OpenRarity/open-rarity/blob/main/open_rarity/rarity_ranker.py).

## Limits and privacy

C34’s user-supplied public address `0x694E64D4AD77e0C234b7b1c55AC40302aD86ce3F` is prefilled and editable. No wallet request is made until Score is clicked.

- Covers officially indexed projects, not every unregistered fork that resembles Art Blocks. No fallback uses names, claimed affiliation, testnets or unrelated NFTs.
- Ownership/features can lag the chain. Multi-page requests are not an atomic historical snapshot; transfers/mints during a scan can change results.
- Failed holdings chains, unavailable project frequencies, rejected records and caps are reported. Verified results can remain visible as partial; catalog verification itself must succeed.
- Wallet addresses go directly to `data.artblocks.io` without a key or cookies. OpenSea keys are never sent there. ENS/OpenSea username resolution still needs an OpenSea API key.
- Portfolio does not fetch listings/prices. Optional OpenSea rank enrichment uses the existing OpenSea-only key flow; untick it to make address-based Portfolio Art Blocks-only network requests. Analyze/Compare retain their OpenSea workflow. No analytics, backend, runtime framework or new key storage was added.

## Primary sources and checks

- [Art Blocks GraphQL API](https://docs.artblocks.io/developer/graphql/) — public index at `https://data.artblocks.io/v1/graphql`.
- [Core contracts](https://docs.artblocks.io/developer/core-contract/) and [token/generator APIs](https://docs.artblocks.io/developer/token-and-generator-apis/) — project/token identity.
- [Official contract versions](https://github.com/ArtBlocks/artblocks-contracts/blob/main/packages/contracts/README.md#core-contract-versions) and [infrastructure](https://github.com/ArtBlocks/artblocks-contracts/blob/main/packages/contracts/INFRASTRUCTURE.md) — core families/deployments.
- [CoreRegistryV1 source](https://github.com/ArtBlocks/artblocks-contracts/blob/main/packages/contracts/contracts/engine-registry/CoreRegistryV1.sol) — registry design and legacy-core caveat.

Live checks used the runtime client to fetch all 205 cores and a public Chromie Squiggle sample (9 traits, 10,000 minted supply, 584 feature-count entries). HTTP checks verified Art Blocks CORS headers for the deployed origin. Deterministic tests cover four-chain/shared-contract identity, BigInt, short pages, over 25 projects, spoofed names/contracts/owners, missing assumptions, unsupported fields, cancellation and partial failures. No user's stored key was extracted or used. These are not claims of a new authenticated browser test.

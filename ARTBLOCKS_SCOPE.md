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
5. Apply the existing custom tier scoring. Exact numeric/boolean/string features work. Unsupported structured fields stay unavailable without invalidating scalar siblings. Generating/unavailable aggregates are not measured rarity.

Defaults remain **7/3/1 points below 2%/5%/20%**, with exclusive boundaries. The checked missing-data option still awards assumed rare points, labelled with N/A frequency and excluded from measured coverage. Aggregate feature counts do not prove per-token absence. Pair bonuses are omitted: a wallet query is not a full project population. No OpenSea rank is converted to custom points.

Results stay grouped by project, with no cross-project score ranking, score-color scale or portfolio average. There is no 25-collection cutoff. A 10,000 **verified Art Blocks pieces** safety cap remains, with an explicit partial-scan notice. Change settings and run Portfolio again to apply them.

## Limits and privacy

- Covers officially indexed projects, not every unregistered fork that resembles Art Blocks. No fallback uses names, claimed affiliation, testnets or unrelated NFTs.
- Ownership/features can lag the chain. Multi-page requests are not an atomic historical snapshot; transfers/mints during a scan can change results.
- Failed holdings chains, unavailable project frequencies, rejected records and caps are reported. Verified results can remain visible as partial; catalog verification itself must succeed.
- Wallet addresses go directly to `data.artblocks.io` without a key or cookies. OpenSea keys are never sent there. ENS/OpenSea username resolution still needs an OpenSea API key.
- Portfolio does not fetch listings/prices/OpenSea ranks. Analyze/Compare retain their OpenSea workflow. No analytics, backend, runtime framework or new key storage was added.

## Primary sources and checks

- [Art Blocks GraphQL API](https://docs.artblocks.io/developer/graphql/) — public index at `https://data.artblocks.io/v1/graphql`.
- [Core contracts](https://docs.artblocks.io/developer/core-contract/) and [token/generator APIs](https://docs.artblocks.io/developer/token-and-generator-apis/) — project/token identity.
- [Official contract versions](https://github.com/ArtBlocks/artblocks-contracts/blob/main/packages/contracts/README.md#core-contract-versions) and [infrastructure](https://github.com/ArtBlocks/artblocks-contracts/blob/main/packages/contracts/INFRASTRUCTURE.md) — core families/deployments.
- [CoreRegistryV1 source](https://github.com/ArtBlocks/artblocks-contracts/blob/main/packages/contracts/contracts/engine-registry/CoreRegistryV1.sol) — registry design and legacy-core caveat.

Live checks used the runtime client to fetch all 205 cores and a public Chromie Squiggle sample (9 traits, 10,000 minted supply, 584 feature-count entries). HTTP checks verified Art Blocks CORS headers for the deployed origin. Deterministic tests cover four-chain/shared-contract identity, BigInt, short pages, over 25 projects, spoofed names/contracts/owners, missing assumptions, unsupported fields, cancellation and partial failures. No user's stored key was extracted or used. These are not claims of a new authenticated browser test.

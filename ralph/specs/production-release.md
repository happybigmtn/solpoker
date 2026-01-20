# Production Release & Governance Spec

## Release Engineering
- AC-PR1.1: Program builds are reproducible with pinned toolchain versions and a documented build script.
- AC-PR1.2: Mainnet program binaries are verified on-chain against local builds (verification artifacts stored).
- AC-PR1.3: Release artifacts include program IDs, IDL, and client SDK versions, all tagged and checksummed.
- AC-PR1.4: A release checklist exists and is required for mainnet deployments (includes verification and rollback steps).

## Upgrade Authority + Governance
- AC-PR1.5: Upgrade authority is controlled by a multisig or timelock with documented signer set and rotation procedure.
- AC-PR1.6: Emergency pause/disable procedure is documented (who, how, and expected blast radius).

## Configuration + Migrations
- AC-PR1.7: Environments (devnet/testnet/mainnet) are configured via explicit config files/env with validation.
- AC-PR1.8: Account layouts are versioned and migration paths are documented and tested before upgrades.
- AC-PR1.9: Backward-compatibility guarantees are defined for client SDKs (semver + deprecation policy).

# Release Engineering

This directory contains release engineering documentation and procedures for Robopoker.

## Overview

Release engineering ensures that program deployments are:
- **Reproducible**: Same source always produces same bytecode
- **Verifiable**: Deployed bytecode can be verified against source
- **Auditable**: Full trail of artifacts, checksums, and sign-offs
- **Recoverable**: Clear rollback procedures if issues arise

## Acceptance Criteria Coverage

| AC | Description | Implementation |
|----|-------------|----------------|
| AC-PR1.1 | Reproducible builds with pinned toolchain | `scripts/build-release.sh` |
| AC-PR1.2 | On-chain verification with stored artifacts | `scripts/verify-programs.sh` |
| AC-PR1.3 | Release artifacts with checksums | `target/release-artifacts/` |
| AC-PR1.4 | Mainnet release checklist | `RELEASE_CHECKLIST.md` |

## Toolchain Versions

Current pinned versions (defined in `scripts/build-release.sh`):
- **Solana CLI**: 3.0.2
- **Rust**: 1.92.0
- **cargo-build-sbf**: Bundled with Solana CLI

## Quick Start

### Build a Release
```bash
./scripts/build-release.sh --env mainnet
```

This generates:
- `target/release-artifacts/robopoker_entropy.so`
- `target/release-artifacts/robopoker_poker.so`
- `target/release-artifacts/checksums.sha256`
- `target/release-artifacts/build-metadata.json`

### Verify Deployed Programs
```bash
# Verify and store artifacts
./scripts/verify-programs.sh --env mainnet --store
```

### For Mainnet Deployments
1. Copy `RELEASE_CHECKLIST.md` to your release PR
2. Complete all checklist items
3. Get required sign-offs
4. Execute deployment

## Directory Structure

```
docs/release-engineering/
├── README.md                 # This file
└── RELEASE_CHECKLIST.md      # Mainnet deployment checklist

scripts/
├── build-release.sh          # Reproducible build script
├── verify-programs.sh        # Bytecode verification
└── deploy-devnet.sh          # Devnet deployment

target/
├── release-artifacts/        # Build outputs
│   ├── robopoker_entropy.so
│   ├── robopoker_poker.so
│   ├── checksums.sha256
│   └── build-metadata.json
└── verification/             # Verification records
    └── verification-*.json
```

## Release Artifact Format

### build-metadata.json
```json
{
  "version": "v0.1.0",
  "commit": "abc123...",
  "build_time": "2026-01-20T12:00:00Z",
  "environment": "mainnet",
  "toolchain": {
    "solana": "3.0.2",
    "rust": "1.92.0"
  },
  "programs": {
    "entropy": {
      "id": "...",
      "binary": "robopoker_entropy.so",
      "checksum": "sha256:..."
    },
    "poker": {
      "id": "...",
      "binary": "robopoker_poker.so",
      "checksum": "sha256:..."
    }
  },
  "client_sdk": {
    "name": "@robopoker/client",
    "version": "0.1.0"
  }
}
```

### checksums.sha256
```
<sha256hash>  robopoker_entropy.so
<sha256hash>  robopoker_poker.so
<sha256hash>  poker.json
```

## On-Chain Verification

For mainnet deployments, consider registering with an on-chain verification registry:

```bash
# Install solana-verify
cargo install solana-verify

# Build with verification support
solana-verify build

# Register with osec.io registry
solana-verify verify-from-repo \
  --program-id <PROGRAM_ID> \
  --remote https://github.com/your-org/robopoker
```

This provides third-party attestation that deployed bytecode matches audited source.

## Troubleshooting

### Build Not Reproducible
1. Check toolchain versions match exactly
2. Ensure clean build (`cargo clean` first)
3. Verify no local modifications (`git status`)

### Verification Failing
1. Confirm you're comparing against correct environment
2. Check if program was upgraded since build
3. Rebuild and verify checksums match

### Missing Artifacts
1. Run `./scripts/build-release.sh` first
2. Check `target/release-artifacts/` exists
3. Verify build completed without errors

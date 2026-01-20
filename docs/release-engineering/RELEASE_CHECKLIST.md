# Robopoker Mainnet Release Checklist

**Satisfies AC-PR1.4**: Release checklist required for mainnet deployments (includes verification and rollback steps).

This checklist MUST be completed for every mainnet deployment. Copy this checklist to the release PR and check off each item.

---

## Pre-Release (Complete Before Starting)

### 1. Code Readiness
- [ ] All target features merged to `main`
- [ ] All tests passing on CI
- [ ] No critical or high-severity issues open
- [ ] Security audit complete and findings addressed
- [ ] Code freeze in effect (no new merges during release)

### 2. Documentation
- [ ] CHANGELOG.md updated with release notes
- [ ] Breaking changes documented
- [ ] Migration guide prepared (if account layouts changed)
- [ ] Client SDK version bumped and tagged

### 3. Environment Verification
- [ ] Testnet deployment successful with identical bytecode
- [ ] Testnet verification passed (`./scripts/verify-programs.sh --env testnet`)
- [ ] E2E tests passed on testnet
- [ ] Load testing completed and within bounds

---

## Build Phase

### 4. Reproducible Build
```bash
# Build with pinned toolchain
./scripts/build-release.sh --env mainnet
```
- [ ] Build completed without errors
- [ ] Toolchain version matches expected (Solana 3.0.2, Rust 1.92.0)
- [ ] Release artifacts generated in `target/release-artifacts/`

### 5. Artifact Verification
- [ ] `checksums.sha256` generated and reviewed
- [ ] `build-metadata.json` contains correct program IDs
- [ ] IDL file included and matches source

Record checksums here for audit trail:
```
entropy: _______________________________________
poker:   _______________________________________
```

---

## Deployment Phase

### 6. Pre-Deployment Checks
- [ ] Mainnet wallet funded with sufficient SOL (minimum 5 SOL recommended)
- [ ] Upgrade authority key secured and accessible
- [ ] Backup of current program state taken (if upgrading)
- [ ] Maintenance window communicated to users

### 7. Deploy Programs
```bash
# Deploy to mainnet
./scripts/deploy-mainnet.sh
```
- [ ] Deployment transaction successful
- [ ] Program IDs match expected values
- [ ] Programs executable and accepting transactions

### 8. On-Chain Verification
```bash
# Verify deployed bytecode matches local build
./scripts/verify-programs.sh --env mainnet --store
```
- [ ] Bytecode verification passed
- [ ] Verification artifacts stored in `target/verification/`
- [ ] (Optional) Registered with solana-verify for public attestation

---

## Post-Deployment Phase

### 9. Smoke Tests
- [ ] Basic transaction succeeds (e.g., create table)
- [ ] Token transfers work correctly
- [ ] Events emit as expected
- [ ] No unexpected error logs

### 10. Monitoring Setup
- [ ] Metrics dashboard accessible
- [ ] Alerts configured for:
  - [ ] Transaction failure rate
  - [ ] Account balance thresholds
  - [ ] Error rate spikes
- [ ] On-call rotation notified

### 11. Client SDK Release
- [ ] SDK version tagged and published
- [ ] NPM package published (if applicable)
- [ ] SDK documentation updated
- [ ] Migration notes published

---

## Rollback Procedure

If issues are discovered post-deployment:

### Immediate Response (< 15 minutes)
1. **Assess severity**: Is this a security issue or funds-at-risk?
2. **Pause if needed**: Use emergency pause procedure (see `GOVERNANCE.md` - Emergency Pause/Disable Procedure)
3. **Communicate**: Alert team via designated channel

### Rollback Steps (if required)
```bash
# 1. Identify previous working version
git log --oneline -10

# 2. Checkout previous version
git checkout <previous-tag>

# 3. Rebuild with previous source
./scripts/build-release.sh --env mainnet

# 4. Redeploy (requires upgrade authority)
solana program deploy target/release-artifacts/robopoker_entropy.so \
  --program-id <ENTROPY_PROGRAM_ID> \
  --upgrade-authority <AUTHORITY_KEYPAIR> \
  --url https://api.mainnet-beta.solana.com

# 5. Verify rollback
./scripts/verify-programs.sh --env mainnet --store
```

### Post-Rollback
- [ ] Incident documented
- [ ] Root cause analysis scheduled
- [ ] User communication sent
- [ ] Postmortem meeting scheduled

---

## Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Release Manager | | | |
| Security Lead | | | |
| Engineering Lead | | | |

---

## Release Metadata

- **Version**: v____.____.____
- **Date**: ____-____-____
- **Commit**: ________________
- **Entropy Program ID**: ________________
- **Poker Program ID**: ________________
- **Client SDK Version**: ________________

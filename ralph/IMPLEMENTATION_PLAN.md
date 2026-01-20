# Implementation Plan

**Date**: 2026-01-20
**Scope**: Production readiness for mainnet release (release engineering, security, ops, reliability, data integrity).

## Tasks (Priority Order)

### Phase 1: Release Engineering + Governance
- [x] Reproducible builds + on-chain verification + release artifacts. AC-PR1.1 to AC-PR1.4. Validation: documented build script + verification evidence.
- [x] Upgrade authority governance + emergency procedures. AC-PR1.5 to AC-PR1.6. Validation: documented multisig/timelock policy.
- [x] Environment config validation + migrations + SDK compatibility policy. AC-PR1.7 to AC-PR1.9. Validation: config validation + migration test plan.

### Phase 2: Security Assurance
- [ ] Threat model + audit completion tracking. AC-SEC1.1 to AC-SEC1.3. Validation: documented model + audit report summary.
- [ ] Security test hardening (fuzz/property/static/dependency). AC-SEC1.4 to AC-SEC1.6. Validation: CI checks.
- [ ] Key management + disclosure process. AC-SEC1.7 to AC-SEC1.9. Validation: documented procedures + access controls.

### Phase 3: Observability + Operations
- [ ] Structured logging + metrics + dashboards. AC-OPS1.1 to AC-OPS1.3. Validation: metrics scrape + dashboard links.
- [ ] Alerts + runbooks. AC-OPS1.4 to AC-OPS1.5. Validation: alert rules + runbook docs.
- [ ] Health checks + backup/restore + postmortem template. AC-OPS1.6 to AC-OPS1.8. Validation: restore drill notes.

### Phase 4: Reliability + Scalability
- [ ] Load tests + compute/fee tuning. AC-REL1.1 to AC-REL1.2. Validation: load test report.
- [ ] RPC failover + provider failover + graceful degradation. AC-REL1.3 to AC-REL1.5. Validation: failure injection tests.
- [ ] Abuse protection + monitoring. AC-REL1.6 to AC-REL1.7. Validation: rate-limit tests + alerting.

### Phase 5: Data Integrity + Indexing
- [ ] Indexing pipeline with checkpoints. AC-DATA1.1 to AC-DATA1.3. Validation: replay test.
- [ ] Reconciliation tooling + retention/backup. AC-DATA1.4 to AC-DATA1.5. Validation: reconciliation report + backup drill.

## Missing/Unknown

None.

## Checklist

- Every referenced AC exists in specs: yes
- No phantom AC-PQ introduced: yes
- No control characters in output: yes

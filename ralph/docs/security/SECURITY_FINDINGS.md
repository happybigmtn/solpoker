# Security Findings Tracker

**Date:** 2026-01-21
**Version:** 1.1
**AC Coverage:** AC-SEC1.3

---

## Active Findings

### Critical

| ID | Title | Component | Owner | Status | Due Date | Verified |
|----|-------|-----------|-------|--------|----------|----------|
| - | (None) | - | - | - | - | - |

### High

| ID | Title | Component | Owner | Status | Due Date | Verified |
|----|-------|-----------|-------|--------|----------|----------|
| - | (None) | - | - | - | - | - |

### Medium

| ID | Title | Component | Owner | Status | Due Date | Verified |
|----|-------|-----------|-------|--------|----------|----------|
| - | (None) | - | - | - | - | - |

### Low

| ID | Title | Component | Owner | Status | Due Date | Verified |
|----|-------|-----------|-------|--------|----------|----------|
| LOW-001 | Unmaintained transitive dependencies | sdk | Dev Team | Accepted | N/A | N/A |
| LOW-002 | Pointer alignment warnings | robopoker-entropy | Dev Team | Accepted | N/A | N/A |

---

## Finding Template

When adding a new finding, use this template:

```markdown
## FINDING-XXX: [Title]

**Severity:** Critical | High | Medium | Low
**Component:** [crisps_entropy | robopoker_onchain | entropy-provider | ui | sdk]
**Source:** [Internal Review | External Audit | Bug Bounty | Incident]
**Reported Date:** YYYY-MM-DD
**Owner:** [Name/Handle]
**Status:** Open | In Progress | Fixed | Mitigated | Accepted | Won't Fix

### Description

[Detailed description of the vulnerability or issue]

### Impact

[What could happen if exploited? Who is affected?]

### Reproduction Steps

1. [Step 1]
2. [Step 2]
3. [Step 3]

### Proof of Concept

[Code, transaction, or demonstration if applicable]

### Remediation Plan

**Approach:** [How will this be fixed?]
**Timeline:** [When will the fix be deployed?]
**Dependencies:** [Any blockers?]

### Verification Evidence

**Fixed In:** [Commit hash or PR link]
**Test Coverage:** [New tests added?]
**Auditor Verification:** [Required for Critical/High - auditor sign-off]
**Deployment:** [Mainnet deployment date if applicable]

### Notes

[Additional context, discussion, or decision rationale]
```

---

---

## LOW-001: Unmaintained Transitive Dependencies

**Severity:** Low
**Component:** sdk (transitive via Solana SDK)
**Source:** Internal Review - cargo audit
**Reported Date:** 2026-01-21
**Owner:** Dev Team
**Status:** Accepted

### Description

`cargo audit` reports 4 unmaintained crate warnings:
- `ansi_term 0.12.1` (RUSTSEC-2021-0139)
- `bincode 1.3.3` (RUSTSEC-2025-0141)
- `derivative 2.2.0` (RUSTSEC-2024-0388)
- `paste 1.0.15` (RUSTSEC-2024-0436)

All are **transitive dependencies** from Solana SDK (solana-*, litesvm, ark-* crates), not direct project dependencies.

### Impact

Minimal. These are "unmaintained" notices, not security vulnerabilities. No CVE assigned. No exploitable conditions identified.

### Remediation Plan

**Approach:** Monitor for Solana SDK updates that address these dependencies.
**Dependencies:** Upstream Solana SDK must update first.

### Verification Evidence

```
cargo audit --version: cargo-audit 0.21.3
Last run: 2026-01-21
Result: 0 vulnerabilities, 4 warnings (unmaintained)
```

### Notes

Accepted because:
1. No CVE or exploitable vulnerability
2. Dependencies are controlled by upstream Solana SDK
3. Replacing would require forking Solana SDK

---

## LOW-002: Pointer Alignment Warnings in Instruction Parsing

**Severity:** Low
**Component:** robopoker-entropy
**Source:** Internal Review - cargo clippy
**Reported Date:** 2026-01-21
**Owner:** Dev Team
**Status:** Accepted

### Description

Clippy reports pointer alignment warnings in instruction parsing:
- `casting from *const u8 to a more-strictly-aligned pointer (*const instruction::*)`

This is a common pattern in Solana programs using Pinocchio for zero-copy deserialization.

### Impact

Minimal on Solana BPF runtime:
- Solana BPF VM uses 8-byte aligned instruction data
- Runtime guarantees alignment for instruction payloads
- Pattern matches Pinocchio framework conventions

### Remediation Plan

**Approach:** Accept for now. Consider using `bytemuck` or explicit alignment assertions if runtime behavior changes.

### Verification Evidence

```
cargo clippy -- -W clippy::pedantic
Result: Alignment warnings present but do not indicate security vulnerability
```

### Notes

Accepted because:
1. Solana runtime guarantees instruction data alignment
2. Pattern is idiomatic for Pinocchio framework
3. No observed runtime panics in testing

---

## Closed Findings Archive

| ID | Title | Severity | Resolution | Closed Date |
|----|-------|----------|------------|-------------|
| - | (None) | - | - | - |

---

## Finding Workflow

```
┌─────────┐     ┌─────────────┐     ┌─────────────┐     ┌──────────┐
│ Reported│────►│ Triaged     │────►│ In Progress │────►│ Fixed    │
└─────────┘     └─────────────┘     └─────────────┘     └────┬─────┘
                      │                                       │
                      │ Won't Fix / Accepted                  │
                      ▼                                       ▼
               ┌─────────────┐                         ┌──────────┐
               │ Closed      │◄────────────────────────│ Verified │
               │ (Documented)│                         └──────────┘
               └─────────────┘
```

### Status Definitions

| Status | Definition | Who Can Transition |
|--------|------------|-------------------|
| **Open** | New finding, not yet triaged | Anyone |
| **Triaged** | Severity assigned, owner assigned | Security Lead |
| **In Progress** | Fix being developed | Owner |
| **Fixed** | Code merged, awaiting verification | Owner |
| **Mitigated** | Alternative control in place | Security Lead |
| **Accepted** | Risk accepted with justification | Security Lead + Engineering Lead |
| **Won't Fix** | Invalid or out of scope | Security Lead |
| **Verified** | Fix confirmed working | QA / Auditor |
| **Closed** | Deployed to production | Security Lead |

---

## Owner Responsibilities

1. **Acknowledge** finding within 1 business day
2. **Provide remediation plan** within severity-based SLA:
   - Critical: 24 hours
   - High: 3 days
   - Medium: 7 days
   - Low: 14 days
3. **Implement fix** according to plan
4. **Document verification evidence**
5. **Request verification** from Security Lead

---

## Metrics

### Current Snapshot

| Metric | Value |
|--------|-------|
| Open Critical | 0 |
| Open High | 0 |
| Open Medium | 0 |
| Open Low | 2 (Accepted) |
| Total Closed (All Time) | 0 |
| Mean Time to Remediation | N/A |

### Monthly Trend

| Month | Opened | Closed | Critical MTTR | High MTTR |
|-------|--------|--------|---------------|-----------|
| 2026-01 | 2 | 0 | N/A | N/A |

---

## Integration Points

### Bug Bounty Program

When/if a bug bounty program is established:
- Bounty submissions flow into this tracker
- Severity mapping: Bounty tier → Finding severity
- Payout tracked in finding notes

### Incident Response

Post-incident findings are logged here with:
- Source: "Incident - INC-XXX"
- Link to incident report
- Root cause analysis reference

### CI/CD Pipeline

Automated findings from:
- `cargo audit` (dependency vulnerabilities)
- Static analysis (clippy, semgrep)
- Dependency bots (Dependabot alerts)

Format: `AUTO-[tool]-[date]-[hash]`

---

## Access Control

| Role | Can View | Can Create | Can Assign | Can Close |
|------|----------|------------|------------|-----------|
| Developer | Yes | Yes | No | No |
| Security Lead | Yes | Yes | Yes | Yes |
| Engineering Lead | Yes | Yes | Yes | Yes |
| External Auditor | Scope Only | Yes | No | No |

---

## Revision History

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2026-01-20 | 1.0 | Claude | Initial findings tracker |
| 2026-01-21 | 1.1 | Claude | Added LOW-001, LOW-002 from internal review |

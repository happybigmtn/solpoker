# Archive (Completed Work)

Move completed plan items here when `IMPLEMENTATION_PLAN.md` gets too large.

Format suggestions:
- Date
- Task name
- Links to PRs/commits (if applicable)
- Notes about learnings / follow-ups

## 2026-01-19
- Scaffold workspace + deterministic core crate
  - Commit: `bada191`
  - Notes: Removed `rand` from core crate dev-dependencies to enforce deterministic, seed-driven shuffles.
- Entropy program MVP + provider service
  - Commit: `b29d729`
  - Notes: Added request re-init protection, config initialization checks in finalize, and duplicate account guardrails.
- CRISPS mint + table vault escrow flows
  - Commit: `26b8134`
  - Notes: Verified Token-2022 vault authority checks and escrow transfer flows for join/leave.
- Table lifecycle + seating + timeouts
  - Commit: `26b8134`
  - Notes: Timeout actions fold deterministically; table/seat transitions validated for WAITING/PLAYING flows.
- Betting rounds + action validation
  - Commit: `26b8134`
  - Notes: Reviewed betting action validation and raise/all-in handling against AC-5.1–AC-5.3.
- Settlement + side pots
  - Commit: `26b8134`
  - Notes: Reviewed side-pot distribution logic and showdown eligibility handling for AC-6.1–AC-6.2.
- Security validations pass
  - Commit: `26b8134`
  - Notes: Verified PDA/owner/signer validation coverage across instructions and tests.
- Privacy hybrid flow (encrypted hole cards + seed reveal)
  - Commit: `26b8134`
  - Notes: Reviewed seed commitment validation and hole-card hash checks for AC-2.6–AC-2.8.

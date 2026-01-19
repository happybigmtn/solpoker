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

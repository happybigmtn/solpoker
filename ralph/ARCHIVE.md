# Archive (Completed Work)

Move completed plan items here when `IMPLEMENTATION_PLAN.md` gets too large.

Format suggestions:
- Date
- Task name
- Links to PRs/commits (if applicable)
- Notes about learnings / follow-ups

## 2026-01-19
- Build and deploy programs to devnet
  - Commit: (see git log)
  - Notes: Updated on-chain program IDs for devnet deployments, aligned `robopoker-core` to edition 2021 for `cargo build-sbf`, added bytecode verification script (`scripts/verify-programs.sh`), and documented AC-D1.* in `specs/devnet-deployment.md`.
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
- Rake + staking integration
  - Commit: `26b8134`
  - Notes: Reviewed staking flows, Token-2022 vault checks, and rake sweep path for AC-3.4–AC-3.6.
- On-chain data layout optimization pass
  - Commit: `cd33520`
  - Notes: Verified table/header sizing and client parsers updated for 1,136-byte layout.
- UI scaffold (Next.js App Router) with framework‑kit + wallet standard
  - Commit: `cd33520`
  - Notes: Confirmed framework-kit providers and wallet-standard discovery wiring.
- Keyboard‑first interaction + minimal styling
  - Commit: `cd33520`
  - Notes: Reviewed keyboard shortcut mapping and raise input behavior against AC-2.x and AC-PQ requirements.
- UI layout + data subscriptions + perf
  - Commit: `cd33520`
  - Notes: Reviewed table store selective subscriptions and UI layout scaffolding for AC-3.x/AC-4.x.
- Accessibility + interaction hygiene pass
  - Commit: `cd33520`
  - Notes: Reviewed command palette semantics, focus handling, and keyboard-only flows for AC-5.x.
- Client SDK + integration test
  - Commit: `cd33520`
  - Notes: Reviewed generated TypeScript client build and integration test coverage for AC-8.1–AC-8.3.

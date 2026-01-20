# Archive (Completed Work)

Move completed plan items here when `IMPLEMENTATION_PLAN.md` gets too large.

Format suggestions:
- Date
- Task name
- Links to PRs/commits (if applicable)
- Notes about learnings / follow-ups

## 2026-01-20

- Action wiring (fold/check/call/raise/shove/join/leave). AC-CI3.1 to AC-CI3.7. Validation: hook tests.
  - Commit: (see git log)
  - Notes: Archived from implementation plan after review.

- Transaction wiring + signing + status surfacing. AC-CI2.1 to AC-CI2.4, AC-PQ.CI1. Validation: hook tests.
  - Commit: (see git log)
  - Notes: Archived from implementation plan after review.

- PDA helpers + instruction builders in TS SDK. AC-CI1.1 to AC-CI1.4. Validation: TS unit tests.
  - Commit: (see git log)
  - Notes: Archived from implementation plan after review.

- Provider UX quality. AC-PQ.EP1 to AC-PQ.EP2. Validation: log review.
  - Commit: (see git log)
  - Notes: Archived from implementation plan after review.

- CLI commands. AC-EP6.1 to AC-EP6.3. Validation: CLI smoke tests.
  - Commit: (see git log)
  - Notes: Archived from implementation plan after review.

- Reliability + logging. AC-EP5.1 to AC-EP5.4. Validation: disconnect/restart tests.
  - Commit: (see git log)
  - Notes: Archived from implementation plan after review.

- Request subscription + concurrency handling. AC-EP4.1 to AC-EP4.3. Validation: multi-request simulation.
  - Commit: (see git log)
  - Notes: Archived from implementation plan after review.

- Slot monitoring + reveal + randomness. AC-EP3.1 to AC-EP3.4. Validation: deadline + randomness tests.
  - Commit: (see git log)
  - Notes: Archived from implementation plan after review.

- Commit flow + pending tracking. AC-EP2.1 to AC-EP2.3. Validation: integration test.
  - Commit: (see git log)
  - Notes: Archived from implementation plan after review.

- Hash chain generation + persistence. AC-EP1.1 to AC-EP1.4. Validation: unit tests.
  - Commit: (see git log)
  - Notes: Archived from implementation plan after review.

- Typed SDK generated from IDL with core instruction builders. AC-8.3. Validation: SDK smoke tests.
  - Commit: (see git log)
  - Notes: Archived from implementation plan after review.

- Instruction unit tests + full-hand integration test. AC-8.1 to AC-8.2. Validation: LiteSVM/Mollusk + Surfpool as needed.
  - Commit: (see git log)
  - Notes: Archived from implementation plan after review.

- Owner/signer/PDA validation + account duplication checks. AC-7.1 to AC-7.3. Validation: negative tests.
  - LiteSVM test: Initialize rejects missing authority signer (AC-7.1).
  - LiteSVM test: JoinTable rejects missing player signer (AC-7.1).
  - LiteSVM test: PlayerAction rejects missing player signer (AC-7.1).
  - LiteSVM test: Initialize rejects wrong config PDA (AC-7.2).
  - LiteSVM test: CreateTable rejects wrong table PDA (AC-7.2).
  - LiteSVM test: JoinTable rejects wrong vault account (AC-7.2).
  - LiteSVM test: CreateTable rejects duplicate mutable accounts (AC-7.3).
  - LiteSVM test: JoinTable rejects duplicate mutable accounts (AC-7.3).
  - LiteSVM test: LeaveTable rejects duplicate mutable accounts (AC-7.3).
  - Commit: (see git log)
  - Notes: Archived from implementation plan after review.

- Settlement + payout invariants. AC-6.1 to AC-6.2. Validation: side-pot payout tests.
  - LiteSVM settlement tests: heads-up, side-pot all-in, invariant violation checks (AC-6.1, AC-6.2).
  - Commit: (see git log)
  - Notes: Archived from implementation plan after review.

- Betting rules + legal action enforcement. AC-5.1 to AC-5.3. Validation: illegal action failure tests.
  - LiteSVM invalid action tests: out-of-turn, check-when-bet, raise bounds (AC-5.2, AC-5.3).
  - LiteSVM valid action tests: call/raise/fold success paths (AC-5.1, AC-5.2).
  - Commit: (see git log)
  - Notes: Archived from implementation plan after review.

- Table create/join/leave + timeouts. AC-4.1 to AC-4.4. Validation: lifecycle tests + timeout cases.
  - LiteSVM table lifecycle create/join/leave test (AC-4.2).
  - LiteSVM timeout deadline + fallback tests (AC-4.4).
  - Account size test asserts MAX_SEATS = 10 (AC-4.1).
  - Commit: (see git log)
  - Notes: Archived from implementation plan after review.

- Rake + staking pool flows. AC-3.4 to AC-3.6. Validation: staking deposit/withdraw + claim tests.
  - LiteSVM init staking pool sets PDA vault metadata (AC-3.5).
  - LiteSVM deposit stake test with real Token-2022 transfers (AC-3.5).
  - LiteSVM withdraw stake test with real Token-2022 transfers (AC-3.5).
  - LiteSVM claim rewards test with proportional distribution (AC-3.6).
  - LiteSVM sweep rake test moving table rake to rewards vault (AC-3.4).
  - Commit: (see git log)
  - Notes: Archived from implementation plan after review.

- Token-2022 mint + vault escrow flows. AC-3.1 to AC-3.3. Validation: token balance tests.
  - LiteSVM initialize config sets CRISPS mint + authority (AC-3.1).
  - LiteSVM create table creates PDA vault token account (AC-3.2).
  - LiteSVM join/leave token balance tests using real Token-2022 program (AC-3.3).
  - Commit: (see git log)
  - Notes: Archived from implementation plan after review.

- Hole-card privacy + showdown verification. AC-2.6 to AC-2.8. Validation: tests for deck derivation + reveal checks.
  - Commit: (see git log)
  - Notes: Archived from implementation plan after review.

- Poker CPI to entropy + single-provider enforcement. AC-2.4 to AC-2.5. Validation: CPI integration test.
  - Commit: (see git log)
  - Notes: Archived from implementation plan after review.

- Commitment verification + randomness derivation + bond slashing. AC-2.1 to AC-2.3. Validation: unit tests for commit/reveal correctness.
  - Commit: (see git log)
  - Notes: Archived from implementation plan after review.

- Pinocchio program entrypoints + routers. AC-1.4. Validation: local deploy + smoke instruction.
  - Commit: (see git log)
  - Notes: Archived from implementation plan after review.

- Deterministic core crate + fixed-size layouts + size docs. AC-1.1 to AC-1.6. Validation: unit tests + size assertions.
  - Commit: (see git log)
  - Notes: Archived from implementation plan after review.

## 2026-01-19
- Wire player action buttons to real transactions
  - Commit: (see git log)
  - Notes: Added use-player-action hook + UI wiring to send real fold/check/call/raise/shove transactions with pending/confirmed status updates. Follow-up: added current bet/min-raise selectors used for action calculations.
- Wire join/leave table actions
  - Commit: (see git log)
  - Notes: Added use-table-action hook + table page wiring for join/leave, including vault PDA/ATA derivation and default buy-in handling; tests cover join/leave instruction building.
- Implement transaction error handling
  - Commit: (see git log)
  - Notes: Added client error decoding utilities + mappings, hook-level retry support for network errors, and retry UI integration; updated tests for error decoding and retry behavior.
- Implement table list and creation UI
  - Commit: (see git log)
  - Notes: Added use-tables + use-create-table hooks, lobby/table list/create form components, and home page wiring; hooked UI to local client SDK package.
- Implement card rendering
  - Commit: (see git log)
  - Notes: Added card UI components and deterministic derivation helpers; table UI now displays board and hole cards with correct suit/rank mapping and street visibility.
- Verify full hand lifecycle on devnet
  - Commit: (see git log)
  - Notes: Added devnet E2E hand lifecycle script plus fixes for entropy request funding, slothash selection, CPI account ordering, and on-chain safety checks uncovered during verification.
- Add PDA derivation utilities to TypeScript client
  - Commit: (see git log)
  - Notes: Added `src/pda.ts` with poker/entropy PDAs and deterministic test vectors for AC-CI1.*.
- Implement provider CLI
  - Commit: (see git log)
  - Notes: Added commander-based CLI (generate/start/status) with config validation and status output tests.
- Implement reliability (reconnect, persistence, logging)
  - Commit: (see git log)
  - Notes: Added Logger + ProviderDaemon with persistence/reconnect logic and AC-EP5 tests for recovery and logging behavior.
- Implement request subscription and auto-handling
  - Commit: (see git log)
  - Notes: Added request watcher polling, auto-handler with mutex queueing, request PDA parsing helpers, and AC-EP4 tests.
- Implement reveal flow with slot monitoring
  - Commit: (see git log)
  - Notes: Added reveal pipeline utilities with slot waiting, deadline checks, on-chain verification, and randomness derivation tests for AC-EP3.*.
- Implement commitment posting
  - Commit: (see git log)
  - Notes: Added entropy-provider commit flow with PDA derivation, on-chain verification helpers, and devnet integration tests for AC-EP2.*.
- Implement hash chain generation and persistence
  - Commit: (see git log)
  - Notes: Added entropy-provider package scaffold with hash-chain generator, persistence helpers, and AC-EP1 test coverage.
- Create deployment automation script
  - Commit: (see git log)
  - Notes: Added `scripts/deploy-devnet.sh` for build/deploy/init/mint/env generation and ensured init-configs can read program IDs from env for fresh deployments.
- Create CRISPS mint, faucet, and poker config
  - Commit: (see git log)
  - Notes: Added Token-2022 CRISPS mint creation + faucet scripts, devnet verification script for AC-D3.*, and poker config PDA initialization support in-program.
- Build and deploy programs to devnet
  - Commit: (see git log)
  - Notes: Updated on-chain program IDs for devnet deployments, aligned `robopoker-core` to edition 2021 for `cargo build-sbf`, added bytecode verification script (`scripts/verify-programs.sh`), and documented AC-D1.* in `specs/devnet-deployment.md`.
- Initialize config accounts on devnet (entropy config only)
  - Commit: (see git log)
  - Notes: Added entropy config PDA creation via CPI in the program, plus `clients/ts` init/verify scripts with shared RPC config and `.env.example` support for AC-D2.1/AC-D2.3.
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

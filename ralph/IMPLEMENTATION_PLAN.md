# Implementation Plan

**Date**: 2026-01-19
**Scope**: Full v1 delivery through devnet demo (on-chain core, provider, SDK, UI, deployment).

## Tasks (Priority Order)

### Phase 1: Core Program Architecture
### Phase 2: Entropy On-Chain + Privacy
### Phase 3: Token, Table Lifecycle, Betting, Settlement
- [x] Betting rules + legal action enforcement. AC-5.1 to AC-5.3. Validation: illegal action failure tests.
  - [x] LiteSVM invalid action tests: out-of-turn, check-when-bet, raise bounds (AC-5.2, AC-5.3).
  - [x] LiteSVM valid action tests: call/raise/fold success paths (AC-5.1, AC-5.2).
- [x] Settlement + payout invariants. AC-6.1 to AC-6.2. Validation: side-pot payout tests.
  - [x] LiteSVM settlement tests: heads-up, side-pot all-in, invariant violation checks (AC-6.1, AC-6.2).

### Phase 4: Security + Testing + SDK Generation
- [x] Owner/signer/PDA validation + account duplication checks. AC-7.1 to AC-7.3. Validation: negative tests.
  - [x] LiteSVM test: Initialize rejects missing authority signer (AC-7.1).
  - [x] LiteSVM test: JoinTable rejects missing player signer (AC-7.1).
  - [x] LiteSVM test: PlayerAction rejects missing player signer (AC-7.1).
  - [x] LiteSVM test: Initialize rejects wrong config PDA (AC-7.2).
  - [x] LiteSVM test: CreateTable rejects wrong table PDA (AC-7.2).
  - [x] LiteSVM test: JoinTable rejects wrong vault account (AC-7.2).
  - [x] LiteSVM test: CreateTable rejects duplicate mutable accounts (AC-7.3).
  - [x] LiteSVM test: JoinTable rejects duplicate mutable accounts (AC-7.3).
  - [x] LiteSVM test: LeaveTable rejects duplicate mutable accounts (AC-7.3).
- [x] Instruction unit tests + full-hand integration test. AC-8.1 to AC-8.2. Validation: LiteSVM/Mollusk + Surfpool as needed.
- [x] Typed SDK generated from IDL with core instruction builders. AC-8.3. Validation: SDK smoke tests.

### Phase 5: Entropy Provider Service
- [x] Hash chain generation + persistence. AC-EP1.1 to AC-EP1.4. Validation: unit tests.
- [x] Commit flow + pending tracking. AC-EP2.1 to AC-EP2.3. Validation: integration test.
- [x] Slot monitoring + reveal + randomness. AC-EP3.1 to AC-EP3.4. Validation: deadline + randomness tests.
- [x] Request subscription + concurrency handling. AC-EP4.1 to AC-EP4.3. Validation: multi-request simulation.
- [x] Reliability + logging. AC-EP5.1 to AC-EP5.4. Validation: disconnect/restart tests.
- [x] CLI commands. AC-EP6.1 to AC-EP6.3. Validation: CLI smoke tests.
- [x] Provider UX quality. AC-PQ.EP1 to AC-PQ.EP2. Validation: log review.

### Phase 6: Client Integration + UI
- [x] PDA helpers + instruction builders in TS SDK. AC-CI1.1 to AC-CI1.4. Validation: TS unit tests.
- [x] Transaction wiring + signing + status surfacing. AC-CI2.1 to AC-CI2.4, AC-PQ.CI1. Validation: hook tests.
- [x] Action wiring (fold/check/call/raise/shove/join/leave). AC-CI3.1 to AC-CI3.7. Validation: hook tests.
- [x] Error handling + simulation surfacing. AC-CI4.1 to AC-CI4.4, AC-PQ.CI2. Validation: error mapping tests.
- [x] Table discovery + card rendering. AC-CI5.1 to AC-CI6.4, AC-PQ.CI3. Validation: component tests.
- [x] Framework-kit + wallet standard + App Router structure. AC-1.1 to AC-1.5. Validation: UI smoke tests.
- [x] Keyboard-first UX (palette + shortcuts + raise input). AC-2.1 to AC-2.4. Validation: component tests.
- [x] Layout + state messaging + performance constraints. AC-3.1 to AC-4.10. Validation: render tests + bundle check.
- [x] Accessibility/forms/typography/navigation/touch/assets/hydration/theming. AC-5.1 to AC-11.1. Validation: lint + manual keyboard walkthrough.
- [x] UI perceptual quality. AC-PQ.1 to AC-PQ.3. Validation: manual QA.

### Phase 7: Devnet Deployment + Verification
- [x] Deploy script builds + deploys programs, initializes configs, creates CRISPS mint + metadata. AC-D1.1 to AC-D3.4, AC-D4.1. Validation: run `./scripts/deploy-devnet.sh` + RPC verification.
- [x] Idempotency + env output for clients. AC-D4.2 to AC-D4.3. Validation: re-run deploy script + `./scripts/verify-programs.sh`.
- [x] Devnet table lifecycle via scripts/RPC. AC-D5.1 to AC-D5.3. Validation: lifecycle script + RPC inspection.
- [x] Devnet demo readiness (provider + UI). AC-D6.1 to AC-D6.6. Validation: run provider + UI, update devnet status doc.

## Missing/Unknown

None.

## Checklist

- Every referenced AC exists in specs: yes
- No phantom AC-PQ introduced: yes
- No control characters in output: yes

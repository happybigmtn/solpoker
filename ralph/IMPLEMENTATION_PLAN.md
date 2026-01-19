# Implementation Plan

**Date**: 2026-01-19
**Scope**: Full v1 delivery through devnet demo (on-chain core, provider, SDK, UI, deployment).

## Tasks (Priority Order)

### Phase 1: Core Program Architecture
- [x] Deterministic core crate + fixed-size layouts + size docs. AC-1.1 to AC-1.6. Validation: unit tests + size assertions.
- [x] Pinocchio program entrypoints + routers. AC-1.4. Validation: local deploy + smoke instruction.

### Phase 2: Entropy On-Chain + Privacy
- [x] Commitment verification + randomness derivation + bond slashing. AC-2.1 to AC-2.3. Validation: unit tests for commit/reveal correctness.
- [x] Poker CPI to entropy + single-provider enforcement. AC-2.4 to AC-2.5. Validation: CPI integration test.
- [ ] Hole-card privacy + showdown verification. AC-2.6 to AC-2.8. Validation: tests for deck derivation + reveal checks.

### Phase 3: Token, Table Lifecycle, Betting, Settlement
- [ ] Token-2022 mint + vault escrow flows. AC-3.1 to AC-3.3. Validation: token balance tests.
- [ ] Rake + staking pool flows. AC-3.4 to AC-3.6. Validation: staking deposit/withdraw + claim tests.
- [ ] Table create/join/leave + timeouts. AC-4.1 to AC-4.4. Validation: lifecycle tests + timeout cases.
- [ ] Betting rules + legal action enforcement. AC-5.1 to AC-5.3. Validation: illegal action failure tests.
- [ ] Settlement + payout invariants. AC-6.1 to AC-6.2. Validation: side-pot payout tests.

### Phase 4: Security + Testing + SDK Generation
- [ ] Owner/signer/PDA validation + account duplication checks. AC-7.1 to AC-7.3. Validation: negative tests.
- [ ] Instruction unit tests + full-hand integration test. AC-8.1 to AC-8.2. Validation: LiteSVM/Mollusk + Surfpool as needed.
- [ ] Typed SDK generated from IDL with core instruction builders. AC-8.3. Validation: SDK smoke tests.

### Phase 5: Entropy Provider Service
- [ ] Hash chain generation + persistence. AC-EP1.1 to AC-EP1.4. Validation: unit tests.
- [ ] Commit flow + pending tracking. AC-EP2.1 to AC-EP2.3. Validation: integration test.
- [ ] Slot monitoring + reveal + randomness. AC-EP3.1 to AC-EP3.4. Validation: deadline + randomness tests.
- [ ] Request subscription + concurrency handling. AC-EP4.1 to AC-EP4.3. Validation: multi-request simulation.
- [ ] Reliability + logging. AC-EP5.1 to AC-EP5.4. Validation: disconnect/restart tests.
- [ ] CLI commands. AC-EP6.1 to AC-EP6.3. Validation: CLI smoke tests.
- [ ] Provider UX quality. AC-PQ.EP1 to AC-PQ.EP2. Validation: log review.

### Phase 6: Client Integration + UI
- [ ] PDA helpers + instruction builders in TS SDK. AC-CI1.1 to AC-CI1.4. Validation: TS unit tests.
- [ ] Transaction wiring + signing + status surfacing. AC-CI2.1 to AC-CI2.4, AC-PQ.CI1. Validation: hook tests.
- [ ] Action wiring (fold/check/call/raise/shove/join/leave). AC-CI3.1 to AC-CI3.7. Validation: hook tests.
- [ ] Error handling + simulation surfacing. AC-CI4.1 to AC-CI4.4, AC-PQ.CI2. Validation: error mapping tests.
- [ ] Table discovery + card rendering. AC-CI5.1 to AC-CI6.4, AC-PQ.CI3. Validation: component tests.
- [ ] Framework-kit + wallet standard + App Router structure. AC-1.1 to AC-1.5. Validation: UI smoke tests.
- [ ] Keyboard-first UX (palette + shortcuts + raise input). AC-2.1 to AC-2.4. Validation: component tests.
- [ ] Layout + state messaging + performance constraints. AC-3.1 to AC-4.10. Validation: render tests + bundle check.
- [ ] Accessibility/forms/typography/navigation/touch/assets/hydration/theming. AC-5.1 to AC-11.1. Validation: lint + manual keyboard walkthrough.
- [ ] UI perceptual quality. AC-PQ.1 to AC-PQ.3. Validation: manual QA.

### Phase 7: Devnet Deployment + Verification
- [ ] Deploy script builds + deploys programs, initializes configs, creates CRISPS mint + metadata. AC-D1.1 to AC-D3.4, AC-D4.1. Validation: run `./scripts/deploy-devnet.sh` + RPC verification.
- [ ] Idempotency + env output for clients. AC-D4.2 to AC-D4.3. Validation: re-run deploy script + `./scripts/verify-programs.sh`.
- [ ] Devnet table lifecycle via scripts/RPC. AC-D5.1 to AC-D5.3. Validation: lifecycle script + RPC inspection.
- [ ] Devnet demo readiness (provider + UI). AC-D6.1 to AC-D6.6. Validation: run provider + UI, update devnet status doc.

## Missing/Unknown

- CRISPS metadata values (name/symbol/URI) for AC-D3.4.

## Checklist

- Every referenced AC exists in specs: yes
- No phantom AC-PQ introduced: yes
- No control characters in output: yes

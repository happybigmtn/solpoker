# Implementation Plan (Ralph Phase 2)

**Date**: 2026-01-19
**Scope**: Build the on-chain multiplayer poker stack (Pinocchio), self-hosted entropy RNG, CRISPS token escrow flows, and a keyboard-first minimal UI.

## Tasks (Priority Order)

- [x] Scaffold workspace + deterministic core crate
  - Specs: `specs/onchain-poker.md` AC-1.1, AC-1.2, AC-1.3, AC-1.6
  - Tests/backpressure:
    - Programmatic: `cargo test -p robopoker-core` includes deterministic deck test
    - Programmatic: static check that core crate has no `rand` dependency
  - Perceptual: None

- [x] Entropy program MVP + provider service
  - Specs: `specs/onchain-poker.md` AC-2.1, AC-2.2, AC-2.3, AC-2.4, AC-2.5
  - Tests/backpressure:
    - Programmatic: Mollusk test for commit -> reveal -> randomness derivation
    - Programmatic: Mollusk test for missed reveal -> slash
  - Perceptual: None

- [x] CRISPS mint + table vault escrow flows
  - Specs: `specs/onchain-poker.md` AC-3.1, AC-3.2, AC-3.3
  - Tests/backpressure:
    - Programmatic: LiteSVM test for join (debit player, credit vault)
    - Programmatic: LiteSVM test for leave (credit player, debit vault)
  - Perceptual: None

- [x] Table lifecycle + seating + timeouts
  - Specs: `specs/onchain-poker.md` AC-4.1, AC-4.2, AC-4.3, AC-4.4
  - Tests/backpressure:
    - Programmatic: LiteSVM test for create/join/leave
    - Programmatic: LiteSVM test for timeout auto-action
  - Perceptual: None

- [x] Betting rounds + action validation
  - Specs: `specs/onchain-poker.md` AC-5.1, AC-5.2, AC-5.3
  - Tests/backpressure:
    - Programmatic: Mollusk test for legal actions per street
    - Programmatic: Mollusk test for invalid raise/call/out-of-turn
  - Perceptual: None

- [x] Settlement + side pots
  - Specs: `specs/onchain-poker.md` AC-6.1, AC-6.2
  - Tests/backpressure:
    - Programmatic: Mollusk test for multiway side-pot payout correctness
  - Perceptual: None

- [x] Security validations pass
  - Specs: `specs/onchain-poker.md` AC-7.1, AC-7.2, AC-7.3, AC-7.4
  - Tests/backpressure:
    - Programmatic: owner/signer/PDA mismatch tests fail as expected
  - Perceptual: None

- [x] Privacy hybrid flow (encrypted hole cards + seed reveal)
  - Specs: `specs/onchain-poker.md` AC-2.6, AC-2.7, AC-2.8
  - Tests/backpressure:
    - Programmatic: integration test that seed reveal validates deck and hole cards
  - Perceptual: None

- [x] Rake + staking integration
  - Specs: `specs/onchain-poker.md` AC-3.4, AC-3.5, AC-3.6
  - Tests/backpressure:
    - Programmatic: staking deposit/withdraw tests
    - Programmatic: rake accumulation + claim distribution tests
  - Perceptual: None

- [x] On-chain data layout optimization pass
  - Specs: `specs/onchain-poker.md` AC-1.5
  - Tests/backpressure:
    - Programmatic: account size snapshot tests for Table/Config/Vault structs
  - Perceptual: None

- [x] UI scaffold (Next.js App Router) with framework‑kit + wallet standard
  - Specs: `specs/ui-minimal.md` AC-1.1, AC-1.2, AC-1.3, AC-1.4, AC-1.5
  - Tests/backpressure:
    - Programmatic: UI build passes and wallet connect flow initializes without errors
  - Perceptual: None

- [x] Keyboard‑first interaction + minimal styling
  - Specs: `specs/ui-minimal.md` AC-2.1, AC-2.2, AC-2.3, AC-2.4, AC-PQ.1, AC-PQ.2, AC-PQ.3, AC-6.1, AC-6.2, AC-6.3, AC-6.4, AC-6.5, AC-6.6
  - Tests/backpressure:
    - Programmatic: shortcut mapping test (unit or e2e) verifies all primary actions
  - Perceptual: AC-PQ.1, AC-PQ.2, AC-PQ.3

- [x] UI layout + data subscriptions + perf
  - Specs: `specs/ui-minimal.md` AC-3.1, AC-3.2, AC-3.3, AC-3.4, AC-4.1, AC-4.2, AC-4.3, AC-4.4, AC-4.5, AC-4.6, AC-4.7, AC-4.8, AC-4.9, AC-4.10, AC-7.1, AC-7.2, AC-8.1, AC-8.2, AC-8.3, AC-9.1, AC-9.2, AC-10.1, AC-10.2, AC-10.3, AC-11.1
  - Tests/backpressure:
    - Programmatic: table subscription updates only relevant components
  - Perceptual: None

- [x] Accessibility + interaction hygiene pass
  - Specs: `specs/ui-minimal.md` AC-5.1, AC-5.2, AC-5.3, AC-5.4, AC-5.5, AC-5.6, AC-5.7, AC-5.8, AC-5.9, AC-5.10, AC-5.11, AC-5.12, AC-5.13, AC-5.14, AC-5.15
  - Tests/backpressure:
    - Programmatic: keyboard-only navigation audit for primary flows
  - Perceptual: None

- [x] Client SDK + integration test
  - Specs: `specs/onchain-poker.md` AC-8.1, AC-8.2, AC-8.3
  - Tests/backpressure:
    - Programmatic: generated TS client builds and constructs core instructions
    - Programmatic: full-hand integration test (3+ players) passes
  - Perceptual: None

## Missing/Unknown

- None

## Checklist

- Every referenced AC exists in specs: yes
- No phantom AC-PQ introduced: yes
- No control characters in output: yes

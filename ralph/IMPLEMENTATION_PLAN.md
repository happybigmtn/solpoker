# Implementation Plan (Ralph Phase 2)

**Date**: 2026-01-19
**Scope**: Build the on-chain multiplayer poker stack (Pinocchio), self-hosted entropy RNG, CRISPS token escrow flows, and a keyboard-first minimal UI.

## Tasks (Priority Order)

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

# Implementation Plan (Ralph Phase 2)

**Date**: 2026-01-19
**Scope**: Build the on-chain multiplayer poker stack (Pinocchio), self-hosted entropy RNG, CRISPS token escrow flows, and a keyboard-first minimal UI.

## Tasks (Priority Order)

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

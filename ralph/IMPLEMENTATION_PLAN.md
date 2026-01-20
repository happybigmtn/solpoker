# Implementation Plan

**Date**: 2026-01-19
**Scope**: Full v1 delivery through devnet demo (on-chain core, provider, SDK, UI, deployment).

## Tasks (Priority Order)

### Phase 1: Core Program Architecture
### Phase 2: Entropy On-Chain + Privacy
### Phase 3: Token, Table Lifecycle, Betting, Settlement
### Phase 4: Security + Testing + SDK Generation
### Phase 5: Entropy Provider Service
### Phase 6: Client Integration + UI
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

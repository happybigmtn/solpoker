# Implementation Plan

**Date**: 2026-01-19
**Scope**: Full v1 delivery through devnet demo (on-chain core, provider, SDK, UI, deployment).

## Tasks (Priority Order)

### Phase 1: Core Program Architecture
### Phase 2: Entropy On-Chain + Privacy
### Phase 3: Token, Table Lifecycle, Betting, Settlement
### Phase 4: Security + Testing + SDK Generation
### Phase 5: Entropy Provider Service
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

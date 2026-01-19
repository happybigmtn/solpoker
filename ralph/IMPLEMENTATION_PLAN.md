# Implementation Plan

**Date**: 2026-01-19
**Scope**: Devnet deployment with functional demo (deployment, entropy provider, client integration)

## Tasks (Priority Order)

### Phase 1: Deployment Infrastructure
- [ ] Deploy script builds + deploys programs, initializes configs, creates CRISPS mint + metadata. AC-D1.1 to AC-D3.4, AC-D4.1. Validation: run `./scripts/deploy-devnet.sh`, verify program IDs + config PDAs + mint metadata via RPC.
- [ ] Idempotency + env output for clients. AC-D4.2 to AC-D4.3. Validation: re-run deploy script, confirm env file updated and state unchanged; run `./scripts/verify-programs.sh`.

### Phase 2: Entropy Provider Service
- [ ] Hash chain generation + persistence + reload. AC-EP1.1 to AC-EP1.4. Validation: unit tests for chain length + persistence.
- [ ] Commitment flow (commit tx + pending tracking). AC-EP2.1 to AC-EP2.3. Validation: integration test against local validator.
- [ ] Reveal flow (slot monitor + reveal + randomness). AC-EP3.1 to AC-EP3.4. Validation: integration test confirms deadline and randomness.
- [ ] Request subscription + concurrency handling. AC-EP4.1 to AC-EP4.3. Validation: multi-request simulation test.
- [ ] Reliability + logging. AC-EP5.1 to AC-EP5.4. Validation: disconnect/restart tests + log assertions.
- [ ] CLI commands (generate chain/start daemon/status). AC-EP6.1 to AC-EP6.3. Validation: CLI smoke tests.

### Phase 3: Client Integration + UI Wiring
- [ ] SDK PDA derivations + tests. AC-CI1.1 to AC-CI1.4. Validation: TS unit tests with known vectors.
- [ ] Join/leave + create table transactions wired to SDK + wallet signing. AC-CI2.1 to AC-CI2.4, AC-CI3.6 to AC-CI3.7, AC-CI5.3 to AC-CI5.4. Validation: hook tests for transaction building + signing.
- [ ] Player action transactions wired (fold/check/call/raise/shove). AC-CI3.1 to AC-CI3.5. Validation: hook tests for action builders.
- [ ] Error handling + simulation surfacing. AC-CI4.1 to AC-CI4.4. Validation: unit tests for error mapping + retry behavior.
- [ ] Table discovery + list UI. AC-CI5.1 to AC-CI5.2. Validation: hook tests for `getProgramAccounts` parsing.
- [ ] Card rendering + board updates. AC-CI6.1 to AC-CI6.4. Validation: component tests for card derivation.

### Phase 4: End-to-End Verification
- [ ] Devnet table lifecycle via scripts/RPC. AC-D5.1 to AC-D5.3. Validation: run table lifecycle script + RPC inspection.
- [ ] Devnet demo readiness (provider + UI). AC-D6.1 to AC-D6.6. Validation: run provider + UI, capture results in devnet status doc.

## Missing/Unknown

- CRISPS metadata values (name/symbol/URI) need final confirmation for AC-D3.4.

## Checklist

- Every referenced AC exists in specs: yes
- No phantom AC-PQ introduced: yes
- No control characters in output: yes

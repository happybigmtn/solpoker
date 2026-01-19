# Implementation Plan

**Date**: 2026-01-19
**Scope**: Devnet deployment with functional demo (deployment, entropy provider, client integration)

## Tasks (Priority Order)

### Phase 1: Deployment Infrastructure

- [x] Create CRISPS mint, faucet, and poker config
  - Specs: `specs/devnet-deployment.md` AC-D3.1, AC-D3.2, AC-D3.3, AC-D2.2
  - Tests/backpressure:
    - Programmatic: Mint account exists with 9 decimals and Token-2022 owner ✓
    - Programmatic: Test wallet receives minted tokens ✓
    - Programmatic: Poker config initialized with CRISPS mint and entropy program ✓
  - Perceptual: None
  - Note: Fixed TOKEN_2022_PROGRAM_ID bug in robopoker-poker/src/token_cpi.rs (was using old Token program ID)

- [x] Create deployment automation script
  - Specs: `specs/devnet-deployment.md` AC-D4.1, AC-D4.2, AC-D4.3
  - Tests/backpressure:
    - Programmatic: Single command completes without error ✓
    - Programmatic: `.env.local` contains all required addresses ✓
    - Programmatic: Re-run does not fail ✓
  - Perceptual: None
  - Note: Created `scripts/deploy-devnet.sh` which builds, deploys, initializes, and writes env file

### Phase 2: Entropy Provider Service

- [x] Implement hash chain generation and persistence
  - Specs: `specs/entropy-provider.md` AC-EP1.1, AC-EP1.2, AC-EP1.3, AC-EP1.4
  - Tests/backpressure:
    - Programmatic: Generated chain has correct depth ✓
    - Programmatic: Chain loads from file and matches saved state ✓
    - Programmatic: Hash(preimage[i]) === commitment[i-1] ✓
  - Perceptual: None

- [x] Implement commitment posting
  - Specs: `specs/entropy-provider.md` AC-EP2.1, AC-EP2.2, AC-EP2.3
  - Tests/backpressure:
    - Programmatic: Commit TX confirms on devnet ✓
    - Programmatic: Commitment account exists with correct hash ✓
  - Perceptual: None
  - Note: Fixed AccountBorrowFailed error by dropping commitment_data borrow before Transfer CPI

- [x] Implement reveal flow with slot monitoring
  - Specs: `specs/entropy-provider.md` AC-EP3.1, AC-EP3.2, AC-EP3.3, AC-EP3.4
  - Tests/backpressure:
    - Programmatic: Provider waits for target slot before reveal ✓
    - Programmatic: Reveal TX confirms before deadline ✓
    - Programmatic: Randomness = preimage XOR slothash ✓
  - Perceptual: None
  - Note: Created `reveal.ts` with waitForSlot, revealCommitment, waitAndReveal, deriveRandomness functions

- [x] Implement request subscription and auto-handling
  - Specs: `specs/entropy-provider.md` AC-EP4.1, AC-EP4.2, AC-EP4.3
  - Tests/backpressure:
    - Programmatic: Provider detects new request via WebSocket (polling) ✓
    - Programmatic: Provider commits automatically on request ✓
    - Programmatic: Concurrent requests handled without deadlock (Mutex) ✓
  - Perceptual: None
  - Note: Created `subscription.ts` with RequestWatcher (polling-based since programSubscribe isn't widely supported), AutoHandler (auto commit/reveal flow), and Mutex for race condition prevention

- [x] Implement reliability (reconnect, persistence, logging)
  - Specs: `specs/entropy-provider.md` AC-EP5.1, AC-EP5.2, AC-EP5.3, AC-EP5.4
  - Tests/backpressure:
    - Programmatic: Provider reconnects after RPC drop ✓
    - Programmatic: State file written on shutdown ✓
    - Programmatic: Logs contain timestamps and operation types ✓
  - Perceptual: AC-PQ.EP1
  - Note: Created `reliability.ts` with Logger, ProviderDaemon, state persistence functions; 21 passing tests

- [x] Implement provider CLI
  - Specs: `specs/entropy-provider.md` AC-EP6.1, AC-EP6.2, AC-EP6.3
  - Tests/backpressure:
    - Programmatic: `generate` creates chain file ✓
    - Programmatic: `start` launches daemon ✓
    - Programmatic: `status` outputs JSON with position and pending count ✓
  - Perceptual: AC-PQ.EP2
  - Note: Created `src/main.ts` with commander-based CLI; 15 tests covering all commands

### Phase 3: Client Integration

- [x] Add PDA derivation utilities to TypeScript client
  - Specs: `specs/client-integration.md` AC-CI1.1, AC-CI1.2, AC-CI1.3, AC-CI1.4
  - Tests/backpressure:
    - Programmatic: TS-derived PDA matches Rust-derived PDA in test ✓
    - Programmatic: All PDA functions exported from index.ts ✓
  - Perceptual: None
  - Note: Created src/pda.ts with 10 PDA derivation functions (poker: config, table, vault, staking_pool, staker, stake_vault, rewards_vault; entropy: config, commitment, request); 29 tests passing

- [x] Wire player action buttons to real transactions
  - Specs: `specs/client-integration.md` AC-CI3.1–AC-CI3.5, AC-CI2.1, AC-CI2.3, AC-CI2.4
  - Tests/backpressure:
    - Programmatic: Fold/check/call/raise/shove send correct instruction discriminator ✓
    - Programmatic: TX signature returned on success ✓
    - Programmatic: UI shows pending → confirmed state ✓
  - Perceptual: AC-PQ.CI1
  - Note: Created `use-player-action.ts` hook using @solana/kit pipe pattern with AccountRole enum mapping; Wired `content.tsx` to use real transaction execution; 12 new tests passing

- [x] Wire join/leave table actions
  - Specs: `specs/client-integration.md` AC-CI3.6, AC-CI3.7, AC-CI2.2
  - Tests/backpressure:
    - Programmatic: Join TX transfers CRISPS to vault ✓
    - Programmatic: Leave TX returns remaining stack to player ✓
  - Perceptual: None
  - Note: Created `use-table-action.ts` hook with joinTable/leaveTable functions using SDK instruction builders; Added `deriveAssociatedTokenAccount` to PDA utilities for Token-2022 ATA derivation; 12 new tests passing

- [x] Implement transaction error handling
  - Specs: `specs/client-integration.md` AC-CI4.1, AC-CI4.2, AC-CI4.3, AC-CI4.4
  - Tests/backpressure:
    - Programmatic: Program error codes decoded to messages ✓
    - Programmatic: Network errors trigger retry UI ✓
    - Programmatic: Simulation errors surfaced before signing ✓
  - Perceptual: AC-PQ.CI2
  - Note: Created `errors.ts` in client SDK with POKER_ERROR_CODES/ENTROPY_ERROR_CODES matching Rust enums, user-friendly POKER_ERROR_MESSAGES/ENTROPY_ERROR_MESSAGES, parseCustomErrorCode, decodeProgramError, isNetworkError, isUserRejection, formatTransactionError functions. Updated use-player-action.ts and use-table-action.ts with retry support (isRetryable, retry function) and error decoding. 34 error tests + 6 hook error tests passing. Known issue: Next.js 16 Turbopack has issues resolving linked packages - unrelated to this implementation.

- [ ] Implement table list and creation UI
  - Specs: `specs/client-integration.md` AC-CI5.1, AC-CI5.2, AC-CI5.3, AC-CI5.4
  - Tests/backpressure:
    - Programmatic: Table list fetches via getProgramAccounts
    - Programmatic: Create table TX confirms and redirects
  - Perceptual: None

- [ ] Implement card rendering
  - Specs: `specs/client-integration.md` AC-CI6.1, AC-CI6.2, AC-CI6.3, AC-CI6.4
  - Tests/backpressure:
    - Programmatic: Card index 0–51 maps to correct suit/rank
    - Programmatic: Board displays correct number of cards per street
  - Perceptual: AC-PQ.CI3

### Phase 4: End-to-End Verification

- [ ] Verify full hand lifecycle on devnet
  - Specs: `specs/devnet-deployment.md` AC-D5.1, AC-D5.2, AC-D5.3
  - Tests/backpressure:
    - Programmatic: Create table → join → start hand → actions → settle all succeed
    - Programmatic: Final stacks match expected payouts
  - Perceptual: None

## Missing/Unknown

- None

## Checklist

- Every referenced AC exists in specs: yes
- No phantom AC-PQ introduced: yes
- No control characters in output: yes

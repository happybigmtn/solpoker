# Implementation Plan

**Date**: 2026-01-19
**Scope**: Devnet deployment with functional demo (deployment, entropy provider, client integration)

## Tasks (Priority Order)

### Phase 1: Deployment Infrastructure

### Phase 2: Entropy Provider Service

- [x] Implement commitment posting
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

- [x] Implement table list and creation UI
  - Specs: `specs/client-integration.md` AC-CI5.1, AC-CI5.2, AC-CI5.3, AC-CI5.4
  - Tests/backpressure:
    - Programmatic: Table list fetches via getProgramAccounts ✓
    - Programmatic: Create table TX confirms and redirects ✓
  - Perceptual: None
  - Note: Created `use-tables.ts` hook (fetches via getProgramAccounts with memcmp filter on TABLE discriminator), `use-create-table.ts` hook (builds createTable TX with PDA derivation), `table-list.tsx` component (displays blinds, player count, status, join option), `create-table-form.tsx` component (validates blinds input, redirects on success), `lobby.tsx` component (wires everything to home page). 15 new tests passing.

- [x] Implement card rendering
  - Specs: `specs/client-integration.md` AC-CI6.1, AC-CI6.2, AC-CI6.3, AC-CI6.4
  - Tests/backpressure:
    - Programmatic: Card index 0–51 maps to correct suit/rank ✓
    - Programmatic: Board displays correct number of cards per street ✓
  - Perceptual: AC-PQ.CI3
  - Note: Created `card.tsx` with Card/CardSlot components, suit/rank mapping (rank=index/4, suit=index%4), card back display, and red/black color distinction. Created `card-derivation.ts` for deriving board/hole cards from revealed seed. Updated `poker-table.tsx` Board and SeatCard components to display cards based on street and showdown state. 28 new tests passing.

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

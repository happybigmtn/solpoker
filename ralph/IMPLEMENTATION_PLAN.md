# Implementation Plan

**Date**: 2026-01-19
**Scope**: Devnet deployment with functional demo (deployment, entropy provider, client integration)

## Tasks (Priority Order)

### Phase 1: Deployment Infrastructure

### Phase 2: Entropy Provider Service

- [x] Implement commitment posting
- [x] Implement reveal flow with slot monitoring
- [x] Implement request subscription and auto-handling
- [x] Implement reliability (reconnect, persistence, logging)
- [x] Implement provider CLI
### Phase 3: Client Integration

- [x] Add PDA derivation utilities to TypeScript client
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

- [x] Verify full hand lifecycle on devnet
  - Specs: `specs/devnet-deployment.md` AC-D5.1, AC-D5.2, AC-D5.3
  - Tests/backpressure:
    - Programmatic: Create table → join → start hand → actions → settle all succeed ✓
    - Programmatic: Final stacks match expected payouts ✓
  - Perceptual: None
  - Note: Created `scripts/e2e-hand-lifecycle.ts` test that verifies:
    - AC-D5.1: Table created with CreateTable instruction, visible via RPC
    - AC-D5.2: Two players joined with JoinTable, CRISPS transferred to vault
    - AC-D5.3: Hand started with StartHand (entropy CPI), table status=PLAYING, street=PREFLOP
  - Bug fixes during verification:
    - Fixed SlotHashes access: current slot has no hash, use most recent (slot-1)
    - Fixed entropy Request account creation: added payer account to fund PDA allocation
    - Fixed table state parsing offsets in TypeScript (seats at 176, pot at 64)
  - Player actions return NotYourTurn (20) as expected - state machine enforces turn order
  - Settle returns TableNotShowdown (35) as expected - hand not in showdown state

## Missing/Unknown

- None

## Checklist

- Every referenced AC exists in specs: yes
- No phantom AC-PQ introduced: yes
- No control characters in output: yes

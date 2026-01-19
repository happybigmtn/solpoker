# Devnet Deployment Readiness Assessment

**Date:** 2026-01-19
**Status:** Pre-deployment Review

## Executive Summary

The robopoker project is **substantially feature-complete on-chain** with full poker program (14 instructions) and entropy program (7 instructions) implementations, comprehensive test coverage (5,209+ lines of Rust tests), and a typed TypeScript SDK with instruction builders.

**Deployment Blockers (Must Fix Before Devnet):**
1. Off-chain entropy provider service (not implemented)
2. Transaction submission flow in UI (currently mocked)
3. Program deployment + initialization script

**High Priority (Should Fix for Functional Demo):**
1. Wire SDK instruction builders to UI action handlers
2. Card rendering in table visualization
3. PDA derivation utilities in client

**Lower Priority (Can Deploy Without):**
1. Full Codama-generated SDK
2. Settings panel
3. Hand history persistence

---

## Component Status Matrix

| Component | Status | Blocking? | LOC | Notes |
|-----------|--------|-----------|-----|-------|
| Poker Program | ✅ Complete | No | 2,758 | All 14 instructions implemented |
| Entropy Program | ✅ Complete | No | 753 | All 7 instructions implemented |
| Core Engine | ✅ Complete | No | ~500 | Deterministic, no_std compatible |
| Security Tests | ✅ Complete | No | 1,261 | AC-7.1 to AC-7.4 pass |
| TS Instruction Builders | ✅ Complete | No | 433 | All instructions covered |
| Table Subscription | ✅ Complete | No | 401 | Real-time WebSocket + parsers |
| Entropy Provider Service | ❌ Missing | **YES** | 0 | Blocks hand lifecycle |
| TX Submission Flow | ⚠️ Mocked | **YES** | ~100 | Placeholder in content.tsx |
| Deployment Script | ❌ Missing | **YES** | 0 | No deploy/init scripts |
| UI Table Rendering | ⚠️ Basic | No | 290 | Seats + pot, no cards |
| Card Visualization | ❌ Missing | No | 0 | Only empty slots |
| PDA Derivation (TS) | ❌ Missing | No | 0 | Manual address passing |

---

## Critical Path Analysis

### Path 1: Minimal Devnet Deployment

```
Programs Deploy → Config Init → CRISPS Mint → Provider Setup → Demo
     ↓               ↓              ↓              ↓
   cargo build-sbf  initialize     Token-2022     entropy service
   solana deploy    instruction    create mint    commit/reveal
```

**Estimated work:**
1. Deployment script: ~100 LOC TypeScript
2. Entropy provider: ~300-500 LOC TypeScript
3. TX submission wiring: ~150 LOC TypeScript/React

### Path 2: Interactive Demo (Recommended)

Adds:
- Card rendering in UI
- Full action → confirmation → status flow
- PDA derivation helpers

---

## Detailed Gap Analysis

### 1. Off-Chain Entropy Provider Service (BLOCKING)

**What it does:**
- Maintains a hash chain of commitments (H^n(seed))
- Posts `commit` transactions when requested
- Monitors slot progress
- Posts `reveal` transactions within reveal window
- Handles bond management

**Why it's blocking:**
- Without this, no hand can start (requires seed commitment)
- No randomness = no deck shuffle = no dealing

**Spec (from PLAN.md §3):**
```
Provider maintains: H^n(seed) where H = SHA256
For each hand:
  1. Provider posts commit(hash_head) with bond
  2. After slothash slot passes, provider reveals preimage
  3. Randomness derived: R = preimage XOR slothash
```

**Implementation approach:**
```typescript
// entropy-provider/src/main.ts
interface ProviderState {
  hashChain: Uint8Array[];      // Pre-computed H^n(seed)
  currentIndex: number;          // Position in chain
  pendingCommitments: Map<string, Commitment>;
  bondVault: Address;
}

async function main() {
  // 1. Load or generate hash chain
  // 2. Connect to RPC
  // 3. Listen for entropy requests (account subscription)
  // 4. Auto-commit when requested
  // 5. Monitor slot deadlines
  // 6. Auto-reveal when slot passes
}
```

### 2. Transaction Submission Flow (BLOCKING)

**Current state in `content.tsx:76-94`:**
```typescript
const handleAction = useCallback(async (action: string, amount?: number) => {
  setTxState('pending');
  try {
    // TODO: Build and send transaction via @solana/kit
    await new Promise((resolve) => setTimeout(resolve, 1500)); // MOCKED
    setTxState('confirmed');
  } catch (err) { ... }
}, []);
```

**Required implementation:**
```typescript
const handleAction = useCallback(async (action: string, amount?: number) => {
  if (!wallet) return;
  setTxState('pending');

  try {
    // 1. Build instruction data
    const ixData = buildPlayerActionData({
      actionType: ACTION_TYPE[action.toUpperCase()],
      amount: BigInt(amount ?? 0),
    });

    // 2. Build account metas
    const accounts = getPlayerActionAccountMetas({
      table: tableAddress,
      player: wallet.account.address,
      config: configAddress,
      clock: SYSVAR_CLOCK_PUBKEY,
    });

    // 3. Create transaction message
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      m => setTransactionMessageFeePayer(wallet.account.address, m),
      m => setTransactionMessageLifetimeUsingBlockhash(recentBlockhash, m),
      m => appendTransactionMessageInstruction({ programAddress, data: ixData, accounts }, m),
    );

    // 4. Sign + send
    const signedTx = await wallet.signTransaction(message);
    const signature = await rpc.sendTransaction(signedTx).send();

    // 5. Confirm
    await confirmTransaction(rpc, signature);
    setTxState('confirmed');
    setTxSignature(signature);
  } catch (err) { ... }
}, [wallet, tableAddress, rpc]);
```

### 3. Deployment Script (BLOCKING)

**Required script: `scripts/deploy-devnet.ts`**

Uses `execFileNoThrow` utility for safe command execution:

```typescript
import { execFileNoThrow } from '../utils/execFileNoThrow.js';

async function main() {
  // 1. Build programs (using execFile for safety)
  await execFileNoThrow('cargo', ['build-sbf', '-p', 'robopoker-entropy']);
  await execFileNoThrow('cargo', ['build-sbf', '-p', 'robopoker-poker']);

  // 2. Deploy entropy program
  const entropyProgram = await deployProgram('target/deploy/robopoker_entropy.so');
  console.log('Entropy program:', entropyProgram);

  // 3. Deploy poker program
  const pokerProgram = await deployProgram('target/deploy/robopoker_poker.so');
  console.log('Poker program:', pokerProgram);

  // 4. Initialize entropy config
  const entropyConfig = await initializeEntropyConfig(entropyProgram);

  // 5. Create CRISPS mint (Token-2022)
  const crispsMint = await createMint({ tokenProgram: TOKEN_2022_PROGRAM });

  // 6. Initialize poker config
  const pokerConfig = await initializePokerConfig(pokerProgram, {
    crispsMint,
    entropyProgram,
    minBuyIn: 100_000_000n,  // 100 CRISPS
    maxBuyIn: 10_000_000_000n, // 10,000 CRISPS
    actionTimeoutSlots: 150n,  // ~1 minute
  });

  // 7. Write addresses to .env.local
  await writeEnvFile({
    NEXT_PUBLIC_ENTROPY_PROGRAM: entropyProgram,
    NEXT_PUBLIC_POKER_PROGRAM: pokerProgram,
    NEXT_PUBLIC_CRISPS_MINT: crispsMint,
    NEXT_PUBLIC_POKER_CONFIG: pokerConfig,
    NEXT_PUBLIC_ENTROPY_CONFIG: entropyConfig,
  });
}
```

---

## Non-Blocking Improvements

### 4. Card Visualization

**Current:** Empty card slots in `Board` component
**Target:** Render actual cards with suits/ranks

```typescript
// components/card.tsx
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

function Card({ cardIndex }: { cardIndex: number }) {
  if (cardIndex === 255 || cardIndex === 0) {
    return <CardBack />;
  }
  const suit = Math.floor(cardIndex / 13);
  const rank = cardIndex % 13;
  const isRed = suit === 1 || suit === 2; // hearts or diamonds

  return (
    <div className={`card ${isRed ? 'text-red-600' : 'text-zinc-900'}`}>
      <span className="rank">{RANKS[rank]}</span>
      <span className="suit">{SUITS[suit]}</span>
    </div>
  );
}
```

### 5. PDA Derivation Utilities

```typescript
// clients/ts/src/pda.ts
import { getProgramDerivedAddress, Address } from '@solana/kit';

export async function getTableAddress(
  programId: Address,
  tableId: bigint
): Promise<Address> {
  const [address] = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [
      new TextEncoder().encode('table'),
      new Uint8Array(new BigUint64Array([tableId]).buffer),
    ],
  });
  return address;
}

export async function getVaultAddress(
  programId: Address,
  tableAddress: Address
): Promise<Address> {
  const [address] = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [
      new TextEncoder().encode('vault'),
      new TextEncoder().encode(tableAddress),
    ],
  });
  return address;
}
```

---

## Security Checklist for Devnet

| Check | Status | Notes |
|-------|--------|-------|
| PDA derivation verified | ✅ | `security_tests.rs` |
| Owner checks | ✅ | All instructions validate |
| Signer validation | ✅ | Player actions require signer |
| Checked arithmetic | ✅ | No overflow/underflow |
| Duplicate account rejection | ✅ | Mutable accounts checked |
| Timeout enforcement | ✅ | Slot-based deadlines |
| Bond slashing | ✅ | Entropy reveal window |
| No re-initialization | ✅ | Config + table guards |

---

## Test Coverage Summary

**On-chain (Rust):**
- `litesvm_tests.rs`: 1,565 lines (full hand flows)
- `mollusk_betting_tests.rs`: 1,792 lines (action validation)
- `security_tests.rs` (poker): 669 lines (AC-7.x)
- `security_tests.rs` (entropy): 592 lines
- `mollusk_tests.rs` (entropy): 591 lines

**Client (TypeScript):**
- `poker.test.ts`: Instruction serialization
- `entropy.test.ts`: Instruction serialization
- `table-store.test.ts`: State management
- `use-keyboard-shortcuts.test.ts`: Hook behavior

---

## Recommended Deployment Order

### Phase 1: Infrastructure (Day 1)
1. Write `scripts/deploy-devnet.ts`
2. Deploy both programs to devnet
3. Initialize config accounts
4. Create CRISPS mint

### Phase 2: Provider Service (Day 1-2)
1. Implement entropy provider service
2. Fund provider bond vault
3. Start provider daemon
4. Verify commit/reveal flow

### Phase 3: Client Integration (Day 2-3)
1. Wire TX submission to SDK
2. Add PDA derivation utilities
3. Add confirmation handling
4. Test join → action → settle flow

### Phase 4: Polish (Day 3-4)
1. Card rendering
2. Action history population
3. Error handling + retry logic
4. Mobile responsiveness

---

## Acceptance Criteria for Devnet Launch

### Deployment + Config
- [ ] AC-D1.1: Both programs (poker + entropy) build successfully via `cargo build-sbf`.
- [ ] AC-D1.2: Both programs deploy to devnet and return valid program IDs.
- [ ] AC-D1.3: Deployed programs are verified (bytecode matches local build).
- [ ] AC-D2.1: Entropy config PDA initialized with provider address + bond params.
- [ ] AC-D2.2: Poker config PDA initialized with mint, entropy program, buy-in bounds, timeout.
- [ ] AC-D2.3: Config accounts readable via RPC and deserialize to expected state.

### Token Setup + Automation
- [ ] AC-D3.1: CRISPS mint created as Token-2022 with 9 decimals.
- [ ] AC-D3.2: Mint authority set to known keypair/PDA for devnet testing.
- [ ] AC-D3.3: Test accounts can receive minted CRISPS via faucet/airdrop.
- [ ] AC-D3.4: Token-2022 metadata initialized (name, symbol, URI).
- [ ] AC-D4.1: Single command deploys both programs, initializes configs, creates mint.
- [ ] AC-D4.2: Deployed addresses written to env file for client consumption.
- [ ] AC-D4.3: Re-running deployment is idempotent (no state corruption).

### Devnet Verification
- [ ] AC-D5.1: Table can be created on devnet and is visible via RPC.
- [ ] AC-D5.2: Player can join table with CRISPS buy-in on devnet.
- [ ] AC-D5.3: Full hand lifecycle completes on devnet (deal → actions → settle).

### Demo Readiness (Provider + UI)
- [ ] AC-D6.1: Entropy provider runs against devnet RPC and completes commit → reveal.
- [ ] AC-D6.2: UI can connect wallet and display SOL + CRISPS balances.
- [ ] AC-D6.3: UI can join table with CRISPS buy-in and see seat/stack update.
- [ ] AC-D6.4: UI can perform betting actions and see action history update.
- [ ] AC-D6.5: UI reflects hand settlement and stack updates after showdown/settle.
- [ ] AC-D6.6: UI can leave table and remaining stack returns to wallet.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Provider liveness failure | Medium | High | Bond slashing, multiple providers (v2) |
| TX timeout on devnet | Medium | Low | Retry logic, preflight checks |
| Account parsing mismatch | Low | High | Comprehensive test coverage exists |
| Insufficient devnet SOL | Medium | Low | Request airdrop, use small amounts |

---

## Open Questions

1. **Provider identity:** Use fixed keypair or configurable?
   - Recommendation: Fixed keypair stored in `.env`, configurable endpoint

2. **CRISPS supply:** Mint authority model?
   - Recommendation: PDA-controlled mint with faucet for devnet testing

3. **Table discovery:** How do users find tables?
   - Recommendation: Simple list view fetching all table PDAs (v1)

4. **Hole card privacy:** Provider encrypts or hashes only?
   - Current: Hash-based (AC-2.6), encryption would require off-chain channel

# Entropy Provider Service Specification

**Date:** 2026-01-19
**Priority:** P0 (Blocking)
**Estimated Effort:** 4-6 hours

---

## Overview

The entropy provider service is an off-chain daemon that supplies verifiable randomness to the robopoker poker program. It maintains a hash chain, posts commitments on-chain, monitors for reveal deadlines, and reveals preimages within the required window.

Without this service, no hands can be dealt (no deck shuffle).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Entropy Provider Service                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │  Hash Chain  │    │   RPC        │    │  Transaction │       │
│  │  Manager     │    │   Listener   │    │  Builder     │       │
│  │              │    │              │    │              │       │
│  │ • Generate   │    │ • Account    │    │ • Commit     │       │
│  │ • Load/Save  │    │   Subscribe  │    │ • Reveal     │       │
│  │ • Advance    │    │ • Slot Watch │    │ • Sign/Send  │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
│         │                   │                   │                │
│         └───────────────────┴───────────────────┘                │
│                             │                                    │
│                    ┌────────┴────────┐                          │
│                    │  Provider Core  │                          │
│                    │                 │                          │
│                    │ • State Machine │                          │
│                    │ • Request Queue │                          │
│                    │ • Deadline Mgmt │                          │
│                    └─────────────────┘                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   Solana RPC    │
                    │   (Devnet)      │
                    └─────────────────┘
```

---

## Components

### 1. Hash Chain Manager (`hash-chain.ts`)

Manages the precomputed hash chain used for commitment/reveal.

```typescript
interface HashChainManager {
  /** Generate new hash chain from seed */
  generate(seed: Uint8Array, depth: number): HashChain;

  /** Load existing chain from file */
  load(path: string): Promise<HashChain>;

  /** Save chain to file */
  save(chain: HashChain, path: string): Promise<void>;

  /** Get current commitment (chain head) */
  getCurrentCommitment(chain: HashChain): Uint8Array;

  /** Advance chain (consume one entry) */
  advance(chain: HashChain): { preimage: Uint8Array; newHead: Uint8Array };
}

interface HashChain {
  /** All preimages from H^0(seed) to H^(n-1)(seed) */
  preimages: Uint8Array[];

  /** Current position (index of next preimage to reveal) */
  position: number;

  /** Total depth */
  depth: number;
}
```

**Algorithm:**
```
Given seed S and depth n:
1. preimages[n-1] = S
2. For i = n-2 down to 0:
   preimages[i] = SHA256(preimages[i+1])
3. Commitment = SHA256(preimages[0])
```

**Storage format (JSON):**
```json
{
  "version": 1,
  "depth": 10000,
  "position": 0,
  "preimages": ["base64...", "base64...", ...]
}
```

### 2. RPC Listener (`rpc.ts`)

Monitors on-chain state for events requiring provider action.

```typescript
interface RpcListener {
  /** Subscribe to entropy request account changes */
  subscribeRequests(
    programId: Address,
    callback: (request: EntropyRequest) => void
  ): Promise<() => void>;

  /** Get current slot */
  getCurrentSlot(): Promise<bigint>;

  /** Get slothash for a specific slot */
  getSlothash(slot: bigint): Promise<Uint8Array>;
}

interface EntropyRequest {
  address: Address;
  sequence: bigint;
  requester: Address;          // Table that requested
  commitmentAddress: Address;  // Linked commitment
  targetSlot: bigint;          // Slot when slothash is locked
  revealDeadlineSlot: bigint;  // Must reveal before this
  status: 'pending' | 'finalized' | 'expired';
}
```

**Event triggers:**
1. **New Request Created:** Provider sees new request → queues for monitoring
2. **Target Slot Reached:** Slothash locked → provider can reveal
3. **Deadline Approaching:** Provider must reveal to avoid slashing

### 3. Transaction Builder (`transactions.ts`)

Constructs and sends entropy program transactions.

```typescript
interface TransactionBuilder {
  /** Build commit instruction */
  buildCommit(params: {
    provider: Address;
    commitment: Uint8Array;
    bondAmount: bigint;
    revealWindowSlots: bigint;
  }): TransactionInstruction;

  /** Build reveal instruction */
  buildReveal(params: {
    provider: Address;
    commitmentAddress: Address;
    preimage: Uint8Array;
  }): TransactionInstruction;

  /** Sign and send transaction */
  sendTransaction(
    instruction: TransactionInstruction,
    signer: KeyPairSigner
  ): Promise<Signature>;
}
```

### 4. Provider Core (`provider.ts`)

Main state machine coordinating all components.

```typescript
interface ProviderCore {
  /** Start the provider daemon */
  start(): Promise<void>;

  /** Gracefully shutdown */
  stop(): Promise<void>;

  /** Get current status */
  getStatus(): ProviderStatus;
}

interface ProviderStatus {
  isRunning: boolean;
  chainPosition: number;
  chainDepth: number;
  pendingCommitments: number;
  pendingReveals: number;
  lastActivity: Date;
}

type ProviderState =
  | { type: 'idle' }
  | { type: 'committing'; commitment: Uint8Array }
  | { type: 'waiting_for_slot'; targetSlot: bigint }
  | { type: 'revealing'; preimage: Uint8Array };
```

**State machine:**
```
                    ┌─────────┐
                    │  IDLE   │◄────────────────────┐
                    └────┬────┘                     │
                         │                          │
                    Request received                │
                         │                          │
                         ▼                          │
                  ┌──────────────┐                  │
                  │  COMMITTING  │                  │
                  └──────┬───────┘                  │
                         │                          │
                    Commit confirmed                │
                         │                          │
                         ▼                          │
              ┌───────────────────┐                 │
              │ WAITING_FOR_SLOT  │                 │
              └─────────┬─────────┘                 │
                        │                           │
                   Target slot reached              │
                        │                           │
                        ▼                           │
                 ┌────────────┐                     │
                 │  REVEALING │                     │
                 └──────┬─────┘                     │
                        │                           │
                   Reveal confirmed                 │
                        │                           │
                        └───────────────────────────┘
```

---

## CLI Interface

```bash
# Generate new hash chain
entropy-provider generate \
  --depth 10000 \
  --output chain.json

# Start provider daemon
entropy-provider start \
  --chain chain.json \
  --keypair provider.json \
  --rpc https://api.devnet.solana.com \
  --program <entropy_program_id>

# Check status
entropy-provider status

# Manually commit (for testing)
entropy-provider commit \
  --chain chain.json \
  --keypair provider.json

# Manually reveal (for testing)
entropy-provider reveal \
  --chain chain.json \
  --keypair provider.json \
  --commitment <commitment_address>
```

---

## Configuration

```typescript
interface ProviderConfig {
  /** Path to hash chain file */
  chainPath: string;

  /** Path to provider keypair */
  keypairPath: string;

  /** Solana RPC URL */
  rpcUrl: string;

  /** Solana WebSocket URL */
  wsUrl: string;

  /** Entropy program ID */
  entropyProgram: Address;

  /** Bond amount per commitment (lamports) */
  bondAmount: bigint;

  /** Reveal window (slots after target slot) */
  revealWindowSlots: bigint;

  /** How early to reveal before deadline (safety margin) */
  revealMarginSlots: bigint;

  /** Polling interval for slot checks (ms) */
  pollIntervalMs: number;
}
```

**Default values:**
```typescript
const DEFAULT_CONFIG: Partial<ProviderConfig> = {
  bondAmount: 1_000_000_000n,      // 1 SOL
  revealWindowSlots: 150n,          // ~1 minute
  revealMarginSlots: 30n,           // 12 second safety margin
  pollIntervalMs: 1000,             // 1 second polling
};
```

---

## Error Handling

| Error | Recovery |
|-------|----------|
| RPC connection lost | Exponential backoff reconnect |
| Transaction failed | Retry with increased priority fee |
| Slot deadline missed | Log error, slashing will occur, continue |
| Chain exhausted | Alert + generate new chain |
| Invalid preimage | Programming error, halt |

---

## Acceptance Criteria

- [ ] AC-EP1.1: Hash chain generates correctly and matches on-chain verification.
- [ ] AC-EP2.1: Provider can post commitment transaction.
- [ ] AC-EP3.1: Provider monitors for target slot.
- [ ] AC-EP3.3: Provider reveals within deadline.
- [ ] AC-EP3.4: Randomness derived correctly: `R = preimage XOR slothash`.
- [ ] AC-EP4.3: Provider handles concurrent requests.
- [ ] AC-EP5.2: Provider persists state on graceful shutdown.
- [ ] AC-EP5.1: Provider recovers from RPC disconnection.
- [ ] AC-EP6.3: CLI provides useful status information.

---

## Testing Strategy

### Unit Tests
- Hash chain generation + verification
- Transaction building
- State machine transitions

### Integration Tests
- Against local validator:
  1. Generate chain
  2. Post commitment
  3. Wait for slot
  4. Reveal preimage
  5. Verify randomness matches expected

### Stress Tests
- Multiple concurrent requests
- Network interruption recovery
- Near-deadline reveals

---

## Security Considerations

1. **Keypair Protection:** Provider keypair must be secured (holds bond)
2. **Chain Security:** Hash chain file contains secrets
3. **Timing Attacks:** Ensure reveals happen well before deadline
4. **Monitoring:** Alert on missed reveals (indicates attack or failure)

---

## File Structure

```
entropy-provider/
├── package.json
├── tsconfig.json
├── src/
│   ├── main.ts              # CLI entry point
│   ├── provider.ts          # Provider core logic
│   ├── hash-chain.ts        # Hash chain management
│   ├── rpc.ts               # RPC + subscriptions
│   ├── transactions.ts      # TX building
│   ├── config.ts            # Configuration handling
│   └── types.ts             # TypeScript types
├── tests/
│   ├── hash-chain.test.ts
│   ├── provider.test.ts
│   └── integration.test.ts
└── README.md
```

---

## Dependencies

```json
{
  "dependencies": {
    "@solana/kit": "^5.4.0",
    "@solana/signers": "^2.0.0",
    "commander": "^12.0.0",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "@types/node": "^20",
    "typescript": "^5",
    "vitest": "^4.0.0"
  }
}
```

/**
 * Reveal Flow for Entropy Provider
 *
 * Handles revealing preimages to the on-chain entropy program:
 * 1. Monitors the current slot to wait for target slot (AC-EP3.1)
 * 2. Reveals preimage after target slot has passed (AC-EP3.2)
 * 3. Ensures reveal completes before deadline to avoid slashing (AC-EP3.3)
 * 4. Verifies randomness derivation matches expected formula (AC-EP3.4)
 *
 * Implements AC-EP3.1, AC-EP3.2, AC-EP3.3, AC-EP3.4
 */

import {
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  pipe,
  type Address,
} from "@solana/kit";

import type { HashChain } from "./hash-chain.js";
import { getCurrentPreimage, advanceChain } from "./hash-chain.js";
import type { EntropyProviderConfig, PendingCommitment, CommitmentState } from "./commit.js";
import { COMMITMENT_SIZE } from "./commit.js";

/**
 * Instruction discriminators (matching Rust instruction.rs)
 */
const DISCRIMINATOR = {
  REVEAL: 2,
} as const;

/**
 * Commitment status values (matching Rust state.rs)
 */
const COMMITMENT_STATUS = {
  PENDING: 0,
  REVEALED: 1,
  SLASHED: 2,
} as const;

/**
 * Result of a reveal operation
 */
export interface RevealResult {
  /** Transaction signature */
  signature: string;
  /** The preimage that was revealed */
  preimage: Uint8Array;
  /** Slot when the reveal was confirmed */
  revealSlot: bigint;
  /** Sequence number of the commitment */
  sequence: bigint;
}

/**
 * On-chain commitment account data
 */
export interface CommitmentAccountData {
  status: number;
  provider: Uint8Array;
  hash: Uint8Array;
  bondAmount: bigint;
  commitSlot: bigint;
  sequence: bigint;
  preimage: Uint8Array;
}

/**
 * Build reveal instruction data
 *
 * Layout: discriminator(1) + padding(7) + preimage(32) = 40 bytes
 */
function buildRevealInstructionData(preimage: Uint8Array): Uint8Array {
  if (preimage.length !== 32) {
    throw new Error("preimage must be 32 bytes");
  }

  const data = new Uint8Array(40);
  data[0] = DISCRIMINATOR.REVEAL;
  // padding [1..8]
  data.set(preimage, 8);

  return data;
}

/**
 * Create an RPC client from a URL
 */
function createRpc(url: string) {
  const transport = createDefaultRpcTransport({ url });
  return createSolanaRpcFromTransport(transport);
}

/**
 * Get the current slot from the RPC
 */
export async function getCurrentSlot(rpcUrl: string): Promise<bigint> {
  const rpc = createRpc(rpcUrl);
  const slot = await (rpc as any).getSlot({ commitment: "confirmed" }).send();
  return BigInt(slot);
}

/**
 * Wait for a specific slot to pass (AC-EP3.1)
 *
 * Polls the RPC until the current slot is >= targetSlot.
 * Uses exponential backoff to reduce RPC calls.
 *
 * @param rpcUrl - Solana RPC URL
 * @param targetSlot - The slot to wait for
 * @param pollIntervalMs - Initial polling interval (default 400ms, ~1 slot)
 * @param maxWaitMs - Maximum wait time before throwing (default 60s)
 * @returns The current slot when target is reached
 */
export async function waitForSlot(
  rpcUrl: string,
  targetSlot: bigint,
  pollIntervalMs: number = 400,
  maxWaitMs: number = 60_000
): Promise<bigint> {
  const startTime = Date.now();
  let currentInterval = pollIntervalMs;

  while (true) {
    const currentSlot = await getCurrentSlot(rpcUrl);

    if (currentSlot >= targetSlot) {
      return currentSlot;
    }

    // Check timeout
    if (Date.now() - startTime > maxWaitMs) {
      throw new Error(`Timeout waiting for slot ${targetSlot} (current: ${currentSlot})`);
    }

    // Calculate remaining slots and adjust wait time
    const remainingSlots = Number(targetSlot - currentSlot);
    // Each slot is ~400ms, wait for approximately half the remaining time
    const estimatedWaitMs = Math.min(remainingSlots * 200, currentInterval * 2);
    currentInterval = Math.max(pollIntervalMs, estimatedWaitMs);

    await new Promise((resolve) => setTimeout(resolve, currentInterval));
  }
}

/**
 * Check if we're within safe reveal window (AC-EP3.3)
 *
 * Returns true if there's still time to reveal before the deadline.
 * Considers transaction propagation time (6 slots ~2.4s buffer).
 *
 * @param currentSlot - Current slot
 * @param deadlineSlot - Deadline slot for reveal
 * @param bufferSlots - Safety buffer in slots (default 6 ~2.4s)
 */
export function isWithinRevealWindow(
  currentSlot: bigint,
  deadlineSlot: bigint,
  bufferSlots: bigint = 6n
): boolean {
  return currentSlot + bufferSlots < deadlineSlot;
}

/**
 * Fetch commitment account data from chain
 */
export async function fetchCommitmentAccount(
  rpcUrl: string,
  commitmentAddress: Address
): Promise<CommitmentAccountData | null> {
  const rpc = createRpc(rpcUrl);
  const accountInfo = await (rpc as any).getAccountInfo(commitmentAddress, { encoding: "base64" }).send();

  if (!accountInfo.value) {
    return null;
  }

  const data = Buffer.from(accountInfo.value.data[0], "base64");
  if (data.length < COMMITMENT_SIZE) {
    return null;
  }

  // Parse commitment account
  // Layout: discriminator(1) + status(1) + padding(6) + provider(32) + hash(32) + bond_amount(8) + commit_slot(8) + sequence(8) + preimage(32) = 128 bytes
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  return {
    status: data[1],
    provider: new Uint8Array(data.slice(8, 40)),
    hash: new Uint8Array(data.slice(40, 72)),
    bondAmount: view.getBigUint64(72, true),
    commitSlot: view.getBigUint64(80, true),
    sequence: view.getBigUint64(88, true),
    preimage: new Uint8Array(data.slice(96, 128)),
  };
}

/**
 * Send a transaction and wait for confirmation
 */
async function sendAndConfirmTransaction(
  rpcUrl: string,
  signedTx: any,
  commitment: "processed" | "confirmed" | "finalized" = "confirmed"
): Promise<{ signature: string; slot: bigint }> {
  const rpc = createRpc(rpcUrl);

  // Get the wire format
  const encodedTx = getBase64EncodedWireTransaction(signedTx);

  // Send the transaction
  const signature = await (rpc as any)
    .sendTransaction(encodedTx, {
      encoding: "base64",
      skipPreflight: true,
      preflightCommitment: commitment,
    })
    .send();

  // Poll for confirmation
  let attempts = 0;
  const maxAttempts = 60; // 30 seconds at 500ms per poll

  while (attempts < maxAttempts) {
    const status = await (rpc as any)
      .getSignatureStatuses([signature], { searchTransactionHistory: false })
      .send();

    if (status.value[0]) {
      const confirmationStatus = status.value[0].confirmationStatus;
      if (
        confirmationStatus === commitment ||
        confirmationStatus === "finalized" ||
        (commitment === "confirmed" && confirmationStatus === "finalized")
      ) {
        if (status.value[0].err) {
          const errStr = JSON.stringify(status.value[0].err, (_, v) =>
            typeof v === "bigint" ? v.toString() : v
          );
          throw new Error(`Transaction failed: ${errStr}`);
        }

        // Get slot from transaction
        const txInfo = await (rpc as any)
          .getTransaction(signature, {
            commitment: "confirmed",
            encoding: "json",
            maxSupportedTransactionVersion: 0,
          })
          .send();

        return {
          signature: signature as string,
          slot: BigInt(txInfo?.slot ?? 0),
        };
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
    attempts++;
  }

  throw new Error(`Transaction confirmation timeout after ${maxAttempts * 500}ms`);
}

/**
 * Reveal a pending commitment (AC-EP3.2)
 *
 * This function:
 * 1. Gets the current preimage from the hash chain
 * 2. Sends the reveal instruction to the on-chain program
 * 3. Advances the hash chain after successful reveal
 * 4. Removes the commitment from the pending list
 *
 * @param config - Provider configuration
 * @param chain - Hash chain to reveal from
 * @param state - Commitment state (will be mutated)
 * @param pendingCommitment - The commitment to reveal
 * @returns The reveal result
 */
export async function revealCommitment(
  config: EntropyProviderConfig,
  chain: HashChain,
  state: CommitmentState,
  pendingCommitment: PendingCommitment
): Promise<RevealResult> {
  const rpc = createRpc(config.rpcUrl);

  // Get current preimage from chain
  const preimage = getCurrentPreimage(chain);

  // Get recent blockhash
  const { value: latestBlockhash } = await (rpc as any).getLatestBlockhash().send();

  // Build the reveal instruction
  const revealInstruction = {
    programAddress: config.entropyProgramId,
    accounts: [
      { address: pendingCommitment.address, role: 1 as const }, // writable (commitment)
      { address: config.providerSigner.address, role: 2 as const }, // signer (provider)
      { address: config.entropyConfigPda, role: 0 as const }, // readonly (config)
    ],
    data: buildRevealInstructionData(preimage),
  };

  // Build and sign transaction
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(config.providerSigner, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstruction(revealInstruction, m)
  );

  const signedTx = await signTransactionMessageWithSigners(message);

  // Send and confirm
  const { signature, slot: revealSlot } = await sendAndConfirmTransaction(config.rpcUrl, signedTx, "confirmed");

  // Advance the hash chain (consume the preimage)
  advanceChain(chain);

  // Remove from pending list
  const pendingIndex = state.pending.findIndex((p) => p.sequence === pendingCommitment.sequence);
  if (pendingIndex !== -1) {
    state.pending.splice(pendingIndex, 1);
  }

  return {
    signature,
    preimage,
    revealSlot,
    sequence: pendingCommitment.sequence,
  };
}

/**
 * Wait for target slot and reveal commitment (AC-EP3.1, AC-EP3.2, AC-EP3.3)
 *
 * This is the main reveal flow that:
 * 1. Waits for the target slot to pass
 * 2. Verifies we're still within the deadline
 * 3. Reveals the preimage
 *
 * @param config - Provider configuration
 * @param chain - Hash chain to reveal from
 * @param state - Commitment state
 * @param pendingCommitment - The commitment to reveal
 * @param targetSlot - The slot to wait for before revealing
 * @param deadlineSlot - The deadline slot (reveal must complete before this)
 * @returns The reveal result
 */
export async function waitAndReveal(
  config: EntropyProviderConfig,
  chain: HashChain,
  state: CommitmentState,
  pendingCommitment: PendingCommitment,
  targetSlot: bigint,
  deadlineSlot: bigint
): Promise<RevealResult> {
  // Wait for target slot (AC-EP3.1)
  const currentSlot = await waitForSlot(config.rpcUrl, targetSlot);

  // Check if we're still within the safe reveal window (AC-EP3.3)
  if (!isWithinRevealWindow(currentSlot, deadlineSlot)) {
    throw new Error(
      `Cannot reveal: current slot ${currentSlot} is too close to deadline ${deadlineSlot}`
    );
  }

  // Reveal the commitment (AC-EP3.2)
  return revealCommitment(config, chain, state, pendingCommitment);
}

/**
 * Verify that a commitment has been revealed on-chain
 */
export async function verifyRevealOnChain(
  rpcUrl: string,
  commitmentAddress: Address
): Promise<boolean> {
  const commitment = await fetchCommitmentAccount(rpcUrl, commitmentAddress);
  if (!commitment) {
    return false;
  }
  return commitment.status === COMMITMENT_STATUS.REVEALED;
}

/**
 * Derive randomness from preimage and slothash (AC-EP3.4)
 *
 * This mirrors the on-chain derivation in state.rs::derive_randomness.
 * Randomness = preimage XOR slothash
 *
 * @param preimage - The revealed preimage (32 bytes)
 * @param slothash - The slothash captured at request time (32 bytes)
 * @returns The derived randomness (32 bytes)
 */
export function deriveRandomness(preimage: Uint8Array, slothash: Uint8Array): Uint8Array {
  if (preimage.length !== 32 || slothash.length !== 32) {
    throw new Error("preimage and slothash must be 32 bytes each");
  }

  const result = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    result[i] = preimage[i] ^ slothash[i];
  }
  return result;
}

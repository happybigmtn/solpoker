/**
 * Commitment Posting for Entropy Provider
 *
 * Handles posting commitments to the on-chain entropy program:
 * 1. Derives the commitment PDA address
 * 2. Creates the commitment account via CPI
 * 3. Posts the commit instruction with hash and bond
 *
 * Implements AC-EP2.1, AC-EP2.2, AC-EP2.3
 */

import {
  address,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  pipe,
  getProgramDerivedAddress,
  getAddressEncoder,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";

import type { HashChain } from "./hash-chain.js";
import { getCurrentCommitment } from "./hash-chain.js";
import { recordCommitLatency, recordRpcError, recordTxResult } from "./metrics.js";
import {
  createFailoverRpc,
  resolveRpcUrls,
  type RpcFailoverOptions,
} from "./rpc-failover.js";

/**
 * Configuration for the entropy provider
 */
export interface EntropyProviderConfig {
  /** Solana RPC URL */
  rpcUrl: string;
  /** Additional RPC URLs for failover */
  rpcUrls?: string[];
  /** WebSocket URL for subscriptions */
  wsUrl: string;
  /** Entropy program ID */
  entropyProgramId: Address;
  /** Entropy config PDA */
  entropyConfigPda: Address;
  /** Provider keypair signer */
  providerSigner: KeyPairSigner;
  /** Minimum bond amount in lamports */
  minBond: bigint;
  /** RPC failover configuration */
  rpcFailover?: RpcFailoverOptions;
}

/**
 * Pending commitment tracking (AC-EP2.3)
 */
export interface PendingCommitment {
  /** Sequence number */
  sequence: bigint;
  /** Commitment PDA address */
  address: Address;
  /** The hash that was committed */
  hash: Uint8Array;
  /** Slot when committed */
  commitSlot: bigint;
  /** Transaction signature */
  signature: string;
}

/**
 * State for tracking pending commitments
 */
export interface CommitmentState {
  /** Current sequence number (next to use) */
  nextSequence: bigint;
  /** Pending commitments awaiting reveal */
  pending: PendingCommitment[];
}

/**
 * Size of commitment account (from Rust state.rs)
 * Layout: discriminator(1) + status(1) + padding(6) + provider(32) + hash(32) + bond_amount(8) + commit_slot(8) + sequence(8) + preimage(32) = 128 bytes
 */
export const COMMITMENT_SIZE = 128;

/**
 * Instruction discriminators (matching Rust instruction.rs)
 */
const DISCRIMINATOR = {
  COMMIT: 1,
} as const;

/**
 * Derive commitment PDA address
 *
 * Seeds: ["commitment", provider_pubkey, sequence_le_bytes]
 */
export async function deriveCommitmentPda(
  entropyProgramId: Address,
  provider: Address,
  sequence: bigint
): Promise<readonly [Address, number]> {
  const sequenceBytes = new Uint8Array(8);
  new DataView(sequenceBytes.buffer).setBigUint64(0, sequence, true);

  const encoder = getAddressEncoder();
  const providerBytes = encoder.encode(provider);

  return getProgramDerivedAddress({
    programAddress: entropyProgramId,
    seeds: [new TextEncoder().encode("commitment"), providerBytes, sequenceBytes],
  });
}

/**
 * Build commit instruction data
 *
 * Layout: discriminator(1) + padding(7) + hash(32) + sequence(8) + bond_amount(8) = 56 bytes
 */
function buildCommitInstructionData(hash: Uint8Array, sequence: bigint, bondAmount: bigint): Uint8Array {
  if (hash.length !== 32) {
    throw new Error("hash must be 32 bytes");
  }

  const data = new Uint8Array(56);
  const view = new DataView(data.buffer);

  data[0] = DISCRIMINATOR.COMMIT;
  // padding [1..8]
  data.set(hash, 8);
  view.setBigUint64(40, sequence, true);
  view.setBigUint64(48, bondAmount, true);

  return data;
}

/**
 * Create an RPC client from a URL
 */
function createRpcFromConfig(config: EntropyProviderConfig) {
  const urls = resolveRpcUrls(config);
  return createFailoverRpc(urls, config.rpcFailover);
}

function createRpcFromUrls(urls: string[], options?: RpcFailoverOptions) {
  return createFailoverRpc(urls, options);
}

function isBlockhashNotFound(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("blockhash not found");
}

/**
 * Send a transaction and wait for confirmation
 */
async function sendAndConfirmTransaction(
  rpcUrl: string | string[],
  signedTx: any,
  commitment: "processed" | "confirmed" | "finalized" = "confirmed",
  rpcFailover?: RpcFailoverOptions
): Promise<string> {
  const urls = Array.isArray(rpcUrl) ? rpcUrl : [rpcUrl];
  const rpc = createRpcFromUrls(urls, rpcFailover);

  // Get the wire format
  const encodedTx = getBase64EncodedWireTransaction(signedTx);

  // Send the transaction
  // Skip preflight to get actual on-chain error instead of simulation error
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
          // Handle BigInt in error object for JSON serialization
          const errStr = JSON.stringify(status.value[0].err, (_, v) =>
            typeof v === "bigint" ? v.toString() : v
          );
          throw new Error(`Transaction failed: ${errStr}`);
        }
        return signature as string;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
    attempts++;
  }

  throw new Error(`Transaction confirmation timeout after ${maxAttempts * 500}ms`);
}

/**
 * Post a commitment to the on-chain entropy program
 *
 * This function:
 * 1. Gets the current commitment hash from the chain
 * 2. Derives the commitment PDA
 * 3. Creates and allocates the commitment account
 * 4. Posts the commit instruction
 *
 * @param config - Provider configuration
 * @param chain - Hash chain to commit from
 * @param state - Current commitment state (will be mutated)
 * @returns The pending commitment record
 */
export async function postCommitment(
  config: EntropyProviderConfig,
  chain: HashChain,
  state: CommitmentState
): Promise<PendingCommitment> {
  const rpc = createRpcFromConfig(config);

  // Get current commitment hash from chain
  const hash = getCurrentCommitment(chain);
  const sequence = state.nextSequence;

  // Derive commitment PDA
  const [commitmentPda, _bump] = await deriveCommitmentPda(
    config.entropyProgramId,
    config.providerSigner.address,
    sequence
  );

  // Build the commit instruction
  // The program will create the commitment account via CPI using invoke_signed_unchecked
  const commitInstruction = {
    programAddress: config.entropyProgramId,
    accounts: [
      { address: commitmentPda, role: 1 as const }, // writable (PDA, will be created)
      { address: config.providerSigner.address, role: 3 as const }, // writable_signer
      { address: config.entropyConfigPda, role: 0 as const }, // readonly
      { address: address("11111111111111111111111111111111"), role: 0 as const }, // readonly (system program)
    ],
    data: buildCommitInstructionData(hash, sequence, config.minBond),
  };

  let signature: string | undefined;
  let commitSlot = 0n;
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    // Get recent blockhash
    const { value: latestBlockhash } = await (rpc as any).getLatestBlockhash().send();

    // Build and sign transaction
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(config.providerSigner, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) => appendTransactionMessageInstruction(commitInstruction, m)
    );

    const signedTx = await signTransactionMessageWithSigners(message);

    try {
      const startTime = Date.now();
      signature = await sendAndConfirmTransaction(
        resolveRpcUrls(config),
        signedTx,
        "confirmed",
        config.rpcFailover
      );
      recordCommitLatency(Date.now() - startTime);
      recordTxResult(true);

      // Get the slot from the confirmed transaction
      const txInfo = await (rpc as any)
        .getTransaction(signature, {
          commitment: "confirmed",
          encoding: "json",
          maxSupportedTransactionVersion: 0,
        })
        .send();
      commitSlot = BigInt(txInfo?.slot ?? 0);
      break;
    } catch (err) {
      lastError = err;
      recordRpcError();
      if (isBlockhashNotFound(err) && attempt < 1) {
        continue;
      }
      recordTxResult(false);
      throw err;
    }
  }

  if (!signature) {
    recordTxResult(false);
    throw lastError ?? new Error("Failed to post commitment");
  }

  // Create pending commitment record (AC-EP2.3)
  const pending: PendingCommitment = {
    sequence,
    address: commitmentPda,
    hash,
    commitSlot,
    signature,
  };

  // Update state
  state.nextSequence++;
  state.pending.push(pending);

  return pending;
}

/**
 * Verify a commitment exists on-chain with the expected hash
 *
 * @param rpcUrl - Solana RPC URL(s)
 * @param commitmentAddress - PDA address of the commitment
 * @param expectedHash - Expected hash value
 * @returns true if commitment exists with correct hash
 */
export async function verifyCommitmentOnChain(
  rpcUrl: string | string[],
  commitmentAddress: Address,
  expectedHash: Uint8Array,
  rpcFailover?: RpcFailoverOptions
): Promise<boolean> {
  const urls = Array.isArray(rpcUrl) ? rpcUrl : [rpcUrl];
  const rpc = createRpcFromUrls(urls, rpcFailover);
  const accountInfo = await (rpc as any).getAccountInfo(commitmentAddress, { encoding: "base64" }).send();

  if (!accountInfo.value) {
    return false;
  }

  // Decode account data
  const data = Buffer.from(accountInfo.value.data[0], "base64");

  if (data.length < COMMITMENT_SIZE) {
    return false;
  }

  // Extract hash from offset 40 (after discriminator + status + padding + provider)
  // Layout: discriminator(1) + status(1) + padding(6) + provider(32) = 40 bytes before hash
  const hashStart = 40;
  const onChainHash = data.slice(hashStart, hashStart + 32);

  // Compare hashes
  if (onChainHash.length !== expectedHash.length) {
    return false;
  }

  for (let i = 0; i < 32; i++) {
    if (onChainHash[i] !== expectedHash[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Initialize commitment state from on-chain data
 *
 * Scans for existing commitments to determine the next sequence number
 *
 * @param rpcUrl - Solana RPC URL(s)
 * @param entropyProgramId - Entropy program ID
 * @param provider - Provider address
 * @returns Initial commitment state
 */
export async function initCommitmentState(
  rpcUrl: string | string[],
  entropyProgramId: Address,
  provider: Address,
  rpcFailover?: RpcFailoverOptions
): Promise<CommitmentState> {
  const urls = Array.isArray(rpcUrl) ? rpcUrl : [rpcUrl];
  const rpc = createRpcFromUrls(urls, rpcFailover);

  // Start with sequence 0 and scan for existing commitments
  let nextSequence = 0n;
  const pending: PendingCommitment[] = [];

  // Check up to 1000 sequences to find the highest one
  // In practice we'd use getProgramAccounts with filters
  for (let seq = 0n; seq < 1000n; seq++) {
    const [pda] = await deriveCommitmentPda(entropyProgramId, provider, seq);
    const accountInfo = await (rpc as any).getAccountInfo(pda, { encoding: "base64" }).send();

    if (!accountInfo.value) {
      // No account at this sequence, we've found our next sequence
      nextSequence = seq;
      break;
    }

    // Account exists, decode and check status
    const data = Buffer.from(accountInfo.value.data[0], "base64");
    if (data.length >= COMMITMENT_SIZE) {
      const status = data[1]; // status byte at offset 1

      // If status is 0 (pending), add to pending list
      if (status === 0) {
        const hash = new Uint8Array(data.slice(40, 72)); // hash at offset 40
        pending.push({
          sequence: seq,
          address: pda,
          hash,
          commitSlot: 0n, // Unknown
          signature: "", // Unknown
        });
      }
    }

    nextSequence = seq + 1n;
  }

  return { nextSequence, pending };
}

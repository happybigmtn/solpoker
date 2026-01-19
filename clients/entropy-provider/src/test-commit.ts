#!/usr/bin/env npx tsx
/**
 * Test script for commitment posting
 *
 * Usage: npx tsx src/test-commit.ts
 */

import {
  address,
  createKeyPairSignerFromBytes,
  getProgramDerivedAddress,
} from "@solana/kit";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { generateHashChain } from "./hash-chain.js";
import {
  postCommitment,
  initCommitmentState,
  verifyCommitmentOnChain,
  type EntropyProviderConfig,
} from "./commit.js";

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const WS_URL = process.env.SOLANA_WS_URL || "wss://api.devnet.solana.com";
const ENTROPY_PROGRAM_ID = address("GG5nqvfpYHXyMF5A5yyMYjTCKQmKTDjMheJ4iCRSvTRf");

async function loadKeypair() {
  const keypairPath = join(homedir(), ".config", "solana", "id.json");
  const secretKey = JSON.parse(readFileSync(keypairPath, "utf-8")) as number[];
  return createKeyPairSignerFromBytes(new Uint8Array(secretKey));
}

async function deriveConfigPda() {
  const [pda] = await getProgramDerivedAddress({
    programAddress: ENTROPY_PROGRAM_ID,
    seeds: [new TextEncoder().encode("config")],
  });
  return pda;
}

async function main() {
  console.log("Testing commitment posting...\n");
  console.log("RPC URL:", RPC_URL);
  console.log("Entropy Program:", ENTROPY_PROGRAM_ID);
  console.log();

  // Load provider keypair
  const providerSigner = await loadKeypair();
  console.log("Provider:", providerSigner.address);

  // Derive config PDA
  const entropyConfigPda = await deriveConfigPda();
  console.log("Entropy Config PDA:", entropyConfigPda);
  console.log();

  // Create hash chain
  console.log("Creating hash chain...");
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const chain = generateHashChain(seed, 10);
  console.log("Hash chain created with 10 hashes");
  console.log();

  // Initialize commitment state
  console.log("Initializing commitment state from on-chain...");
  const state = await initCommitmentState(RPC_URL, ENTROPY_PROGRAM_ID, providerSigner.address);
  console.log("Next sequence:", state.nextSequence.toString());
  console.log("Pending commitments:", state.pending.length);
  console.log();

  // Build config
  const config: EntropyProviderConfig = {
    rpcUrl: RPC_URL,
    wsUrl: WS_URL,
    entropyProgramId: ENTROPY_PROGRAM_ID,
    entropyConfigPda,
    providerSigner,
    minBond: BigInt(100_000_000), // 0.1 SOL
  };

  // Post commitment
  console.log("Posting commitment...");
  try {
    const pending = await postCommitment(config, chain, state);
    console.log("✓ Commitment posted successfully!");
    console.log("  Sequence:", pending.sequence.toString());
    console.log("  Address:", pending.address);
    console.log("  Signature:", pending.signature);
    console.log("  Commit Slot:", pending.commitSlot.toString());
    console.log();

    // Verify commitment
    console.log("Verifying commitment on-chain...");
    const verified = await verifyCommitmentOnChain(RPC_URL, pending.address, pending.hash);
    if (verified) {
      console.log("✓ Commitment verified on-chain with correct hash!");
    } else {
      console.log("✗ Commitment verification failed");
    }
  } catch (error) {
    console.error("✗ Failed to post commitment:", error);
    process.exit(1);
  }

  console.log("\nDone!");
}

main().catch(console.error);

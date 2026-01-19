/**
 * Initialize config accounts on devnet
 *
 * This script:
 * 1. Derives config PDAs for both programs
 * 2. Sends initialize instructions
 * 3. Verifies the accounts via RPC
 *
 * Usage: npx tsx scripts/init-configs.ts
 *        ENTROPY_PROGRAM_ID=<ID> POKER_PROGRAM_ID=<ID> npx tsx scripts/init-configs.ts
 */

import {
  address,
  getProgramDerivedAddress,
  getBase58Decoder,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageFeePayerSigner,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  pipe,
  type Address,
  type TransactionSigner,
  type Rpc,
} from "@solana/kit";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  buildEntropyInitializeData,
  getEntropyInitializeAccountMetas,
  buildInitializeData,
  getInitializeAccountMetas,
} from "../src/index.js";
import { SYSTEM_PROGRAM_ID } from "../src/constants.js";
import { createRpc, logRpcConfig } from "./utils/rpc.js";

// Program IDs (from deployed programs; override via env for fresh deployments)
const DEFAULT_ENTROPY_PROGRAM_ID = "GG5nqvfpYHXyMF5A5yyMYjTCKQmKTDjMheJ4iCRSvTRf";
const DEFAULT_POKER_PROGRAM_ID = "3oG9MCSnE7UJDQKzEoJdmHrZ3qA7Y5ADdWbYqH1KpxLv";
const ENTROPY_PROGRAM_ID = address(process.env.ENTROPY_PROGRAM_ID ?? DEFAULT_ENTROPY_PROGRAM_ID);
const POKER_PROGRAM_ID = address(process.env.POKER_PROGRAM_ID ?? DEFAULT_POKER_PROGRAM_ID);

// Config parameters
const ENTROPY_CONFIG = {
  minBond: BigInt(100_000_000), // 0.1 SOL in lamports
  revealWindowSlots: BigInt(150), // ~1 minute at 400ms/slot
  slashBasisPoints: BigInt(5000), // 50% slash on failure
};

const POKER_CONFIG = {
  minPlayers: 2,
  minBuyIn: BigInt(1_000_000_000), // 1 CRISPS (9 decimals)
  maxBuyIn: BigInt(100_000_000_000), // 100 CRISPS
  actionTimeoutSlots: BigInt(60), // ~24 seconds at 400ms/slot
};

// Parse CLI args for optional CRISPS mint address
function parseArgs(): { crispsMint?: string } {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--crisps-mint" && args[i + 1]) {
      return { crispsMint: args[i + 1] };
    }
  }
  return {};
}

async function loadKeypair(): Promise<TransactionSigner> {
  const keypairPath = join(homedir(), ".config", "solana", "id.json");
  const secretKey = JSON.parse(readFileSync(keypairPath, "utf-8")) as number[];
  return createKeyPairSignerFromBytes(new Uint8Array(secretKey));
}

async function deriveConfigPda(programId: Address): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode("config")],
  });
  return pda;
}

function parseEntropyConfig(data: Uint8Array): {
  discriminator: number;
  initialized: boolean;
  provider: string;
  authority: string;
  minBond: bigint;
  revealWindowSlots: bigint;
  slashBasisPoints: bigint;
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = getBase58Decoder();

  return {
    discriminator: data[0],
    initialized: data[1] === 1,
    provider: decoder.decode(data.slice(8, 40)),
    authority: decoder.decode(data.slice(40, 72)),
    minBond: view.getBigUint64(72, true),
    revealWindowSlots: view.getBigUint64(80, true),
    slashBasisPoints: view.getBigUint64(88, true),
  };
}

function parsePokerConfig(data: Uint8Array): {
  discriminator: number;
  initialized: boolean;
  minPlayers: number;
  rakeBps: number;
  crispsMint: string;
  authority: string;
  entropyProgram: string;
  minBuyIn: bigint;
  maxBuyIn: bigint;
  actionTimeoutSlots: bigint;
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = getBase58Decoder();

  return {
    discriminator: data[0],
    initialized: data[1] === 1,
    minPlayers: data[2],
    rakeBps: view.getUint16(6, true),
    crispsMint: decoder.decode(data.slice(8, 40)),
    authority: decoder.decode(data.slice(40, 72)),
    entropyProgram: decoder.decode(data.slice(72, 104)),
    minBuyIn: view.getBigUint64(104, true),
    maxBuyIn: view.getBigUint64(112, true),
    actionTimeoutSlots: view.getBigUint64(120, true),
  };
}

async function sendAndConfirmTransaction(
  rpc: Rpc<any>,
  signedTx: any,
  commitment: "processed" | "confirmed" | "finalized" = "confirmed"
): Promise<string> {
  // Get the wire format
  const encodedTx = getBase64EncodedWireTransaction(signedTx);

  // Send the transaction
  const signature = await rpc
    .sendTransaction(encodedTx, {
      encoding: "base64",
      skipPreflight: false,
      preflightCommitment: commitment,
    })
    .send();

  // Poll for confirmation
  console.log(`  Sent: ${signature}`);
  console.log(`  Waiting for confirmation...`);

  let attempts = 0;
  const maxAttempts = 60; // 30 seconds at 500ms per poll

  while (attempts < maxAttempts) {
    const status = await rpc
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
          throw new Error(`Transaction failed: ${JSON.stringify(status.value[0].err)}`);
        }
        return signature as string;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
    attempts++;
  }

  throw new Error(`Transaction confirmation timeout after ${maxAttempts * 500}ms`);
}

async function main() {
  console.log("Initializing config accounts on devnet...\n");
  logRpcConfig();
  console.log();

  const cliArgs = parseArgs();

  // Create RPC client
  const rpc = createRpc();

  // Load keypair
  const signer = await loadKeypair();
  console.log(`Authority: ${signer.address}`);

  // Derive PDAs
  const entropyConfigPda = await deriveConfigPda(ENTROPY_PROGRAM_ID);
  const pokerConfigPda = await deriveConfigPda(POKER_PROGRAM_ID);

  console.log(`Entropy Config PDA: ${entropyConfigPda}`);
  console.log(`Poker Config PDA: ${pokerConfigPda}`);
  console.log();

  // Check if configs already exist
  const entropyConfigInfo = await rpc.getAccountInfo(entropyConfigPda, { encoding: "base64" }).send();
  const pokerConfigInfo = await rpc.getAccountInfo(pokerConfigPda, { encoding: "base64" }).send();

  // Initialize Entropy Config if needed
  if (!entropyConfigInfo.value) {
    console.log("Initializing entropy config...");

    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

    const entropyInitData = buildEntropyInitializeData({
      minBond: ENTROPY_CONFIG.minBond,
      revealWindowSlots: ENTROPY_CONFIG.revealWindowSlots,
      slashBasisPoints: ENTROPY_CONFIG.slashBasisPoints,
    });

    const entropyInitAccounts = getEntropyInitializeAccountMetas({
      config: entropyConfigPda,
      authority: signer.address,
      provider: signer.address, // Use authority as initial provider
      systemProgram: address(SYSTEM_PROGRAM_ID),
    });

    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(signer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) =>
        appendTransactionMessageInstruction(
          {
            programAddress: ENTROPY_PROGRAM_ID,
            accounts: entropyInitAccounts.map((a) => ({
              address: a.address,
              role:
                a.role === "writable"
                  ? (1 as const)
                  : a.role === "signer"
                    ? (2 as const)
                    : a.role === "writable_signer"
                      ? (3 as const)
                      : (0 as const),
            })),
            data: entropyInitData,
          },
          m
        )
    );

    const signedTx = await signTransactionMessageWithSigners(message);
    const signature = await sendAndConfirmTransaction(rpc, signedTx, "confirmed");
    console.log(`Entropy config initialized: ${signature}`);

    // Verify the account was created
    const updatedInfo = await rpc.getAccountInfo(entropyConfigPda, { encoding: "base64" }).send();
    if (updatedInfo.value) {
      const data = Buffer.from(updatedInfo.value.data[0], "base64");
      const parsed = parseEntropyConfig(new Uint8Array(data));
      console.log("  Verified - Initialized:", parsed.initialized);
      console.log("  Provider:", parsed.provider);
      console.log("  Min Bond:", parsed.minBond.toString(), "lamports");
    }
  } else {
    console.log("Entropy config already exists:");
    const data = Buffer.from(entropyConfigInfo.value.data[0], "base64");
    const parsed = parseEntropyConfig(new Uint8Array(data));
    console.log("  Initialized:", parsed.initialized);
    console.log("  Provider:", parsed.provider);
    console.log("  Min Bond:", parsed.minBond.toString(), "lamports");
  }
  console.log();

  // Initialize Poker Config if needed (requires CRISPS mint)
  if (!pokerConfigInfo.value) {
    if (cliArgs.crispsMint) {
      console.log("Initializing poker config...");
      console.log(`  CRISPS Mint: ${cliArgs.crispsMint}`);

      const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

      const pokerInitData = buildInitializeData({
        minPlayers: POKER_CONFIG.minPlayers,
        minBuyIn: POKER_CONFIG.minBuyIn,
        maxBuyIn: POKER_CONFIG.maxBuyIn,
        actionTimeoutSlots: POKER_CONFIG.actionTimeoutSlots,
      });

      const pokerInitAccounts = getInitializeAccountMetas({
        config: pokerConfigPda,
        authority: signer.address,
        crispsMint: address(cliArgs.crispsMint),
        entropyProgram: ENTROPY_PROGRAM_ID,
        systemProgram: address(SYSTEM_PROGRAM_ID),
      });

      const message = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(signer, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
        (m) =>
          appendTransactionMessageInstruction(
            {
              programAddress: POKER_PROGRAM_ID,
              accounts: pokerInitAccounts.map((a) => ({
                address: a.address,
                role:
                  a.role === "writable"
                    ? (1 as const)
                    : a.role === "signer"
                      ? (2 as const)
                      : a.role === "writable_signer"
                        ? (3 as const)
                        : (0 as const),
              })),
              data: pokerInitData,
            },
            m
          )
      );

      const signedTx = await signTransactionMessageWithSigners(message);
      const signature = await sendAndConfirmTransaction(rpc, signedTx, "confirmed");
      console.log(`Poker config initialized: ${signature}`);

      // Verify the account was created
      const updatedInfo = await rpc.getAccountInfo(pokerConfigPda, { encoding: "base64" }).send();
      if (updatedInfo.value) {
        const data = Buffer.from(updatedInfo.value.data[0], "base64");
        const parsed = parsePokerConfig(new Uint8Array(data));
        console.log("  Verified - Initialized:", parsed.initialized);
        console.log("  CRISPS Mint:", parsed.crispsMint);
        console.log("  Entropy Program:", parsed.entropyProgram);
      }
    } else {
      console.log("Poker config does not exist yet.");
      console.log("NOTE: Poker config initialization requires a CRISPS mint.");
      console.log("Run with: npx tsx scripts/init-configs.ts --crisps-mint <MINT_ADDRESS>");
    }
  } else {
    console.log("Poker config already exists:");
    const data = Buffer.from(pokerConfigInfo.value.data[0], "base64");
    const parsed = parsePokerConfig(new Uint8Array(data));
    console.log("  Initialized:", parsed.initialized);
    console.log("  CRISPS Mint:", parsed.crispsMint);
    console.log("  Entropy Program:", parsed.entropyProgram);
    console.log("  Min Buy-in:", parsed.minBuyIn.toString());
    console.log("  Max Buy-in:", parsed.maxBuyIn.toString());
    console.log("  Action Timeout:", parsed.actionTimeoutSlots.toString(), "slots");
  }

  console.log("\nDone!");
}

main().catch(console.error);

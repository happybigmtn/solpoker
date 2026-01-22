#!/usr/bin/env npx tsx
/**
 * Auto-Join Bot
 *
 * Monitors poker tables and automatically joins when a human player joins.
 * This creates an opponent for testing/playing.
 *
 * Usage:
 *   npx tsx scripts/auto-join-bot.ts
 *
 * Environment:
 *   BOT_KEYPAIR_PATH - Path to bot keypair (default: ~/.config/solana/bot.json)
 *   SOLANA_RPC_URL - RPC endpoint
 *   SOLANA_WS_URL - WebSocket endpoint
 */

import {
  address,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageFeePayerSigner,
  appendTransactionMessageInstruction,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  getBase58Decoder,
  pipe,
  type Address,
  type TransactionSigner,
  type Rpc,
  type IInstruction,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { createRpc, createRpcSubscriptions, logRpcConfig, getRpcUrl, getWsUrl } from "./utils/rpc.js";

import {
  buildJoinTableData,
  getJoinTableAccountMetas,
  derivePokerConfigPda,
  deriveTablePda,
  deriveVaultPda,
  SEAT_STATUS,
  TABLE_STATUS,
  SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  buildCreateAtaIdempotentData,
  getCreateAtaIdempotentAccountMetas,
} from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Program IDs
const POKER_PROGRAM_ID = address(
  process.env.POKER_PROGRAM_ID || "CNLMFh8DNRLyrx5x1ecrspTHpa3nTzMaophZxxUjgKMi"
);

// CRISPS mint
const CRISPS_MINT = address(
  process.env.CRISPS_MINT || "7HK33BUJivS2nSsJjZwgpBDQRrSY59WeCYmSQQtJqW3B"
);

// Bot configuration
const BOT_KEYPAIR_PATH = process.env.BOT_KEYPAIR_PATH || join(homedir(), ".config", "solana", "bot.json");
const BUY_IN_AMOUNT = BigInt(10_000_000_000); // 10 CRISPS
const POLL_INTERVAL_MS = 3000; // Check every 3 seconds
const CRISPS_DECIMALS = 9;

// Track tables we've already joined
const joinedTables = new Set<string>();

function roleToNumber(role: string): 0 | 1 | 2 | 3 {
  switch (role) {
    case "writable":
      return 1;
    case "signer":
      return 2;
    case "writable_signer":
      return 3;
    default:
      return 0;
  }
}

function mapAccountMetas(
  metas: Array<{ address: Address; role: string }>
): Array<{ address: Address; role: 0 | 1 | 2 | 3 }> {
  return metas.map((m) => ({
    address: m.address,
    role: roleToNumber(m.role),
  }));
}

async function loadBotKeypair(): Promise<TransactionSigner> {
  if (!existsSync(BOT_KEYPAIR_PATH)) {
    console.error(`\n❌ Bot keypair not found at: ${BOT_KEYPAIR_PATH}`);
    console.error(`\nTo create a bot keypair, run:`);
    console.error(`  solana-keygen new -o ${BOT_KEYPAIR_PATH} --no-bip39-passphrase`);
    console.error(`\nThen fund it with SOL and CRISPS:`);
    console.error(`  solana airdrop 1 $(solana-keygen pubkey ${BOT_KEYPAIR_PATH})`);
    console.error(`  npx tsx scripts/faucet-crisps.ts $(solana-keygen pubkey ${BOT_KEYPAIR_PATH}) 100`);
    process.exit(1);
  }

  console.log(`Loading bot keypair from ${BOT_KEYPAIR_PATH}`);
  const secretKey = JSON.parse(readFileSync(BOT_KEYPAIR_PATH, "utf-8")) as number[];
  return createKeyPairSignerFromBytes(new Uint8Array(secretKey));
}

function parseTableState(data: Uint8Array): {
  status: number;
  seats: Array<{ status: number; stack: bigint; player: string }>;
  playerCount: number;
  tableId: bigint;
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = getBase58Decoder();

  const status = data[1];
  const playerCount = data[2];
  const tableId = view.getBigUint64(8, true);

  const seats: Array<{ status: number; stack: bigint; player: string }> = [];
  const SEAT_SIZE = 96;
  const SEATS_OFFSET = 176;

  for (let i = 0; i < 10; i++) {
    const seatOffset = SEATS_OFFSET + i * SEAT_SIZE;
    const seatStatus = data[seatOffset];
    const player = decoder.decode(data.slice(seatOffset + 8, seatOffset + 40));
    const stack = view.getBigUint64(seatOffset + 40, true);
    seats.push({ status: seatStatus, stack, player });
  }

  return { status, seats, playerCount, tableId };
}

async function sendAndConfirmTransaction(
  rpc: Rpc<any>,
  signedTx: any,
  commitment: "processed" | "confirmed" | "finalized" = "confirmed"
): Promise<string> {
  const encodedTx = getBase64EncodedWireTransaction(signedTx);

  let signature: string;
  try {
    signature = await rpc
      .sendTransaction(encodedTx, {
        encoding: "base64",
        skipPreflight: false,
        preflightCommitment: commitment,
      })
      .send();
  } catch (err: any) {
    const errData = err?.context?.cause?.data || err?.cause?.data || err?.data;
    if (errData?.logs) {
      console.log(`  Transaction logs:`);
      errData.logs.forEach((log: string) => console.log(`    ${log}`));
    }
    throw err;
  }

  let attempts = 0;
  const maxAttempts = 60;

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
          throw new Error(
            `Transaction failed: ${JSON.stringify(status.value[0].err)}`
          );
        }
        return signature as string;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
    attempts++;
  }

  throw new Error(`Transaction confirmation timeout`);
}

async function joinTable(
  rpc: Rpc<any>,
  botSigner: TransactionSigner,
  tableAddress: Address,
  vaultAddress: Address,
  pokerConfigPda: Address
): Promise<boolean> {
  console.log(`\n🤖 Bot joining table ${tableAddress.slice(0, 8)}...`);

  try {
    // Find bot's ATA
    const [botAta] = await findAssociatedTokenPda({
      owner: botSigner.address,
      mint: CRISPS_MINT,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });

    // Build create ATA idempotent instruction
    const createAtaAccounts = getCreateAtaIdempotentAccountMetas({
      payer: botSigner.address,
      ata: botAta,
      wallet: botSigner.address,
      mint: CRISPS_MINT,
      tokenProgramId: address(TOKEN_2022_PROGRAM_ID),
    });

    const createAtaInstruction: IInstruction = {
      programAddress: address(ASSOCIATED_TOKEN_PROGRAM_ID),
      accounts: mapAccountMetas(createAtaAccounts),
      data: buildCreateAtaIdempotentData(),
    };

    // Build join table instruction
    const joinTableData = buildJoinTableData({ buyInAmount: BUY_IN_AMOUNT });

    const joinTableAccounts = getJoinTableAccountMetas({
      table: tableAddress,
      vault: vaultAddress,
      playerTokenAccount: botAta,
      player: botSigner.address,
      config: pokerConfigPda,
      tokenProgram: address(TOKEN_2022_PROGRAM_ID),
    });

    const joinInstruction: IInstruction = {
      programAddress: POKER_PROGRAM_ID,
      accounts: mapAccountMetas(joinTableAccounts),
      data: joinTableData,
    };

    // Build and send transaction
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(botSigner, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) => appendTransactionMessageInstructions([createAtaInstruction, joinInstruction], m)
    );

    const signedTx = await signTransactionMessageWithSigners(message);
    const signature = await sendAndConfirmTransaction(rpc, signedTx, "confirmed");

    console.log(`✅ Bot joined table! Signature: ${signature.slice(0, 16)}...`);
    return true;
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    if (errMsg.includes("already initialized") || errMsg.includes("AlreadySeated")) {
      console.log(`ℹ️  Bot already at this table`);
      return true; // Consider it a success - we're already there
    }
    console.error(`❌ Failed to join table: ${errMsg.slice(0, 100)}`);
    return false;
  }
}

async function checkAndJoinTables(
  rpc: Rpc<any>,
  botSigner: TransactionSigner,
  pokerConfigPda: Address
): Promise<void> {
  try {
    // Fetch all poker program accounts
    const accounts = await rpc
      .getProgramAccounts(POKER_PROGRAM_ID, {
        encoding: "base64",
        filters: [
          { dataSize: 1136n }, // Table account size
        ],
      })
      .send();

    for (const account of accounts) {
      const tableAddress = account.pubkey;
      const data = Buffer.from(account.account.data[0], "base64");
      const tableState = parseTableState(new Uint8Array(data));

      // Skip if not in WAITING status (only join tables waiting for players)
      if (tableState.status !== TABLE_STATUS.WAITING) {
        continue;
      }

      // Skip if bot already joined this table
      if (joinedTables.has(tableAddress)) {
        continue;
      }

      // Check if there's exactly 1 player (human waiting for opponent)
      const occupiedSeats = tableState.seats.filter(
        (s) => s.status !== SEAT_STATUS.EMPTY
      );

      // Check if bot is already at this table
      const botAlreadySeated = tableState.seats.some(
        (s) => s.player === botSigner.address && s.status !== SEAT_STATUS.EMPTY
      );

      if (botAlreadySeated) {
        joinedTables.add(tableAddress);
        continue;
      }

      // Join if there's 1 player waiting
      if (occupiedSeats.length === 1) {
        console.log(`\n🎯 Found table ${tableAddress.slice(0, 8)}... with 1 player waiting`);

        // Derive vault address
        const [vaultAddress] = await deriveVaultPda(POKER_PROGRAM_ID, tableState.tableId);

        const success = await joinTable(
          rpc,
          botSigner,
          tableAddress as Address,
          vaultAddress,
          pokerConfigPda
        );

        if (success) {
          joinedTables.add(tableAddress);
        }
      }
    }
  } catch (err) {
    console.error(`Error checking tables: ${(err as Error).message}`);
  }
}

async function checkBotBalance(rpc: Rpc<any>, botSigner: TransactionSigner): Promise<void> {
  // Check SOL balance
  const solBalance = await rpc.getBalance(botSigner.address).send();
  console.log(`  SOL Balance: ${Number(solBalance.value) / 1e9} SOL`);

  if (solBalance.value < 10_000_000n) {
    console.log(`\n⚠️  Bot needs SOL! Run:`);
    console.log(`   solana airdrop 1 ${botSigner.address}`);
  }

  // Check CRISPS balance
  try {
    const [botAta] = await findAssociatedTokenPda({
      owner: botSigner.address,
      mint: CRISPS_MINT,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });

    const ataInfo = await rpc.getAccountInfo(botAta, { encoding: "base64" }).send();
    if (ataInfo.value) {
      const data = Buffer.from(ataInfo.value.data[0], "base64");
      const view = new DataView(data.buffer);
      const balance = view.getBigUint64(64, true);
      console.log(`  CRISPS Balance: ${Number(balance) / 10 ** CRISPS_DECIMALS} CRISPS`);

      if (balance < BUY_IN_AMOUNT * 2n) {
        console.log(`\n⚠️  Bot needs CRISPS! Run:`);
        console.log(`   npx tsx scripts/faucet-crisps.ts ${botSigner.address}`);
      }
    } else {
      console.log(`  CRISPS Balance: 0 (ATA not created yet)`);
      console.log(`\n⚠️  Bot needs CRISPS! Run:`);
      console.log(`   npx tsx scripts/faucet-crisps.ts ${botSigner.address}`);
    }
  } catch {
    console.log(`  CRISPS Balance: Unable to check`);
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("🤖 Poker Auto-Join Bot");
  console.log("=".repeat(60));
  console.log();

  logRpcConfig();
  console.log();

  // Load bot keypair
  const botSigner = await loadBotKeypair();
  console.log(`Bot Address: ${botSigner.address}`);

  // Create RPC client
  const rpc = createRpc();

  // Check bot balances
  console.log("\nChecking bot balances...");
  await checkBotBalance(rpc, botSigner);

  // Derive config PDA
  const [pokerConfigPda] = await derivePokerConfigPda(POKER_PROGRAM_ID);
  console.log(`\nPoker Config: ${pokerConfigPda}`);

  console.log(`\n🔄 Starting table monitor (checking every ${POLL_INTERVAL_MS / 1000}s)...`);
  console.log("   Bot will auto-join tables when a player is waiting\n");

  // Poll for tables
  while (true) {
    await checkAndJoinTables(rpc, botSigner, pokerConfigPda);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

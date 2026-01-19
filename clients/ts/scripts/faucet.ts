/**
 * Combined SOL + CRISPS faucet for player convenience
 *
 * This script:
 * 1. Airdrops devnet SOL to a wallet (for transaction fees)
 * 2. Mints CRISPS tokens to the wallet (for poker buy-ins)
 *
 * Usage: npx tsx scripts/faucet.ts [WALLET_ADDRESS] [--sol AMOUNT] [--crisps AMOUNT]
 *        Default: 1 SOL + 1000 CRISPS to the configured authority wallet
 *
 * Examples:
 *   npx tsx scripts/faucet.ts                           # Default wallet, 1 SOL + 1000 CRISPS
 *   npx tsx scripts/faucet.ts ABC123...                 # Specific wallet
 *   npx tsx scripts/faucet.ts --sol 2                   # 2 SOL only
 *   npx tsx scripts/faucet.ts --crisps 500              # 500 CRISPS only
 *   npx tsx scripts/faucet.ts ABC123... --sol 2 --crisps 500
 */

import {
  address,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageFeePayerSigner,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  lamports,
  pipe,
  type TransactionSigner,
  type Rpc,
  type Address,
} from "@solana/kit";
import {
  getMintToInstruction,
  getCreateAssociatedTokenInstructionAsync,
  findAssociatedTokenPda,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRpc, logRpcConfig } from "./utils/rpc.js";

// Defaults
const DEFAULT_SOL_AMOUNT = 1; // 1 SOL
const DEFAULT_CRISPS_AMOUNT = 1000; // 1000 CRISPS
const CRISPS_DECIMALS = 9;

// Mint address file
const __dirname = dirname(fileURLToPath(import.meta.url));
const MINT_ADDRESS_FILE = join(__dirname, ".crisps-mint-address");

interface FaucetArgs {
  recipient?: string;
  solAmount: number;
  crispsAmount: number;
  skipSol: boolean;
  skipCrisps: boolean;
}

function parseArgs(): FaucetArgs {
  const args = process.argv.slice(2);
  const result: FaucetArgs = {
    solAmount: DEFAULT_SOL_AMOUNT,
    crispsAmount: DEFAULT_CRISPS_AMOUNT,
    skipSol: false,
    skipCrisps: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--sol" && args[i + 1]) {
      result.solAmount = parseFloat(args[++i]);
    } else if (arg === "--crisps" && args[i + 1]) {
      result.crispsAmount = parseFloat(args[++i]);
    } else if (arg === "--no-sol") {
      result.skipSol = true;
    } else if (arg === "--no-crisps") {
      result.skipCrisps = true;
    } else if (!arg.startsWith("--") && !result.recipient) {
      result.recipient = arg;
    }
  }

  return result;
}

async function loadKeypair(): Promise<TransactionSigner> {
  const keypairPath = join(homedir(), ".config", "solana", "id.json");
  const secretKey = JSON.parse(readFileSync(keypairPath, "utf-8")) as number[];
  return createKeyPairSignerFromBytes(new Uint8Array(secretKey));
}

async function sendAndConfirmTransaction(
  rpc: Rpc<any>,
  signedTx: any,
  commitment: "processed" | "confirmed" | "finalized" = "confirmed"
): Promise<string> {
  const encodedTx = getBase64EncodedWireTransaction(signedTx);

  const signature = await rpc
    .sendTransaction(encodedTx, {
      encoding: "base64",
      skipPreflight: false,
      preflightCommitment: commitment,
    })
    .send();

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

function parseTokenAccountBalance(data: Uint8Array): bigint {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getBigUint64(64, true);
}

async function airdropSol(rpc: Rpc<any>, recipient: Address, amount: number): Promise<boolean> {
  console.log(`\n💧 Airdropping ${amount} SOL to ${recipient}...`);

  const lamportsAmount = BigInt(Math.floor(amount * 1_000_000_000));

  try {
    const signature = await rpc
      .requestAirdrop(recipient, lamports(lamportsAmount), { commitment: "confirmed" })
      .send();

    console.log(`  Signature: ${signature}`);
    console.log(`  Waiting for confirmation...`);

    // Wait for confirmation
    let attempts = 0;
    const maxAttempts = 60;

    while (attempts < maxAttempts) {
      const status = await rpc
        .getSignatureStatuses([signature], { searchTransactionHistory: false })
        .send();

      if (status.value[0]) {
        const confirmationStatus = status.value[0].confirmationStatus;
        if (confirmationStatus === "confirmed" || confirmationStatus === "finalized") {
          if (status.value[0].err) {
            throw new Error(`Airdrop failed: ${JSON.stringify(status.value[0].err)}`);
          }
          console.log(`  ✓ Airdrop confirmed`);
          return true;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
      attempts++;
    }

    throw new Error("Airdrop confirmation timeout");
  } catch (err: any) {
    // Handle common failures gracefully
    const errMsg = err.message || String(err);
    if (errMsg.includes("400") || errMsg.includes("Bad Request")) {
      console.log(`  ⚠ Airdrop not available on this RPC (Helius doesn't support requestAirdrop)`);
      console.log(`    Use Helius dashboard: https://dashboard.helius.dev/ → Devnet Faucet`);
      console.log(`    Or use public RPC: SOLANA_RPC_URL=https://api.devnet.solana.com`);
      return false;
    } else if (errMsg.includes("429") || errMsg.includes("rate")) {
      console.log(`  ⚠ Airdrop rate limited. Try again in a few seconds.`);
      return false;
    } else {
      console.log(`  ⚠ Airdrop failed: ${errMsg}`);
      return false;
    }
  }
}

async function mintCrisps(
  rpc: Rpc<any>,
  signer: TransactionSigner,
  mintAddress: Address,
  recipient: Address,
  amount: number
): Promise<void> {
  console.log(`\n🪙 Minting ${amount} CRISPS to ${recipient}...`);

  const amountBaseUnits = BigInt(Math.floor(amount * 10 ** CRISPS_DECIMALS));

  // Find ATA
  const [ata] = await findAssociatedTokenPda({
    owner: recipient,
    mint: mintAddress,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });
  console.log(`  ATA: ${ata}`);

  // Check if ATA exists
  const ataInfo = await rpc.getAccountInfo(ata, { encoding: "base64" }).send();
  const ataExists = ataInfo.value !== null;

  const instructions: any[] = [];

  if (!ataExists) {
    console.log(`  Creating ATA...`);
    const createAtaIx = await getCreateAssociatedTokenInstructionAsync({
      payer: signer,
      owner: recipient,
      mint: mintAddress,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });
    instructions.push(createAtaIx);
  }

  // Mint tokens
  const mintToIx = getMintToInstruction({
    mint: mintAddress,
    token: ata,
    mintAuthority: signer,
    amount: amountBaseUnits,
  });
  instructions.push(mintToIx);

  // Build and send transaction
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m)
  );

  const signedTx = await signTransactionMessageWithSigners(transactionMessage);
  const signature = await sendAndConfirmTransaction(rpc, signedTx, "confirmed");
  console.log(`  ✓ Minted: ${signature}`);

  // Show new balance
  const updatedAtaInfo = await rpc.getAccountInfo(ata, { encoding: "base64" }).send();
  if (updatedAtaInfo.value) {
    const data = Buffer.from(updatedAtaInfo.value.data[0], "base64");
    const newBalance = parseTokenAccountBalance(new Uint8Array(data));
    console.log(`  Balance: ${Number(newBalance) / 10 ** CRISPS_DECIMALS} CRISPS`);
  }
}

async function main() {
  console.log("🎰 Robopoker Faucet\n");
  logRpcConfig();

  const args = parseArgs();

  // Load mint authority keypair
  const signer = await loadKeypair();
  console.log(`Authority: ${signer.address}`);

  // Determine recipient
  const recipient: Address = args.recipient ? address(args.recipient) : signer.address;
  console.log(`Recipient: ${recipient}`);

  // Check SOL balance before
  const rpc = createRpc();
  const balanceBefore = await rpc.getBalance(recipient).send();
  console.log(`SOL Balance: ${Number(balanceBefore.value) / 1_000_000_000} SOL`);

  // Airdrop SOL if requested and needed
  const currentSol = Number(balanceBefore.value) / 1_000_000_000;
  if (!args.skipSol && args.solAmount > 0) {
    if (currentSol >= 1) {
      console.log(`\n💧 Skipping SOL airdrop (already have ${currentSol.toFixed(2)} SOL)`);
    } else {
      await airdropSol(rpc, recipient, args.solAmount);
    }
  }

  // Mint CRISPS if requested
  if (!args.skipCrisps && args.crispsAmount > 0) {
    if (!existsSync(MINT_ADDRESS_FILE)) {
      console.log("\n⚠ CRISPS mint not found. Run create-crisps-mint.ts first.");
      console.log("  Skipping CRISPS mint.");
    } else {
      const mintAddress = address(readFileSync(MINT_ADDRESS_FILE, "utf-8").trim());
      console.log(`CRISPS Mint: ${mintAddress}`);
      await mintCrisps(rpc, signer, mintAddress, recipient, args.crispsAmount);
    }
  }

  // Final balance check
  console.log("\n=== Summary ===");
  const balanceAfter = await rpc.getBalance(recipient).send();
  console.log(`SOL Balance: ${Number(balanceAfter.value) / 1_000_000_000} SOL`);

  if (existsSync(MINT_ADDRESS_FILE)) {
    const mintAddress = address(readFileSync(MINT_ADDRESS_FILE, "utf-8").trim());
    const [ata] = await findAssociatedTokenPda({
      owner: recipient,
      mint: mintAddress,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });
    const ataInfo = await rpc.getAccountInfo(ata, { encoding: "base64" }).send();
    if (ataInfo.value) {
      const data = Buffer.from(ataInfo.value.data[0], "base64");
      const balance = parseTokenAccountBalance(new Uint8Array(data));
      console.log(`CRISPS Balance: ${Number(balance) / 10 ** CRISPS_DECIMALS} CRISPS`);
    }
  }

  console.log("\n✅ Ready to play!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Create CRISPS Token-2022 mint on devnet
 *
 * This script:
 * 1. Creates a new Token-2022 mint with 9 decimals
 * 2. Sets the authority wallet as mint authority
 * 3. Saves the mint address for subsequent scripts
 *
 * Usage: npx tsx scripts/create-crisps-mint.ts
 *
 * Tests AC-D3.1, AC-D3.2 from specs/devnet-deployment.md
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
  generateKeyPairSigner,
  pipe,
  type TransactionSigner,
  type Rpc,
} from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  getInitializeMint2Instruction,
  getMintSize,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRpc, logRpcConfig } from "./utils/rpc.js";

// CRISPS token configuration
const CRISPS_DECIMALS = 9;

// Output file for mint address
const __dirname = dirname(fileURLToPath(import.meta.url));
const MINT_ADDRESS_FILE = join(__dirname, ".crisps-mint-address");

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

  console.log(`  Sent: ${signature}`);
  console.log(`  Waiting for confirmation...`);

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

async function main() {
  console.log("Creating CRISPS Token-2022 mint on devnet...\n");
  logRpcConfig();
  console.log();

  // Check if mint already exists
  if (existsSync(MINT_ADDRESS_FILE)) {
    const existingMint = readFileSync(MINT_ADDRESS_FILE, "utf-8").trim();
    console.log(`CRISPS mint already exists: ${existingMint}`);
    console.log("Delete .crisps-mint-address to create a new mint.");
    return;
  }

  // Create RPC client
  const rpc = createRpc();

  // Load keypair
  const signer = await loadKeypair();
  console.log(`Authority: ${signer.address}`);

  // Generate new mint keypair
  const mint = await generateKeyPairSigner();
  console.log(`New mint address: ${mint.address}`);

  // Calculate mint size and rent
  const mintSize = getMintSize();
  console.log(`Mint size: ${mintSize} bytes`);

  const mintRent = await rpc.getMinimumBalanceForRentExemption(BigInt(mintSize)).send();
  console.log(`Rent-exempt minimum: ${mintRent} lamports`);

  // Get latest blockhash
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  // Build instructions
  const createAccountIx = getCreateAccountInstruction({
    payer: signer,
    newAccount: mint,
    lamports: mintRent,
    space: mintSize,
    programAddress: TOKEN_2022_PROGRAM_ADDRESS,
  });

  const initializeMintIx = getInitializeMint2Instruction({
    mint: mint.address,
    decimals: CRISPS_DECIMALS,
    mintAuthority: signer.address,
    freezeAuthority: signer.address,
  });

  // Build transaction
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions([createAccountIx, initializeMintIx], m)
  );

  // Sign and send
  console.log("\nCreating mint account...");
  const signedTx = await signTransactionMessageWithSigners(transactionMessage);
  const signature = await sendAndConfirmTransaction(rpc, signedTx, "confirmed");
  console.log(`Mint created: ${signature}`);

  // Verify the mint
  console.log("\nVerifying mint account...");
  const mintInfo = await rpc.getAccountInfo(mint.address, { encoding: "base64" }).send();

  if (!mintInfo.value) {
    throw new Error("Mint account not found after creation");
  }

  // Check owner is Token-2022 program
  const owner = mintInfo.value.owner;
  if (owner !== TOKEN_2022_PROGRAM_ADDRESS) {
    throw new Error(`Unexpected mint owner: ${owner} (expected ${TOKEN_2022_PROGRAM_ADDRESS})`);
  }
  console.log(`  Owner: ${owner} ✓ (Token-2022)`);

  // Parse mint data to verify decimals
  const data = Buffer.from(mintInfo.value.data[0], "base64");
  // Mint layout: mintAuthorityOption(4) + mintAuthority(32) + supply(8) + decimals(1) + ...
  const decimals = data[44]; // 4 + 32 + 8 = 44
  if (decimals !== CRISPS_DECIMALS) {
    throw new Error(`Unexpected decimals: ${decimals} (expected ${CRISPS_DECIMALS})`);
  }
  console.log(`  Decimals: ${decimals} ✓`);

  // Save mint address
  writeFileSync(MINT_ADDRESS_FILE, mint.address);
  console.log(`\nMint address saved to: ${MINT_ADDRESS_FILE}`);

  console.log("\n=== Summary ===");
  console.log(`CRISPS Mint: ${mint.address}`);
  console.log(`Decimals: ${CRISPS_DECIMALS}`);
  console.log(`Owner: ${TOKEN_2022_PROGRAM_ADDRESS} (Token-2022)`);
  console.log(`Mint Authority: ${signer.address}`);

  console.log("\nNext steps:");
  console.log("1. Run: npx tsx scripts/faucet-crisps.ts <WALLET_ADDRESS>");
  console.log("2. Run: npx tsx scripts/init-configs.ts --crisps-mint " + mint.address);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

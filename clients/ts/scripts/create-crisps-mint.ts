/**
 * Create CRISPS Token-2022 mint on devnet with metadata
 *
 * This script:
 * 1. Creates a new Token-2022 mint with 9 decimals
 * 2. Initializes MetadataPointer extension (points to mint itself)
 * 3. Initializes TokenMetadata extension (name, symbol, URI)
 * 4. Sets the authority wallet as mint authority
 * 5. Saves the mint address for subsequent scripts
 *
 * Usage: npx tsx scripts/create-crisps-mint.ts
 *
 * Tests AC-D3.1, AC-D3.2, AC-D3.4 from specs/devnet-deployment.md
 */

import {
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageFeePayerSigner,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  generateKeyPairSigner,
  pipe,
  some,
  type TransactionSigner,
  type Rpc,
} from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  getInitializeMint2Instruction,
  getInitializeMetadataPointerInstruction,
  getInitializeTokenMetadataInstruction,
  getMintSize,
  extension,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRpc, logRpcConfig } from "./utils/rpc.js";

// CRISPS token configuration
const CRISPS_DECIMALS = 9;
const CRISPS_NAME = "Robopoker Chips";
const CRISPS_SYMBOL = "CRISPS";
const CRISPS_URI = "https://robopoker.dev/crisps-metadata.json";

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

  // Define extensions for size calculation
  // MetadataPointer (64 bytes) + TokenMetadata (variable, depends on strings)
  const metadataPointerExt = extension("MetadataPointer", {
    authority: some(signer.address),
    metadataAddress: some(mint.address), // Metadata stored in mint account itself
  });
  const tokenMetadataExt = extension("TokenMetadata", {
    updateAuthority: some(signer.address),
    mint: mint.address,
    name: CRISPS_NAME,
    symbol: CRISPS_SYMBOL,
    uri: CRISPS_URI,
    additionalMetadata: new Map(),
  });

  // Calculate mint size with extensions
  const mintSize = getMintSize([metadataPointerExt, tokenMetadataExt]);
  console.log(`Mint size (with metadata): ${mintSize} bytes`);

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

  // Initialize MetadataPointer extension BEFORE InitializeMint2
  // This tells Token-2022 where to find the metadata (pointing to the mint itself)
  const initMetadataPointerIx = getInitializeMetadataPointerInstruction({
    mint: mint.address,
    authority: some(signer.address),
    metadataAddress: some(mint.address), // Self-referential: metadata stored in mint
  });

  const initializeMintIx = getInitializeMint2Instruction({
    mint: mint.address,
    decimals: CRISPS_DECIMALS,
    mintAuthority: signer.address,
    freezeAuthority: signer.address,
  });

  // Initialize TokenMetadata AFTER InitializeMint2
  // The metadata extension requires the mint to be initialized first
  const initTokenMetadataIx = getInitializeTokenMetadataInstruction({
    metadata: mint.address, // Metadata stored in mint account
    updateAuthority: signer.address,
    mint: mint.address,
    mintAuthority: signer,
    name: CRISPS_NAME,
    symbol: CRISPS_SYMBOL,
    uri: CRISPS_URI,
  });

  // Build transaction - order matters:
  // 1. CreateAccount (allocates space for mint + extensions)
  // 2. InitializeMetadataPointer (sets up extension before mint init)
  // 3. InitializeMint2 (initializes the base mint)
  // 4. InitializeTokenMetadata (writes metadata after mint init)
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) =>
      appendTransactionMessageInstructions(
        [createAccountIx, initMetadataPointerIx, initializeMintIx, initTokenMetadataIx],
        m
      )
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

  // Verify account size indicates extensions are present
  // Base mint is 82 bytes, with extensions it should be larger
  if (data.length <= 82) {
    throw new Error(`Mint account too small (${data.length} bytes), metadata extension missing`);
  }
  console.log(`  Account size: ${data.length} bytes ✓ (includes metadata extension)`);

  // Save mint address
  writeFileSync(MINT_ADDRESS_FILE, mint.address);
  console.log(`\nMint address saved to: ${MINT_ADDRESS_FILE}`);

  console.log("\n=== Summary ===");
  console.log(`CRISPS Mint: ${mint.address}`);
  console.log(`Decimals: ${CRISPS_DECIMALS}`);
  console.log(`Name: ${CRISPS_NAME}`);
  console.log(`Symbol: ${CRISPS_SYMBOL}`);
  console.log(`URI: ${CRISPS_URI}`);
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

/**
 * Create CRISPS Token-2022 mint on devnet with metadata
 *
 * This script:
 * 1. Creates a new Token-2022 mint with 9 decimals
 * 2. Adds MetadataPointer extension (self-referential)
 * 3. Adds TokenMetadata extension with name, symbol, URI
 * 4. Sets the authority wallet as mint authority
 * 5. Saves the mint address for subsequent scripts
 *
 * Token-2022 Extension Order (Critical):
 * - Extensions must be initialized BEFORE InitializeMint
 * - TokenMetadata must be initialized AFTER InitializeMint (it requires mint authority)
 * - Account space must be pre-allocated for ALL extensions
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
  type TransactionSigner,
  type Rpc,
} from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  getInitializeMintInstruction,
  getPreInitializeInstructionsForMintExtensions,
  getPostInitializeInstructionsForMintExtensions,
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
  console.log("Creating CRISPS Token-2022 mint on devnet with metadata...\n");
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

  // ===== Build extensions =====
  // MetadataPointer extension (points to the mint itself for self-referential metadata)
  const metadataPointerExt = extension("MetadataPointer", {
    authority: signer.address,
    metadataAddress: mint.address,
  });

  // TokenMetadata extension with actual values
  const tokenMetadataExt = extension("TokenMetadata", {
    updateAuthority: signer.address,
    mint: mint.address,
    name: CRISPS_NAME,
    symbol: CRISPS_SYMBOL,
    uri: CRISPS_URI,
    additionalMetadata: new Map(),
  });

  const extensions = [metadataPointerExt, tokenMetadataExt];

  // Calculate sizes:
  // - Full size with all extensions (for rent)
  // - Size without post-initialize extensions (for initial allocation)
  const fullMintSize = getMintSize(extensions);
  const initialMintSize = getMintSize([metadataPointerExt]); // TokenMetadata is post-initialize
  console.log(`Full mint size: ${fullMintSize} bytes`);
  console.log(`Initial mint size (without TokenMetadata): ${initialMintSize} bytes`);

  // Pay rent for full size upfront
  const mintRent = await rpc.getMinimumBalanceForRentExemption(BigInt(fullMintSize)).send();
  console.log(`Rent-exempt minimum: ${mintRent} lamports`);

  // Get latest blockhash
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  // ===== Build instructions using helper functions =====
  // 1. Create account (allocate space for pre-initialize extensions only, but pay for full rent)
  const createAccountIx = getCreateAccountInstruction({
    payer: signer,
    newAccount: mint,
    lamports: mintRent,
    space: initialMintSize, // Only MetadataPointer space initially
    programAddress: TOKEN_2022_PROGRAM_ADDRESS,
  });

  // 2. Pre-initialize extension instructions (MetadataPointer)
  const preInitIxs = getPreInitializeInstructionsForMintExtensions(mint.address, extensions);

  // 3. Initialize the mint
  const initializeMintIx = getInitializeMintInstruction({
    mint: mint.address,
    decimals: CRISPS_DECIMALS,
    mintAuthority: signer.address,
    freezeAuthority: signer.address,
  });

  // 4. Post-initialize extension instructions (TokenMetadata - handles realloc internally)
  const postInitIxs = getPostInitializeInstructionsForMintExtensions(mint.address, signer, extensions);

  console.log(`Pre-init instructions: ${preInitIxs.length}`);
  console.log(`Post-init instructions: ${postInitIxs.length}`);

  // Build and send single transaction
  const txMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) =>
      appendTransactionMessageInstructions(
        [createAccountIx, ...preInitIxs, initializeMintIx, ...postInitIxs],
        m
      )
  );

  console.log("\nCreating mint with MetadataPointer + TokenMetadata...");
  const signedTx = await signTransactionMessageWithSigners(txMessage);
  const signature = await sendAndConfirmTransaction(rpc, signedTx, "confirmed");
  console.log(`Mint created: ${signature}`);

  // ===== VERIFICATION =====
  console.log("\nVerifying mint account...");
  const mintInfo = await rpc.getAccountInfo(mint.address, { encoding: "base64" }).send();

  if (!mintInfo.value) {
    throw new Error("Mint account not found after creation");
  }

  const owner = mintInfo.value.owner;
  if (owner !== TOKEN_2022_PROGRAM_ADDRESS) {
    throw new Error(`Unexpected mint owner: ${owner} (expected ${TOKEN_2022_PROGRAM_ADDRESS})`);
  }
  console.log(`  Owner: ${owner} ✓ (Token-2022)`);

  const data = Buffer.from(mintInfo.value.data[0], "base64");
  const decimals = data[44];
  if (decimals !== CRISPS_DECIMALS) {
    throw new Error(`Unexpected decimals: ${decimals} (expected ${CRISPS_DECIMALS})`);
  }
  console.log(`  Decimals: ${decimals} ✓`);
  console.log(`  Account size: ${data.length} bytes ✓ (includes extensions)`);

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

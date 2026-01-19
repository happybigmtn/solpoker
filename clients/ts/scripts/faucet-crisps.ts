/**
 * CRISPS faucet - mint test tokens to a wallet
 *
 * This script:
 * 1. Creates an Associated Token Account (ATA) for the recipient if needed
 * 2. Mints CRISPS tokens to the recipient's ATA
 *
 * Usage: npx tsx scripts/faucet-crisps.ts [WALLET_ADDRESS] [AMOUNT]
 *        Default: mints to authority wallet, 1000 CRISPS
 *
 * Tests AC-D3.3 from specs/devnet-deployment.md
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

// CRISPS token configuration
const CRISPS_DECIMALS = 9;
const DEFAULT_AMOUNT = 1000; // 1000 CRISPS

// Mint address file
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

function parseTokenAccountBalance(data: Uint8Array): bigint {
  // Token account layout: mint(32) + owner(32) + amount(8) + ...
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getBigUint64(64, true);
}

async function main() {
  // Parse args
  const args = process.argv.slice(2);
  const recipientArg = args[0];
  const amountArg = args[1] ? parseFloat(args[1]) : DEFAULT_AMOUNT;

  // Load mint address
  if (!existsSync(MINT_ADDRESS_FILE)) {
    console.error("CRISPS mint not found. Run create-crisps-mint.ts first.");
    process.exit(1);
  }
  const mintAddress = address(readFileSync(MINT_ADDRESS_FILE, "utf-8").trim());

  console.log("CRISPS Faucet\n");
  logRpcConfig();
  console.log(`Mint: ${mintAddress}`);

  // Create RPC client
  const rpc = createRpc();

  // Load keypair (mint authority)
  const signer = await loadKeypair();
  console.log(`Mint Authority: ${signer.address}`);

  // Determine recipient
  const recipient: Address = recipientArg ? address(recipientArg) : signer.address;
  console.log(`Recipient: ${recipient}`);

  // Calculate amount in base units
  const amountBaseUnits = BigInt(Math.floor(amountArg * 10 ** CRISPS_DECIMALS));
  console.log(`Amount: ${amountArg} CRISPS (${amountBaseUnits} base units)`);

  // Find ATA for recipient
  const [ata] = await findAssociatedTokenPda({
    owner: recipient,
    mint: mintAddress,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });
  console.log(`ATA: ${ata}`);

  // Check if ATA exists
  const ataInfo = await rpc.getAccountInfo(ata, { encoding: "base64" }).send();
  const ataExists = ataInfo.value !== null;

  const instructions: any[] = [];

  if (!ataExists) {
    console.log("\nCreating Associated Token Account...");
    const createAtaIx = await getCreateAssociatedTokenInstructionAsync({
      payer: signer,
      owner: recipient,
      mint: mintAddress,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });
    instructions.push(createAtaIx);
  } else {
    console.log("\nATA already exists");
    const data = Buffer.from(ataInfo.value!.data[0], "base64");
    const currentBalance = parseTokenAccountBalance(new Uint8Array(data));
    console.log(`  Current balance: ${Number(currentBalance) / 10 ** CRISPS_DECIMALS} CRISPS`);
  }

  // Add mint instruction
  const mintToIx = getMintToInstruction({
    mint: mintAddress,
    token: ata,
    mintAuthority: signer,
    amount: amountBaseUnits,
  });
  instructions.push(mintToIx);

  // Get latest blockhash
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  // Build transaction
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m)
  );

  // Sign and send
  console.log("\nMinting tokens...");
  const signedTx = await signTransactionMessageWithSigners(transactionMessage);
  const signature = await sendAndConfirmTransaction(rpc, signedTx, "confirmed");
  console.log(`Minted: ${signature}`);

  // Verify new balance
  console.log("\nVerifying balance...");
  const updatedAtaInfo = await rpc.getAccountInfo(ata, { encoding: "base64" }).send();
  if (updatedAtaInfo.value) {
    const data = Buffer.from(updatedAtaInfo.value.data[0], "base64");
    const newBalance = parseTokenAccountBalance(new Uint8Array(data));
    console.log(`  New balance: ${Number(newBalance) / 10 ** CRISPS_DECIMALS} CRISPS`);
  }

  console.log("\n=== Summary ===");
  console.log(`Recipient: ${recipient}`);
  console.log(`ATA: ${ata}`);
  console.log(`Amount minted: ${amountArg} CRISPS`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

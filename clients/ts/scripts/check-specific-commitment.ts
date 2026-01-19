import { address, createKeyPairSignerFromBytes, getBase58Decoder } from "@solana/kit";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRpc } from "./utils/rpc.js";
import { deriveCommitmentPda } from "../src/index.js";

const ENTROPY_PROGRAM_ID = address("GG5nqvfpYHXyMF5A5yyMYjTCKQmKTDjMheJ4iCRSvTRf");

async function main() {
  const rpc = createRpc();
  const decoder = getBase58Decoder();
  
  const keypairPath = join(homedir(), ".config", "solana", "id.json");
  const secretKey = JSON.parse(readFileSync(keypairPath, "utf-8"));
  const signer = await createKeyPairSignerFromBytes(new Uint8Array(secretKey));
  
  // Check the commitment from the last test run
  const sequence = BigInt(1768851117556);
  const [commitmentPda] = await deriveCommitmentPda(ENTROPY_PROGRAM_ID, signer.address, sequence);
  
  console.log("Expected PDA: AVVVXYSVUGSDBaKpEhTbzNwHKygHtq5HM3wdD3imxKMN");
  console.log("Derived PDA:", commitmentPda);
  
  const commitInfo = await rpc.getAccountInfo(commitmentPda, { encoding: "base64" }).send();
  if (!commitInfo.value) {
    console.log("Commitment does NOT exist!");
    return;
  }
  
  const data = Buffer.from(commitInfo.value.data[0], "base64");
  const view = new DataView(data.buffer, data.byteOffset);
  
  const discriminator = data[0];
  const status = data[1];
  const hashHex = Buffer.from(data.slice(40, 72)).toString("hex");
  const storedSeq = view.getBigUint64(88, true);
  
  console.log("\nCommitment exists:");
  console.log("  Discriminator:", discriminator, "(2=COMMITMENT)");
  console.log("  Status:", status, "(0=PENDING)");
  console.log("  Sequence:", storedSeq);
  console.log("  Hash:", hashHex.slice(0, 16) + "...");
  console.log("\nExpected hash from test output: f862e298338be46b...");
}

main().catch(console.error);

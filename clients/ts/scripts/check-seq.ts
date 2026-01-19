import { address, createKeyPairSignerFromBytes, getBase58Decoder } from "@solana/kit";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRpc } from "./utils/rpc.js";
import { deriveCommitmentPda } from "../src/index.js";

const ENTROPY_PROGRAM_ID = address("GG5nqvfpYHXyMF5A5yyMYjTCKQmKTDjMheJ4iCRSvTRf");

async function main() {
  const rpc = createRpc();
  
  const keypairPath = join(homedir(), ".config", "solana", "id.json");
  const secretKey = JSON.parse(readFileSync(keypairPath, "utf-8"));
  const signer = await createKeyPairSignerFromBytes(new Uint8Array(secretKey));
  
  // Check what sequence was used in recent tests (around 1768850930025 from table_id)
  const timestamps = [
    1768850930025n, // Last table_id from test output
    1768850889257n, // Previous table_id 
  ];
  
  for (const ts of timestamps) {
    const [commitmentPda] = await deriveCommitmentPda(ENTROPY_PROGRAM_ID, signer.address, ts);
    const commitInfo = await rpc.getAccountInfo(commitmentPda, { encoding: "base64" }).send();
    console.log("Commitment at seq " + ts + ": " + (commitInfo.value ? "EXISTS" : "does not exist"));
  }
  
  // Also check what the highest existing sequence is
  // Let's binary search - timestamps are like 1768850XXXXXX
  const base = 1768850000000n;
  let found = false;
  for (let offset = 930000n; offset <= 935000n; offset += 1000n) {
    const seq = base + offset;
    const [commitmentPda] = await deriveCommitmentPda(ENTROPY_PROGRAM_ID, signer.address, seq);
    const commitInfo = await rpc.getAccountInfo(commitmentPda, { encoding: "base64" }).send();
    if (commitInfo.value) {
      found = true;
      console.log("Found commitment at seq " + seq);
    }
  }
  if (!found) {
    console.log("No commitments found in range");
  }
}

main().catch(console.error);

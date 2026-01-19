import { address, createKeyPairSignerFromBytes } from "@solana/kit";
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
  
  // Check around the table_id timestamp
  const base = 1768851117556n;
  for (let offset = -5n; offset <= 100n; offset++) {
    const seq = base + offset;
    const [commitmentPda] = await deriveCommitmentPda(ENTROPY_PROGRAM_ID, signer.address, seq);
    
    if (commitmentPda === "AVVVXYSVUGSDBaKpEhTbzNwHKygHtq5HM3wdD3imxKMN") {
      console.log("Found! Sequence = " + seq);
      
      const commitInfo = await rpc.getAccountInfo(commitmentPda, { encoding: "base64" }).send();
      if (commitInfo.value) {
        const data = Buffer.from(commitInfo.value.data[0], "base64");
        const hashHex = Buffer.from(data.slice(40, 72)).toString("hex");
        console.log("  Hash: " + hashHex.slice(0, 16) + "...");
      }
      return;
    }
  }
  console.log("Not found in range");
}

main().catch(console.error);

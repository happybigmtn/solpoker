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
  
  // Commitment struct layout:
  // [0]: discriminator (u8)
  // [1]: status (u8)
  // [2-7]: padding (6 bytes)
  // [8-39]: provider (Pubkey, 32 bytes)
  // [40-71]: hash (32 bytes)
  // [72-79]: bond_amount (u64)
  // [80-87]: commit_slot (u64)
  // [88-95]: sequence (u64)
  // [96-127]: preimage (32 bytes)
  
  for (let seq = 0; seq <= 5; seq++) {
    const sequence = BigInt(seq);
    const [commitmentPda] = await deriveCommitmentPda(ENTROPY_PROGRAM_ID, signer.address, sequence);
    
    const commitInfo = await rpc.getAccountInfo(commitmentPda, { encoding: "base64" }).send();
    if (!commitInfo.value) {
      console.log("Commitment " + seq + ": does not exist");
      continue;
    }
    
    const data = Buffer.from(commitInfo.value.data[0], "base64");
    const view = new DataView(data.buffer, data.byteOffset);
    
    const discriminator = data[0];
    const status = data[1];
    const provider = decoder.decode(data.slice(8, 40));
    const hashHex = Buffer.from(data.slice(40, 72)).toString("hex").slice(0, 16);
    const bondAmount = view.getBigUint64(72, true);
    const commitSlot = view.getBigUint64(80, true);
    const storedSeq = view.getBigUint64(88, true);
    
    console.log("Commitment " + seq + ": disc=" + discriminator + ", status=" + status + ", seq=" + storedSeq + ", slot=" + commitSlot + ", hash=" + hashHex + "...");
  }
}

main().catch(console.error);

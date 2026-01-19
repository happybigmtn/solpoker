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
  const secretKey = JSON.parse(readFileSync(keypairPath, "utf-8")) as number[];
  const signer = await createKeyPairSignerFromBytes(new Uint8Array(secretKey));
  
  // Check commitment at sequence 2 (most recent)
  const sequence = BigInt(2);
  const [commitmentPda] = await deriveCommitmentPda(ENTROPY_PROGRAM_ID, signer.address, sequence);
  
  console.log("Commitment PDA:", commitmentPda);
  
  const commitInfo = await rpc.getAccountInfo(commitmentPda, { encoding: "base64" }).send();
  if (!commitInfo.value) {
    console.log("Commitment does not exist");
    return;
  }
  
  const data = Buffer.from(commitInfo.value.data[0], "base64");
  // Commitment layout:
  // [0]: discriminator
  // [1]: status (0=PENDING, 1=REVEALED, 2=SLASHED)
  // [2..8]: padding
  // [8..40]: provider (Pubkey)
  // [40..72]: hash (32 bytes)
  // [72..104]: preimage (32 bytes, zeroed until revealed)
  // [104..112]: bond_amount (u64)
  // [112..120]: sequence (u64)
  // [120..128]: commit_slot (u64)
  // [128..136]: reveal_slot (u64, 0 if not revealed)
  
  console.log("Discriminator:", data[0], "(3=COMMITMENT)");
  console.log("Status:", data[1], "(0=PENDING, 1=REVEALED, 2=SLASHED)");
  
  const view = new DataView(data.buffer, data.byteOffset);
  const seq = view.getBigUint64(112, true);
  const commitSlot = view.getBigUint64(120, true);
  const revealSlot = view.getBigUint64(128, true);
  
  console.log("Sequence:", Number(seq));
  console.log("Commit slot:", Number(commitSlot));
  console.log("Reveal slot:", Number(revealSlot));
}

main().catch(console.error);

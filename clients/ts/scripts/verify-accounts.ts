import {
  address,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageFeePayerSigner,
  appendTransactionMessageInstruction,
  compileTransactionMessage,
  getCompiledTransactionMessageDecoder,
  pipe,
  type Address,
  type IInstruction,
} from "@solana/kit";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createRpc } from "./utils/rpc.js";

import {
  buildStartHandData,
  getStartHandAccountMetas,
  derivePokerConfigPda,
  deriveTablePda,
  deriveEntropyConfigPda,
  deriveCommitmentPda,
  deriveRequestPda,
  SYSTEM_PROGRAM_ID,
} from "../src/index.js";

const ENTROPY_PROGRAM_ID = address("GG5nqvfpYHXyMF5A5yyMYjTCKQmKTDjMheJ4iCRSvTRf");
const POKER_PROGRAM_ID = address("3oG9MCSnE7UJDQKzEoJdmHrZ3qA7Y5ADdWbYqH1KpxLv");
const SLOT_HASHES_SYSVAR = address("SysvarS1otHashes111111111111111111111111111");
const CLOCK_SYSVAR = address("SysvarC1ock11111111111111111111111111111111");

function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(data).digest());
}

function roleToNumber(role: string): 0 | 1 | 2 | 3 {
  switch (role) {
    case "writable": return 1;
    case "signer": return 2;
    case "writable_signer": return 3;
    default: return 0;
  }
}

function mapAccountMetas(metas: Array<{ address: Address; role: string }>): Array<{ address: Address; role: 0 | 1 | 2 | 3 }> {
  return metas.map((m) => ({ address: m.address, role: roleToNumber(m.role) }));
}

async function main() {
  const rpc = createRpc();
  
  const keypairPath = join(homedir(), ".config", "solana", "id.json");
  const secretKey = JSON.parse(readFileSync(keypairPath, "utf-8"));
  const signer = await createKeyPairSignerFromBytes(new Uint8Array(secretKey));
  
  const tableId = BigInt(1768851117556);
  const commitmentSequence = BigInt(1768851117557);
  
  const [tableAddress] = await deriveTablePda(POKER_PROGRAM_ID, tableId);
  const [pokerConfigPda] = await derivePokerConfigPda(POKER_PROGRAM_ID);
  const [entropyConfigPda] = await deriveEntropyConfigPda(ENTROPY_PROGRAM_ID);
  const [commitmentPda] = await deriveCommitmentPda(ENTROPY_PROGRAM_ID, signer.address, commitmentSequence);
  
  // Get commitment hash
  const commitInfo = await rpc.getAccountInfo(commitmentPda, { encoding: "base64" }).send();
  const commitData = Buffer.from(commitInfo.value!.data[0], "base64");
  const seedCommitment = new Uint8Array(commitData.slice(40, 72));
  
  // Get table hand_id
  const tableInfo = await rpc.getAccountInfo(tableAddress, { encoding: "base64" }).send();
  const tableData = Buffer.from(tableInfo.value!.data[0], "base64");
  const view = new DataView(tableData.buffer, tableData.byteOffset);
  const handId = view.getBigUint64(16, true);
  
  const [requestPda] = await deriveRequestPda(ENTROPY_PROGRAM_ID, tableAddress, handId);
  
  // Generate hole card hashes
  const holeCardHashes: Uint8Array[] = [];
  for (let i = 0; i < 10; i++) {
    const holeCardData = new Uint8Array(32);
    holeCardData[0] = i * 2;
    holeCardData[1] = i * 2 + 1;
    holeCardHashes.push(sha256(holeCardData));
  }
  
  const startHandData = buildStartHandData({ seedCommitment, holeCardHashes });
  const startHandAccounts = getStartHandAccountMetas({
    table: tableAddress,
    provider: signer.address,
    config: pokerConfigPda,
    clock: CLOCK_SYSVAR,
    entropyProgram: ENTROPY_PROGRAM_ID,
    entropyConfig: entropyConfigPda,
    entropyCommitment: commitmentPda,
    entropyRequest: requestPda,
    slotHashes: SLOT_HASHES_SYSVAR,
    systemProgram: address(SYSTEM_PROGRAM_ID),
  });
  
  console.log("Accounts for StartHand:");
  const names = ["table", "provider", "config", "clock", "entropyProgram", "entropyConfig", "entropyCommitment", "entropyRequest", "slotHashes", "systemProgram"];
  startHandAccounts.forEach((acc, i) => {
    console.log("  [" + i + "] " + names[i] + ": " + acc.address + " (" + acc.role + ")");
  });
  
  console.log("\nExpected values:");
  console.log("  slotHashes should be: SysvarS1otHashes111111111111111111111111111");
  console.log("  systemProgram should be: 11111111111111111111111111111111");
}

main().catch(console.error);

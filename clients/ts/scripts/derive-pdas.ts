/**
 * Derive config PDAs for both programs
 *
 * Usage: npx tsx scripts/derive-pdas.ts <ENTROPY_PROGRAM_ID> <POKER_PROGRAM_ID>
 *
 * Outputs JSON with both config PDAs
 */

import { address, getProgramDerivedAddress } from "@solana/kit";

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error("Usage: npx tsx scripts/derive-pdas.ts <ENTROPY_PROGRAM_ID> <POKER_PROGRAM_ID>");
    process.exit(1);
  }

  const [entropyProgramId, pokerProgramId] = args;

  const [entropyConfigPda] = await getProgramDerivedAddress({
    programAddress: address(entropyProgramId),
    seeds: [new TextEncoder().encode("config")],
  });

  const [pokerConfigPda] = await getProgramDerivedAddress({
    programAddress: address(pokerProgramId),
    seeds: [new TextEncoder().encode("config")],
  });

  // Output as JSON for easy parsing
  console.log(JSON.stringify({
    entropyConfigPda,
    pokerConfigPda,
  }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

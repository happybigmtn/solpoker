/**
 * Verify CRISPS mint and poker config setup
 *
 * Tests:
 * - AC-D3.1: CRISPS mint is created as Token-2022 with 9 decimals
 * - AC-D3.2: Mint authority is set to known keypair
 * - AC-D3.3: Test accounts can receive minted CRISPS
 * - AC-D3.4: Token-2022 metadata is initialized (name, symbol, URI)
 * - AC-D2.2: Poker config has CRISPS mint and entropy program
 *
 * Usage: npx tsx scripts/verify-crisps-setup.ts
 */

import {
  address,
  getProgramDerivedAddress,
  getBase58Decoder,
  createSolanaRpc,
  type Address,
} from "@solana/kit";
import { TOKEN_2022_PROGRAM_ADDRESS, fetchMint, isExtension } from "@solana-program/token-2022";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRpc, logRpcConfig, getRpcUrl } from "./utils/rpc.js";

// Program IDs
const ENTROPY_PROGRAM_ID = address("GG5nqvfpYHXyMF5A5yyMYjTCKQmKTDjMheJ4iCRSvTRf");
const POKER_PROGRAM_ID = address("3oG9MCSnE7UJDQKzEoJdmHrZ3qA7Y5ADdWbYqH1KpxLv");

// Expected values
const EXPECTED_DECIMALS = 9;
const EXPECTED_NAME = "Robopoker Chips";
const EXPECTED_SYMBOL = "CRISPS";
const EXPECTED_URI = "https://robopoker.dev/crisps-metadata.json";
const BASE_MINT_SIZE = 82; // Base Token-2022 mint without extensions

// Mint address file
const __dirname = dirname(fileURLToPath(import.meta.url));
const MINT_ADDRESS_FILE = join(__dirname, ".crisps-mint-address");

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
}

async function deriveConfigPda(programId: Address): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode("config")],
  });
  return pda;
}

function parseMintAccount(data: Uint8Array): {
  mintAuthorityOption: number;
  mintAuthority: string;
  supply: bigint;
  decimals: number;
  isInitialized: boolean;
  freezeAuthorityOption: number;
  freezeAuthority: string;
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = getBase58Decoder();

  return {
    mintAuthorityOption: view.getUint32(0, true),
    mintAuthority: decoder.decode(data.slice(4, 36)),
    supply: view.getBigUint64(36, true),
    decimals: data[44],
    isInitialized: data[45] === 1,
    freezeAuthorityOption: view.getUint32(46, true),
    freezeAuthority: decoder.decode(data.slice(50, 82)),
  };
}

function parsePokerConfig(data: Uint8Array): {
  discriminator: number;
  initialized: boolean;
  minPlayers: number;
  rakeBps: number;
  crispsMint: string;
  authority: string;
  entropyProgram: string;
  minBuyIn: bigint;
  maxBuyIn: bigint;
  actionTimeoutSlots: bigint;
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = getBase58Decoder();

  return {
    discriminator: data[0],
    initialized: data[1] === 1,
    minPlayers: data[2],
    rakeBps: view.getUint16(6, true),
    crispsMint: decoder.decode(data.slice(8, 40)),
    authority: decoder.decode(data.slice(40, 72)),
    entropyProgram: decoder.decode(data.slice(72, 104)),
    minBuyIn: view.getBigUint64(104, true),
    maxBuyIn: view.getBigUint64(112, true),
    actionTimeoutSlots: view.getBigUint64(120, true),
  };
}

async function main() {
  console.log("Verifying CRISPS setup on devnet...\n");
  logRpcConfig();
  console.log();

  const results: TestResult[] = [];

  // Create RPC client
  const rpc = createRpc();

  // Check if mint address file exists
  if (!existsSync(MINT_ADDRESS_FILE)) {
    console.log("ERROR: CRISPS mint not found. Run create-crisps-mint.ts first.\n");
    results.push({
      name: "AC-D3.1: CRISPS mint exists",
      passed: false,
      message: "Mint address file not found",
    });
  } else {
    const mintAddress = address(readFileSync(MINT_ADDRESS_FILE, "utf-8").trim());
    console.log(`CRISPS Mint: ${mintAddress}`);

    // Fetch mint account
    const mintInfo = await rpc.getAccountInfo(mintAddress, { encoding: "base64" }).send();

    if (!mintInfo.value) {
      results.push({
        name: "AC-D3.1: CRISPS mint exists on-chain",
        passed: false,
        message: "Mint account not found on devnet",
      });
    } else {
      const owner = mintInfo.value.owner;
      const data = Buffer.from(mintInfo.value.data[0], "base64");
      const mintData = parseMintAccount(new Uint8Array(data));

      console.log(`  Owner: ${owner}`);
      console.log(`  Decimals: ${mintData.decimals}`);
      console.log(`  Mint Authority: ${mintData.mintAuthority}`);
      console.log(`  Supply: ${mintData.supply}`);
      console.log();

      // AC-D3.1: Token-2022 mint with 9 decimals
      results.push({
        name: "AC-D3.1: Mint owner is Token-2022",
        passed: owner === TOKEN_2022_PROGRAM_ADDRESS,
        message: `Owner: ${owner} (expected: ${TOKEN_2022_PROGRAM_ADDRESS})`,
      });

      results.push({
        name: "AC-D3.1: Mint has 9 decimals",
        passed: mintData.decimals === EXPECTED_DECIMALS,
        message: `Decimals: ${mintData.decimals} (expected: ${EXPECTED_DECIMALS})`,
      });

      results.push({
        name: "AC-D3.1: Mint is initialized",
        passed: mintData.isInitialized === true,
        message: `Initialized: ${mintData.isInitialized}`,
      });

      // AC-D3.2: Mint authority is set
      results.push({
        name: "AC-D3.2: Mint authority is set",
        passed: mintData.mintAuthorityOption === 1 && mintData.mintAuthority.length >= 32,
        message: `Authority: ${mintData.mintAuthority}`,
      });

      // AC-D3.3: Test if tokens have been minted (supply > 0 indicates faucet worked)
      results.push({
        name: "AC-D3.3: Tokens have been minted (faucet used)",
        passed: mintData.supply > 0n,
        message: `Supply: ${mintData.supply} (run faucet-crisps.ts if 0)`,
      });

      // AC-D3.4: Token-2022 metadata is initialized
      // Check if account is larger than base mint (indicates extensions)
      const hasExtensions = data.length > BASE_MINT_SIZE;
      results.push({
        name: "AC-D3.4: Mint has extension data",
        passed: hasExtensions,
        message: `Account size: ${data.length} bytes (base: ${BASE_MINT_SIZE})`,
      });

      if (hasExtensions) {
        // Use fetchMint to properly decode extensions
        const kitRpc = createSolanaRpc(getRpcUrl());
        const mintAccount = await fetchMint(kitRpc, mintAddress);
        const extensions = mintAccount.data.extensions;

        if (extensions.__option === "Some") {
          // Find TokenMetadata extension
          const tokenMetadata = extensions.value.find((ext) => isExtension("TokenMetadata", ext));

          if (tokenMetadata && isExtension("TokenMetadata", tokenMetadata)) {
            console.log(`  Metadata Name: ${tokenMetadata.name}`);
            console.log(`  Metadata Symbol: ${tokenMetadata.symbol}`);
            console.log(`  Metadata URI: ${tokenMetadata.uri}`);

            results.push({
              name: "AC-D3.4: Metadata name is correct",
              passed: tokenMetadata.name === EXPECTED_NAME,
              message: `Name: "${tokenMetadata.name}" (expected: "${EXPECTED_NAME}")`,
            });

            results.push({
              name: "AC-D3.4: Metadata symbol is correct",
              passed: tokenMetadata.symbol === EXPECTED_SYMBOL,
              message: `Symbol: "${tokenMetadata.symbol}" (expected: "${EXPECTED_SYMBOL}")`,
            });

            results.push({
              name: "AC-D3.4: Metadata URI is correct",
              passed: tokenMetadata.uri === EXPECTED_URI,
              message: `URI: "${tokenMetadata.uri}" (expected: "${EXPECTED_URI}")`,
            });
          } else {
            results.push({
              name: "AC-D3.4: TokenMetadata extension present",
              passed: false,
              message: "TokenMetadata extension not found in mint account",
            });
          }
        } else {
          results.push({
            name: "AC-D3.4: TokenMetadata extension present",
            passed: false,
            message: "No extensions found in mint account",
          });
        }
      }
    }

    // Check poker config
    console.log("Checking poker config...");
    const pokerConfigPda = await deriveConfigPda(POKER_PROGRAM_ID);
    console.log(`Poker Config PDA: ${pokerConfigPda}`);

    const pokerConfigInfo = await rpc.getAccountInfo(pokerConfigPda, { encoding: "base64" }).send();

    if (!pokerConfigInfo.value) {
      results.push({
        name: "AC-D2.2: Poker config exists",
        passed: false,
        message: "Poker config not found. Run: npx tsx scripts/init-configs.ts --crisps-mint " + mintAddress,
      });
    } else {
      const data = Buffer.from(pokerConfigInfo.value.data[0], "base64");
      const pokerConfig = parsePokerConfig(new Uint8Array(data));

      console.log(`  Initialized: ${pokerConfig.initialized}`);
      console.log(`  CRISPS Mint: ${pokerConfig.crispsMint}`);
      console.log(`  Entropy Program: ${pokerConfig.entropyProgram}`);
      console.log();

      results.push({
        name: "AC-D2.2: Poker config is initialized",
        passed: pokerConfig.initialized === true,
        message: `Initialized: ${pokerConfig.initialized}`,
      });

      results.push({
        name: "AC-D2.2: Poker config has CRISPS mint",
        passed: pokerConfig.crispsMint === mintAddress,
        message: `Mint: ${pokerConfig.crispsMint} (expected: ${mintAddress})`,
      });

      results.push({
        name: "AC-D2.2: Poker config has entropy program",
        passed: pokerConfig.entropyProgram === ENTROPY_PROGRAM_ID.toString(),
        message: `Entropy: ${pokerConfig.entropyProgram} (expected: ${ENTROPY_PROGRAM_ID})`,
      });

      results.push({
        name: "AC-D2.2: Poker config has buy-in bounds",
        passed: pokerConfig.minBuyIn > 0n && pokerConfig.maxBuyIn > pokerConfig.minBuyIn,
        message: `Min: ${pokerConfig.minBuyIn}, Max: ${pokerConfig.maxBuyIn}`,
      });

      results.push({
        name: "AC-D2.2: Poker config has action timeout",
        passed: pokerConfig.actionTimeoutSlots > 0n,
        message: `Timeout: ${pokerConfig.actionTimeoutSlots} slots`,
      });
    }
  }

  // Print summary
  console.log("=".repeat(60));
  console.log("VERIFICATION RESULTS");
  console.log("=".repeat(60));

  let passed = 0;
  let failed = 0;

  for (const result of results) {
    const status = result.passed ? "✓ PASS" : "✗ FAIL";
    console.log(`${status}: ${result.name}`);
    console.log(`       ${result.message}`);
    if (result.passed) passed++;
    else failed++;
  }

  console.log();
  console.log(`Total: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

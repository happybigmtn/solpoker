#!/usr/bin/env node
/**
 * Entropy Provider CLI
 *
 * Implements AC-EP6.1, AC-EP6.2, AC-EP6.3:
 * - AC-EP6.1: Generate a new hash chain and save to file
 * - AC-EP6.2: Start the provider daemon with specified config
 * - AC-EP6.3: Report current provider status (chain position, pending ops)
 */

import { program } from "commander";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { address, createKeyPairSignerFromBytes, type Address } from "@solana/kit";

import {
  generateHashChain,
  saveHashChain,
  loadHashChain,
  DEFAULT_CHAIN_DEPTH,
  type HashChain,
} from "./hash-chain.js";
import {
  ProviderDaemon,
  loadProviderState,
  checkRpcHealth,
  type ProviderDaemonConfig,
  type DaemonStatus,
} from "./reliability.js";

program
  .name("entropy-provider")
  .description("Off-chain entropy provider daemon for robopoker")
  .version("0.1.0");

/**
 * Generate command: Create a new hash chain file
 * AC-EP6.1
 */
program
  .command("generate")
  .description("Generate a new hash chain and save to file")
  .option("-o, --output <path>", "Output file path", "chain.json")
  .option("-d, --depth <number>", "Chain depth (number of preimages)", String(DEFAULT_CHAIN_DEPTH))
  .option("-s, --seed <hex>", "Seed as hex string (random if not provided)")
  .action(async (options) => {
    const outputPath = resolve(options.output);
    const depth = parseInt(options.depth, 10);

    if (isNaN(depth) || depth < 1) {
      console.error("Error: Invalid chain depth");
      process.exit(1);
    }

    // Generate or parse seed
    let seed: Uint8Array;
    if (options.seed) {
      seed = hexToBytes(options.seed);
      if (seed.length === 0) {
        console.error("Error: Invalid seed hex string");
        process.exit(1);
      }
    } else {
      seed = randomBytes(32);
    }

    console.log(`Generating hash chain with depth ${depth}...`);
    const chain = generateHashChain(seed, depth);

    await saveHashChain(chain, outputPath);
    console.log(`Hash chain saved to ${outputPath}`);
    console.log(`Chain depth: ${chain.depth}`);
    console.log(`Current position: ${chain.position}`);
    console.log(`Remaining entries: ${chain.depth - chain.position}`);
  });

/**
 * Start command: Launch the provider daemon
 * AC-EP6.2
 */
program
  .command("start")
  .description("Start the entropy provider daemon")
  .requiredOption("-c, --chain <path>", "Path to hash chain file")
  .requiredOption("-k, --keypair <path>", "Path to provider keypair JSON file")
  .requiredOption("-p, --program <address>", "Entropy program ID")
  .option("-r, --rpc <url>", "Solana RPC URL", "https://api.devnet.solana.com")
  .option("-w, --ws <url>", "Solana WebSocket URL")
  .option("-s, --state <path>", "Path to state file", "provider-state.json")
  .option("-b, --bond <lamports>", "Minimum bond in lamports", "100000000")
  .option("--config-pda <address>", "Entropy config PDA (derived if not provided)")
  .option("-l, --log-level <level>", "Log level (debug, info, warn, error)", "warn")
  .action(async (options) => {
    const chainPath = resolve(options.chain);
    const keypairPath = resolve(options.keypair);
    const statePath = resolve(options.state);

    // Validate chain file exists
    if (!existsSync(chainPath)) {
      console.error(`Error: Chain file not found: ${chainPath}`);
      console.error("Run 'entropy-provider generate' first to create a chain file.");
      process.exit(1);
    }

    // Load keypair
    let signer;
    try {
      const keypairJson = await readFile(keypairPath, "utf-8");
      const keypairBytes = new Uint8Array(JSON.parse(keypairJson));
      signer = await createKeyPairSignerFromBytes(keypairBytes);
    } catch (error) {
      console.error(`Error: Failed to load keypair from ${keypairPath}`);
      console.error(String(error));
      process.exit(1);
    }

    // Derive WS URL from RPC URL if not provided
    const wsUrl = options.ws || options.rpc.replace("https://", "wss://").replace("http://", "ws://");

    // Derive config PDA if not provided
    const entropyProgramId = address(options.program);
    const entropyConfigPda = options.configPda
      ? address(options.configPda)
      : await deriveEntropyConfigPda(entropyProgramId);

    const rpcUrls = process.env.SOLANA_RPC_URLS
      ? process.env.SOLANA_RPC_URLS.split(",").map((url) => url.trim()).filter(Boolean)
      : undefined;

    const config: ProviderDaemonConfig = {
      rpcUrl: options.rpc,
      rpcUrls,
      wsUrl,
      entropyProgramId,
      entropyConfigPda,
      providerSigner: signer,
      minBond: BigInt(options.bond),
      chainPath,
      statePath,
      loggerConfig: {
        minLevel: options.logLevel as "debug" | "info" | "warn" | "error",
      },
    };

    // Check RPC health before starting
    console.log("Checking RPC connection...");
    const healthUrls = rpcUrls && rpcUrls.length > 0 ? [options.rpc, ...rpcUrls] : options.rpc;
    const healthy = await checkRpcHealth(healthUrls);
    if (!healthy) {
      console.error("Error: RPC endpoint is not healthy");
      process.exit(1);
    }
    console.log("RPC connection healthy");

    // Create and start daemon
    const daemon = new ProviderDaemon(config);

    console.log("Starting entropy provider daemon...");
    console.log(`Program ID: ${entropyProgramId}`);
    console.log(`Provider: ${signer.address}`);
    console.log(`Chain file: ${chainPath}`);
    console.log(`State file: ${statePath}`);

    await daemon.start();

    // Keep the process running
    console.log("Daemon running. Press Ctrl+C to stop.");
  });

/**
 * Status command: Report current provider status
 * AC-EP6.3
 */
program
  .command("status")
  .description("Report current provider status")
  .option("-c, --chain <path>", "Path to hash chain file")
  .option("-s, --state <path>", "Path to state file", "provider-state.json")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const statePath = resolve(options.state);

    // Try to load state
    const loaded = await loadProviderState(statePath);

    let chainPosition = 0;
    let chainDepth = 0;
    let pendingCount = 0;
    let lastActivity: string | null = null;

    if (loaded) {
      pendingCount = loaded.commitmentState.pending.length;

      // Read state file directly for lastActivity
      try {
        const stateContent = await readFile(statePath, "utf-8");
        const stateData = JSON.parse(stateContent);
        lastActivity = stateData.lastActivity || null;
        chainPosition = stateData.chainPosition || 0;
      } catch {
        // Ignore parse errors
      }
    }

    // If chain path provided or found in state, load chain for accurate info
    const chainPath = options.chain ? resolve(options.chain) : loaded?.chainPath;
    if (chainPath && existsSync(chainPath)) {
      try {
        const chain = await loadHashChain(chainPath);
        chainPosition = chain.position;
        chainDepth = chain.depth;
      } catch {
        // Ignore load errors
      }
    }

    const status: StatusOutput = {
      position: chainPosition,
      depth: chainDepth,
      remaining: chainDepth - chainPosition,
      pending: pendingCount,
      lastActivity,
    };

    if (options.json) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      console.log("Entropy Provider Status");
      console.log("─".repeat(30));
      console.log(`Chain position:  ${status.position}`);
      console.log(`Chain depth:     ${status.depth}`);
      console.log(`Remaining:       ${status.remaining}`);
      console.log(`Pending commits: ${status.pending}`);
      if (status.lastActivity) {
        console.log(`Last activity:   ${status.lastActivity}`);
      }
    }
  });

/**
 * Status output format for AC-EP6.3
 */
interface StatusOutput {
  position: number;
  depth: number;
  remaining: number;
  pending: number;
  lastActivity: string | null;
}

/**
 * Derive entropy config PDA
 */
async function deriveEntropyConfigPda(programId: Address): Promise<Address> {
  // Import getProgramDerivedAddress dynamically to avoid issues
  const { getProgramDerivedAddress } = await import("@solana/kit");

  const [pda] = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode("config")],
  });
  return pda;
}

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (cleanHex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(cleanHex)) {
    return new Uint8Array(0);
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Run CLI
program.parse();

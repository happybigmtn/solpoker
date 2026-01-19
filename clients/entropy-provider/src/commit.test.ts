/**
 * Commitment Posting Tests
 *
 * Tests for:
 * - AC-EP2.1: Provider posts commit TX with current chain head and required bond
 * - AC-EP2.2: Commitment TX confirms on-chain and creates valid Commitment account
 * - AC-EP2.3: Provider tracks pending commitments awaiting reveal
 *
 * These tests require a running devnet and the entropy program deployed.
 * Run `./scripts/deploy-devnet.sh` first.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  address,
  createKeyPairSignerFromBytes,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";

import { generateHashChain, getCurrentCommitment } from "./hash-chain.js";
import {
  postCommitment,
  verifyCommitmentOnChain,
  deriveCommitmentPda,
  initCommitmentState,
  type EntropyProviderConfig,
  type CommitmentState,
} from "./commit.js";

// Test configuration
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const WS_URL = process.env.SOLANA_WS_URL || "wss://api.devnet.solana.com";

// Skip tests if no devnet deployment
const SKIP_DEVNET_TESTS = process.env.SKIP_DEVNET_TESTS === "true";

describe("commitment posting", () => {
  let providerSigner: KeyPairSigner;
  let entropyProgramId: Address;
  let entropyConfigPda: Address;
  let config: EntropyProviderConfig;

  beforeAll(async () => {
    if (SKIP_DEVNET_TESTS) {
      return;
    }

    // Load keypair from default location
    const keypairPath = join(process.env.HOME || "", ".config/solana/id.json");
    let keypairBytes: Uint8Array;
    try {
      const keypairJson = await readFile(keypairPath, "utf-8");
      keypairBytes = new Uint8Array(JSON.parse(keypairJson));
    } catch {
      console.warn("No keypair found at ~/.config/solana/id.json, skipping devnet tests");
      return;
    }

    providerSigner = await createKeyPairSignerFromBytes(keypairBytes);

    // Load env file if exists
    const envPath = join(process.cwd(), "../ui/.env.local");
    try {
      const envContent = await readFile(envPath, "utf-8");
      const envVars: Record<string, string> = {};
      for (const line of envContent.split("\n")) {
        const match = line.match(/^([A-Z_]+)=(.+)$/);
        if (match) {
          envVars[match[1]] = match[2];
        }
      }

      entropyProgramId = address(envVars.NEXT_PUBLIC_ENTROPY_PROGRAM_ID || "");
      entropyConfigPda = address(envVars.NEXT_PUBLIC_ENTROPY_CONFIG_PDA || "");
    } catch {
      console.warn("No .env.local found, using hardcoded addresses");
      // Default to deployed program ID
      entropyProgramId = address("GG5nqvfpYHXyMF5A5yyMYjTCKQmKTDjMheJ4iCRSvTRf");
      // Derive config PDA
      const { getProgramDerivedAddress } = await import("@solana/kit");
      const [configPda] = await getProgramDerivedAddress({
        programAddress: entropyProgramId,
        seeds: [new TextEncoder().encode("config")],
      });
      entropyConfigPda = configPda;
    }

    // Set up provider config
    config = {
      rpcUrl: RPC_URL,
      wsUrl: WS_URL,
      entropyProgramId,
      entropyConfigPda,
      providerSigner,
      minBond: 100_000_000n, // 0.1 SOL (matches deployed config)
    };
  });

  describe("deriveCommitmentPda", () => {
    it("derives consistent PDAs for same inputs", async () => {
      const programId = address("GG5nqvfpYHXyMF5A5yyMYjTCKQmKTDjMheJ4iCRSvTRf");
      const provider = address("11111111111111111111111111111111");

      const [pda1] = await deriveCommitmentPda(programId, provider, 0n);
      const [pda2] = await deriveCommitmentPda(programId, provider, 0n);

      expect(pda1).toBe(pda2);
    });

    it("derives different PDAs for different sequences", async () => {
      const programId = address("GG5nqvfpYHXyMF5A5yyMYjTCKQmKTDjMheJ4iCRSvTRf");
      const provider = address("11111111111111111111111111111111");

      const [pda0] = await deriveCommitmentPda(programId, provider, 0n);
      const [pda1] = await deriveCommitmentPda(programId, provider, 1n);

      expect(pda0).not.toBe(pda1);
    });

    it("derives different PDAs for different providers", async () => {
      const programId = address("GG5nqvfpYHXyMF5A5yyMYjTCKQmKTDjMheJ4iCRSvTRf");
      const provider1 = address("11111111111111111111111111111111");
      // Use a different valid base58 address (Token program ID)
      const provider2 = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

      const [pda1] = await deriveCommitmentPda(programId, provider1, 0n);
      const [pda2] = await deriveCommitmentPda(programId, provider2, 0n);

      expect(pda1).not.toBe(pda2);
    });
  });

  describe("initCommitmentState", () => {
    it.skipIf(SKIP_DEVNET_TESTS)("initializes state from on-chain data", async () => {
      const state = await initCommitmentState(RPC_URL, entropyProgramId, providerSigner.address);

      expect(typeof state.nextSequence).toBe("bigint");
      expect(Array.isArray(state.pending)).toBe(true);
    });
  });

  describe("postCommitment (AC-EP2.1, AC-EP2.2)", () => {
    it.skipIf(SKIP_DEVNET_TESTS)(
      "posts commitment TX that confirms on devnet",
      async () => {
        // Generate a fresh hash chain
        const seed = randomBytes(32);
        const chain = generateHashChain(seed, 100);

        // Initialize state (find next available sequence)
        const state = await initCommitmentState(RPC_URL, entropyProgramId, providerSigner.address);

        // Post commitment
        const pending = await postCommitment(config, chain, state);

        // Verify TX confirmed
        expect(pending.signature).toBeTruthy();
        expect(pending.address).toBeTruthy();
        expect(pending.sequence).toBeGreaterThanOrEqual(0n);

        // Verify commitment hash matches chain
        const expectedHash = getCurrentCommitment(chain);
        expect(pending.hash).toEqual(expectedHash);
      },
      60_000
    );
  });

  describe("verifyCommitmentOnChain (AC-EP2.2)", () => {
    it.skipIf(SKIP_DEVNET_TESTS)(
      "verifies commitment account exists with correct hash",
      async () => {
        // Generate and post a commitment
        const seed = randomBytes(32);
        const chain = generateHashChain(seed, 100);

        const state = await initCommitmentState(RPC_URL, entropyProgramId, providerSigner.address);

        const pending = await postCommitment(config, chain, state);

        // Verify on-chain
        const verified = await verifyCommitmentOnChain(RPC_URL, pending.address, pending.hash);

        expect(verified).toBe(true);
      },
      60_000
    );

    it.skipIf(SKIP_DEVNET_TESTS)(
      "returns false for wrong hash",
      async () => {
        // Generate and post a commitment
        const seed = randomBytes(32);
        const chain = generateHashChain(seed, 100);

        const state = await initCommitmentState(RPC_URL, entropyProgramId, providerSigner.address);

        const pending = await postCommitment(config, chain, state);

        // Verify with wrong hash
        const wrongHash = randomBytes(32);
        const verified = await verifyCommitmentOnChain(RPC_URL, pending.address, new Uint8Array(wrongHash));

        expect(verified).toBe(false);
      },
      60_000
    );

    it.skipIf(SKIP_DEVNET_TESTS)("returns false for non-existent account", async () => {
      // Use a PDA that doesn't exist (very high sequence)
      const [nonExistentPda] = await deriveCommitmentPda(entropyProgramId, providerSigner.address, 999999999n);

      const verified = await verifyCommitmentOnChain(RPC_URL, nonExistentPda, new Uint8Array(32));

      expect(verified).toBe(false);
    });
  });

  describe("pending commitment tracking (AC-EP2.3)", () => {
    it.skipIf(SKIP_DEVNET_TESTS)(
      "tracks pending commitments in state",
      async () => {
        const seed = randomBytes(32);
        const chain = generateHashChain(seed, 100);

        const state = await initCommitmentState(RPC_URL, entropyProgramId, providerSigner.address);

        const initialPendingCount = state.pending.length;
        const initialSequence = state.nextSequence;

        // Post commitment
        const pending = await postCommitment(config, chain, state);

        // State should be updated
        expect(state.nextSequence).toBe(initialSequence + 1n);
        expect(state.pending.length).toBe(initialPendingCount + 1);
        expect(state.pending[state.pending.length - 1]).toEqual(pending);
      },
      60_000
    );
  });
});

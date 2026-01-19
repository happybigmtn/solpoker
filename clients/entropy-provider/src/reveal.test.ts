/**
 * Reveal Flow Tests
 *
 * Tests for:
 * - AC-EP3.1: Provider monitors target slot for each commitment
 * - AC-EP3.2: Provider reveals preimage after target slot has passed
 * - AC-EP3.3: Reveal completes before deadline slot to avoid slashing
 * - AC-EP3.4: Revealed preimage XOR slothash produces expected randomness
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

import { generateHashChain, getCurrentPreimage, verifyPreimage } from "./hash-chain.js";
import {
  postCommitment,
  initCommitmentState,
  type EntropyProviderConfig,
  type CommitmentState,
} from "./commit.js";
import {
  getCurrentSlot,
  waitForSlot,
  isWithinRevealWindow,
  revealCommitment,
  waitAndReveal,
  verifyRevealOnChain,
  deriveRandomness,
  fetchCommitmentAccount,
} from "./reveal.js";

// Test configuration
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const WS_URL = process.env.SOLANA_WS_URL || "wss://api.devnet.solana.com";

// Skip tests if no devnet deployment
const SKIP_DEVNET_TESTS = process.env.SKIP_DEVNET_TESTS === "true";

describe("reveal flow", () => {
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
      entropyProgramId = address("GG5nqvfpYHXyMF5A5yyMYjTCKQmKTDjMheJ4iCRSvTRf");
      const { getProgramDerivedAddress } = await import("@solana/kit");
      const [configPda] = await getProgramDerivedAddress({
        programAddress: entropyProgramId,
        seeds: [new TextEncoder().encode("config")],
      });
      entropyConfigPda = configPda;
    }

    config = {
      rpcUrl: RPC_URL,
      wsUrl: WS_URL,
      entropyProgramId,
      entropyConfigPda,
      providerSigner,
      minBond: 100_000_000n, // 0.1 SOL
    };
  });

  describe("getCurrentSlot", () => {
    it.skipIf(SKIP_DEVNET_TESTS)("returns current slot as bigint", async () => {
      const slot = await getCurrentSlot(RPC_URL);
      expect(typeof slot).toBe("bigint");
      expect(slot).toBeGreaterThan(0n);
    });
  });

  describe("waitForSlot (AC-EP3.1)", () => {
    it.skipIf(SKIP_DEVNET_TESTS)("returns immediately if target slot already passed", async () => {
      const currentSlot = await getCurrentSlot(RPC_URL);
      const targetSlot = currentSlot - 10n; // Past slot

      const start = Date.now();
      const resultSlot = await waitForSlot(RPC_URL, targetSlot, 100, 5000);
      const elapsed = Date.now() - start;

      expect(resultSlot).toBeGreaterThanOrEqual(currentSlot);
      expect(elapsed).toBeLessThan(1000); // Should return quickly
    });

    it.skipIf(SKIP_DEVNET_TESTS)(
      "waits for future slot",
      async () => {
        const currentSlot = await getCurrentSlot(RPC_URL);
        const targetSlot = currentSlot + 2n; // 2 slots ahead (~800ms)

        const start = Date.now();
        const resultSlot = await waitForSlot(RPC_URL, targetSlot, 200, 10000);
        const elapsed = Date.now() - start;

        expect(resultSlot).toBeGreaterThanOrEqual(targetSlot);
        // Should take roughly 800ms (2 slots * 400ms each)
        expect(elapsed).toBeGreaterThan(300);
      },
      15000
    );
  });

  describe("isWithinRevealWindow (AC-EP3.3)", () => {
    it("returns true when well within window", () => {
      expect(isWithinRevealWindow(100n, 200n, 6n)).toBe(true);
    });

    it("returns false when at deadline", () => {
      expect(isWithinRevealWindow(200n, 200n, 6n)).toBe(false);
    });

    it("returns false when too close to deadline", () => {
      expect(isWithinRevealWindow(195n, 200n, 6n)).toBe(false);
    });

    it("returns true with exactly buffer slots remaining", () => {
      // 193 + 6 = 199 < 200, so should be true
      expect(isWithinRevealWindow(193n, 200n, 6n)).toBe(true);
    });

    it("returns false with exactly buffer slots minus one", () => {
      // 194 + 6 = 200, not < 200, so should be false
      expect(isWithinRevealWindow(194n, 200n, 6n)).toBe(false);
    });
  });

  describe("deriveRandomness (AC-EP3.4)", () => {
    it("computes XOR correctly", () => {
      const preimage = new Uint8Array(32).fill(0xaa);
      const slothash = new Uint8Array(32).fill(0x55);

      const randomness = deriveRandomness(preimage, slothash);

      // 0xAA XOR 0x55 = 0xFF
      expect(randomness).toEqual(new Uint8Array(32).fill(0xff));
    });

    it("XOR with zeros returns original", () => {
      const preimage = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        preimage[i] = i;
      }
      const slothash = new Uint8Array(32).fill(0);

      const randomness = deriveRandomness(preimage, slothash);

      expect(randomness).toEqual(preimage);
    });

    it("XOR is symmetric", () => {
      const a = new Uint8Array(randomBytes(32));
      const b = new Uint8Array(randomBytes(32));

      const r1 = deriveRandomness(a, b);
      const r2 = deriveRandomness(b, a);

      expect(r1).toEqual(r2);
    });

    it("XOR is its own inverse", () => {
      const preimage = new Uint8Array(randomBytes(32));
      const slothash = new Uint8Array(randomBytes(32));

      const randomness = deriveRandomness(preimage, slothash);
      const recovered = deriveRandomness(randomness, slothash);

      expect(recovered).toEqual(preimage);
    });

    it("throws on invalid input sizes", () => {
      expect(() => deriveRandomness(new Uint8Array(31), new Uint8Array(32))).toThrow(
        "preimage and slothash must be 32 bytes each"
      );
      expect(() => deriveRandomness(new Uint8Array(32), new Uint8Array(33))).toThrow(
        "preimage and slothash must be 32 bytes each"
      );
    });
  });

  describe("revealCommitment (AC-EP3.2)", () => {
    it.skipIf(SKIP_DEVNET_TESTS)(
      "reveals commitment and updates state",
      async () => {
        // Generate hash chain and post commitment
        const seed = randomBytes(32);
        const chain = generateHashChain(seed, 100);

        const state = await initCommitmentState(RPC_URL, entropyProgramId, providerSigner.address);
        const pending = await postCommitment(config, chain, state);

        // Store the preimage before reveal (for verification)
        const preimageBeforeReveal = getCurrentPreimage(chain);
        const initialPosition = chain.position;
        const initialPendingCount = state.pending.length;

        // Reveal the commitment
        const result = await revealCommitment(config, chain, state, pending);

        // Verify result
        expect(result.signature).toBeTruthy();
        expect(result.preimage).toEqual(preimageBeforeReveal);
        expect(result.sequence).toBe(pending.sequence);
        expect(result.revealSlot).toBeGreaterThan(0n);

        // Verify chain was advanced
        expect(chain.position).toBe(initialPosition + 1);

        // Verify pending was removed from state
        expect(state.pending.length).toBe(initialPendingCount - 1);

        // Verify preimage matches commitment hash
        expect(verifyPreimage(result.preimage, pending.hash)).toBe(true);
      },
      120_000
    );
  });

  describe("verifyRevealOnChain", () => {
    it.skipIf(SKIP_DEVNET_TESTS)(
      "returns true for revealed commitment",
      async () => {
        // Post and reveal a commitment
        const seed = randomBytes(32);
        const chain = generateHashChain(seed, 100);

        const state = await initCommitmentState(RPC_URL, entropyProgramId, providerSigner.address);
        const pending = await postCommitment(config, chain, state);

        // Initially should not be revealed
        const beforeReveal = await verifyRevealOnChain(RPC_URL, pending.address);
        expect(beforeReveal).toBe(false);

        // Reveal
        await revealCommitment(config, chain, state, pending);

        // Now should be revealed
        const afterReveal = await verifyRevealOnChain(RPC_URL, pending.address);
        expect(afterReveal).toBe(true);
      },
      120_000
    );
  });

  describe("fetchCommitmentAccount", () => {
    it.skipIf(SKIP_DEVNET_TESTS)(
      "fetches commitment data correctly",
      async () => {
        // Post a commitment
        const seed = randomBytes(32);
        const chain = generateHashChain(seed, 100);

        const state = await initCommitmentState(RPC_URL, entropyProgramId, providerSigner.address);
        const pending = await postCommitment(config, chain, state);

        // Fetch account data
        const account = await fetchCommitmentAccount(RPC_URL, pending.address);

        expect(account).not.toBeNull();
        expect(account!.status).toBe(0); // PENDING
        expect(account!.hash).toEqual(pending.hash);
        expect(account!.sequence).toBe(pending.sequence);
        expect(account!.bondAmount).toBe(config.minBond);
      },
      60_000
    );

    it.skipIf(SKIP_DEVNET_TESTS)(
      "shows revealed preimage after reveal",
      async () => {
        // Post and reveal a commitment
        const seed = randomBytes(32);
        const chain = generateHashChain(seed, 100);

        const state = await initCommitmentState(RPC_URL, entropyProgramId, providerSigner.address);
        const pending = await postCommitment(config, chain, state);

        // Store preimage before reveal
        const preimageBeforeReveal = getCurrentPreimage(chain);

        // Reveal
        await revealCommitment(config, chain, state, pending);

        // Fetch account data
        const account = await fetchCommitmentAccount(RPC_URL, pending.address);

        expect(account).not.toBeNull();
        expect(account!.status).toBe(1); // REVEALED
        expect(account!.preimage).toEqual(preimageBeforeReveal);
      },
      120_000
    );
  });

  describe("waitAndReveal (AC-EP3.1, AC-EP3.2, AC-EP3.3)", () => {
    it.skipIf(SKIP_DEVNET_TESTS)(
      "waits for target slot then reveals",
      async () => {
        // Post a commitment
        const seed = randomBytes(32);
        const chain = generateHashChain(seed, 100);

        const state = await initCommitmentState(RPC_URL, entropyProgramId, providerSigner.address);
        const pending = await postCommitment(config, chain, state);

        // Get current slot and set target slightly ahead
        const currentSlot = await getCurrentSlot(RPC_URL);
        const targetSlot = currentSlot + 2n;
        const deadlineSlot = currentSlot + 100n; // Plenty of time

        // Wait and reveal
        const start = Date.now();
        const result = await waitAndReveal(config, chain, state, pending, targetSlot, deadlineSlot);
        const elapsed = Date.now() - start;

        // Should have waited for target
        expect(result.revealSlot).toBeGreaterThanOrEqual(targetSlot);

        // Should have taken some time
        expect(elapsed).toBeGreaterThan(300);

        // Verify revealed on chain
        const verified = await verifyRevealOnChain(RPC_URL, pending.address);
        expect(verified).toBe(true);
      },
      120_000
    );

    it.skipIf(SKIP_DEVNET_TESTS)(
      "throws if deadline would be missed",
      async () => {
        // Post a commitment
        const seed = randomBytes(32);
        const chain = generateHashChain(seed, 100);

        const state = await initCommitmentState(RPC_URL, entropyProgramId, providerSigner.address);
        const pending = await postCommitment(config, chain, state);

        // Get current slot
        const currentSlot = await getCurrentSlot(RPC_URL);

        // Set target in the past and deadline very close
        const targetSlot = currentSlot - 1n;
        const deadlineSlot = currentSlot + 2n; // Very close

        // Should throw because deadline is too close
        await expect(waitAndReveal(config, chain, state, pending, targetSlot, deadlineSlot)).rejects.toThrow(
          /Cannot reveal.*too close to deadline/
        );
      },
      60_000
    );
  });
});

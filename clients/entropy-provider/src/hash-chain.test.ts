/**
 * Hash Chain Tests
 *
 * Tests for:
 * - AC-EP1.1: Generated chain has correct depth
 * - AC-EP1.2: Chain loads from file and matches saved state
 * - AC-EP1.3: Hash(preimage[i]) === commitment[i-1]
 * - AC-EP1.4: Chain position advances correctly after each reveal
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sha256 } from "@noble/hashes/sha256";
import { randomBytes } from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  generateHashChain,
  loadHashChain,
  saveHashChain,
  getCurrentCommitment,
  getCurrentPreimage,
  advanceChain,
  verifyHashChain,
  verifyPreimage,
  getRemainingEntries,
  isChainExhausted,
  DEFAULT_CHAIN_DEPTH,
} from "./hash-chain.js";

describe("hash-chain", () => {
  describe("generateHashChain", () => {
    it("generates chain with correct depth (AC-EP1.1)", () => {
      const seed = randomBytes(32);
      const chain = generateHashChain(seed, 100);

      expect(chain.depth).toBe(100);
      expect(chain.preimages.length).toBe(100);
      expect(chain.position).toBe(0);
    });

    it("generates chain with default depth", () => {
      const seed = randomBytes(32);
      const chain = generateHashChain(seed);

      expect(chain.depth).toBe(DEFAULT_CHAIN_DEPTH);
      expect(chain.preimages.length).toBe(DEFAULT_CHAIN_DEPTH);
    });

    it("normalizes seed that is not 32 bytes", () => {
      const shortSeed = new Uint8Array([1, 2, 3, 4]);
      const chain = generateHashChain(shortSeed, 10);

      // Should still produce valid 32-byte preimages
      expect(chain.preimages[0].length).toBe(32);
      expect(chain.preimages[9].length).toBe(32);
    });

    it("produces deterministic chains from same seed", () => {
      const seed = new Uint8Array(32).fill(42);
      const chain1 = generateHashChain(seed, 50);
      const chain2 = generateHashChain(seed, 50);

      for (let i = 0; i < 50; i++) {
        expect(chain1.preimages[i]).toEqual(chain2.preimages[i]);
      }
    });

    it("throws for invalid depth", () => {
      const seed = randomBytes(32);
      expect(() => generateHashChain(seed, 0)).toThrow("depth must be at least 1");
      expect(() => generateHashChain(seed, -1)).toThrow("depth must be at least 1");
    });
  });

  describe("verifyHashChain (AC-EP1.3)", () => {
    it("verifies that Hash(preimage[i+1]) === preimage[i]", () => {
      const seed = randomBytes(32);
      const chain = generateHashChain(seed, 100);

      expect(verifyHashChain(chain)).toBe(true);

      // Manually verify the relationship for a few entries
      for (let i = 0; i < 10; i++) {
        const computed = sha256(chain.preimages[i + 1]);
        expect(computed).toEqual(chain.preimages[i]);
      }
    });

    it("detects corrupted chain", () => {
      const seed = randomBytes(32);
      const chain = generateHashChain(seed, 100);

      // Corrupt one preimage
      chain.preimages[50][0] ^= 0xff;

      expect(verifyHashChain(chain)).toBe(false);
    });
  });

  describe("commitment and preimage", () => {
    it("commitment is hash of current preimage", () => {
      const seed = randomBytes(32);
      const chain = generateHashChain(seed, 100);

      const commitment = getCurrentCommitment(chain);
      const preimage = getCurrentPreimage(chain);

      expect(sha256(preimage)).toEqual(commitment);
    });

    it("verifyPreimage validates commitment-preimage relationship", () => {
      const seed = randomBytes(32);
      const chain = generateHashChain(seed, 100);

      const commitment = getCurrentCommitment(chain);
      const preimage = getCurrentPreimage(chain);

      expect(verifyPreimage(preimage, commitment)).toBe(true);

      // Wrong preimage should fail
      const wrongPreimage = randomBytes(32);
      expect(verifyPreimage(wrongPreimage, commitment)).toBe(false);
    });
  });

  describe("advanceChain (AC-EP1.4)", () => {
    it("advances position correctly after reveal", () => {
      const seed = randomBytes(32);
      const chain = generateHashChain(seed, 10);

      expect(chain.position).toBe(0);
      expect(getRemainingEntries(chain)).toBe(10);

      const result = advanceChain(chain);

      expect(chain.position).toBe(1);
      expect(getRemainingEntries(chain)).toBe(9);
      expect(result.newCommitment).not.toBeNull();
    });

    it("returns consumed preimage on advance", () => {
      const seed = randomBytes(32);
      const chain = generateHashChain(seed, 10);

      const expectedPreimage = chain.preimages[0];
      const result = advanceChain(chain);

      expect(result.preimage).toEqual(expectedPreimage);
    });

    it("new commitment matches next preimage hash", () => {
      const seed = randomBytes(32);
      const chain = generateHashChain(seed, 10);

      const result = advanceChain(chain);

      // New commitment should be hash of the now-current preimage
      const currentCommitment = getCurrentCommitment(chain);
      expect(result.newCommitment).toEqual(currentCommitment);
    });

    it("returns null commitment when exhausted", () => {
      const seed = randomBytes(32);
      const chain = generateHashChain(seed, 2);

      advanceChain(chain);
      const result = advanceChain(chain);

      expect(result.newCommitment).toBeNull();
      expect(isChainExhausted(chain)).toBe(true);
    });

    it("throws when chain is exhausted", () => {
      const seed = randomBytes(32);
      const chain = generateHashChain(seed, 1);

      advanceChain(chain);

      expect(() => advanceChain(chain)).toThrow("exhausted");
      expect(() => getCurrentCommitment(chain)).toThrow("exhausted");
      expect(() => getCurrentPreimage(chain)).toThrow("exhausted");
    });
  });

  describe("save and load (AC-EP1.2)", () => {
    const testFilePath = join(tmpdir(), `test-chain-${Date.now()}.json`);

    afterEach(async () => {
      try {
        await unlink(testFilePath);
      } catch {
        // Ignore if file doesn't exist
      }
    });

    it("loads chain that matches saved state", async () => {
      const seed = randomBytes(32);
      const original = generateHashChain(seed, 50);

      // Advance a few times to test position persistence
      advanceChain(original);
      advanceChain(original);
      advanceChain(original);

      await saveHashChain(original, testFilePath);
      const loaded = await loadHashChain(testFilePath);

      expect(loaded.depth).toBe(original.depth);
      expect(loaded.position).toBe(original.position);
      expect(loaded.preimages.length).toBe(original.preimages.length);

      // Compare all preimages
      for (let i = 0; i < original.depth; i++) {
        expect(loaded.preimages[i]).toEqual(original.preimages[i]);
      }
    });

    it("loaded chain produces same commitments", async () => {
      const seed = randomBytes(32);
      const original = generateHashChain(seed, 50);

      // Get commitment before save
      const commitmentBefore = getCurrentCommitment(original);

      await saveHashChain(original, testFilePath);
      const loaded = await loadHashChain(testFilePath);

      // Get commitment after load
      const commitmentAfter = getCurrentCommitment(loaded);

      expect(commitmentAfter).toEqual(commitmentBefore);
    });

    it("loaded chain verifies correctly", async () => {
      const seed = randomBytes(32);
      const original = generateHashChain(seed, 100);

      await saveHashChain(original, testFilePath);
      const loaded = await loadHashChain(testFilePath);

      expect(verifyHashChain(loaded)).toBe(true);
    });

    it("preserves position through save/load cycle", async () => {
      const seed = randomBytes(32);
      const chain = generateHashChain(seed, 20);

      // Advance to position 5
      for (let i = 0; i < 5; i++) {
        advanceChain(chain);
      }
      expect(chain.position).toBe(5);

      await saveHashChain(chain, testFilePath);
      const loaded = await loadHashChain(testFilePath);

      expect(loaded.position).toBe(5);
      expect(getRemainingEntries(loaded)).toBe(15);
    });

    it("throws for invalid file version", async () => {
      const invalidContent = JSON.stringify({
        version: 999,
        depth: 10,
        position: 0,
        preimages: [],
      });

      const invalidPath = join(tmpdir(), `invalid-chain-${Date.now()}.json`);
      const { writeFile } = await import("node:fs/promises");
      await writeFile(invalidPath, invalidContent);

      await expect(loadHashChain(invalidPath)).rejects.toThrow("Unsupported hash chain file version");

      await unlink(invalidPath);
    });
  });

  describe("end-to-end commit-reveal workflow", () => {
    it("simulates full commit-reveal cycle", () => {
      const seed = randomBytes(32);
      const chain = generateHashChain(seed, 5);

      // Simulate 5 commit-reveal cycles
      for (let round = 0; round < 5; round++) {
        // 1. Provider gets commitment
        const commitment = getCurrentCommitment(chain);

        // 2. Commitment is posted on-chain (simulated)
        // ...

        // 3. After target slot, provider reveals preimage
        const preimage = getCurrentPreimage(chain);

        // 4. Verifier checks preimage matches commitment
        expect(verifyPreimage(preimage, commitment)).toBe(true);

        // 5. Advance chain for next round
        advanceChain(chain);
      }

      expect(isChainExhausted(chain)).toBe(true);
    });
  });
});

/**
 * Tests for entropy instruction builders (AC-8.3)
 *
 * Verifies that generated instruction data matches the expected byte layouts
 * defined in the Rust entropy program.
 */

import { describe, it, expect } from "vitest";
import { address } from "@solana/kit";
import {
  buildEntropyInitializeData,
  buildEntropyCommitData,
  buildEntropyRevealData,
  buildEntropyRequestData,
  buildEntropyFinalizeData,
  buildEntropySlashData,
  buildEntropyUpdateConfigData,
  getEntropyInitializeAccountMetas,
  getEntropyCommitAccountMetas,
  getEntropyRevealAccountMetas,
} from "./entropy.js";
import { ENTROPY_DISCRIMINATOR } from "../constants.js";

describe("Entropy instruction builders", () => {
  describe("buildEntropyInitializeData", () => {
    it("should build correct byte layout", () => {
      const data = buildEntropyInitializeData({
        minBond: 1000000n,
        revealWindowSlots: 100n,
        slashBasisPoints: 5000n,
      });

      expect(data.length).toBe(32);
      expect(data[0]).toBe(ENTROPY_DISCRIMINATOR.INITIALIZE);

      const view = new DataView(data.buffer);
      expect(view.getBigUint64(8, true)).toBe(1000000n);
      expect(view.getBigUint64(16, true)).toBe(100n);
      expect(view.getBigUint64(24, true)).toBe(5000n);
    });
  });

  describe("buildEntropyCommitData", () => {
    it("should build correct byte layout", () => {
      const hash = new Uint8Array(32).fill(0xcc);

      const data = buildEntropyCommitData({
        hash,
        sequence: 42n,
        bondAmount: 500000n,
      });

      expect(data.length).toBe(56);
      expect(data[0]).toBe(ENTROPY_DISCRIMINATOR.COMMIT);

      // Check hash at offset 8
      expect(data.slice(8, 40)).toEqual(hash);

      const view = new DataView(data.buffer);
      expect(view.getBigUint64(40, true)).toBe(42n);
      expect(view.getBigUint64(48, true)).toBe(500000n);
    });

    it("should throw on invalid hash length", () => {
      expect(() =>
        buildEntropyCommitData({
          hash: new Uint8Array(16),
          sequence: 1n,
          bondAmount: 1000n,
        })
      ).toThrow("hash must be 32 bytes");
    });
  });

  describe("buildEntropyRevealData", () => {
    it("should build correct byte layout", () => {
      const preimage = new Uint8Array(32).fill(0xdd);

      const data = buildEntropyRevealData({ preimage });

      expect(data.length).toBe(40);
      expect(data[0]).toBe(ENTROPY_DISCRIMINATOR.REVEAL);

      // Check preimage at offset 8
      expect(data.slice(8, 40)).toEqual(preimage);
    });

    it("should throw on invalid preimage length", () => {
      expect(() =>
        buildEntropyRevealData({ preimage: new Uint8Array(31) })
      ).toThrow("preimage must be 32 bytes");
    });
  });

  describe("buildEntropyRequestData", () => {
    it("should build correct byte layout", () => {
      const data = buildEntropyRequestData({ requestId: 12345n });

      expect(data.length).toBe(16);
      expect(data[0]).toBe(ENTROPY_DISCRIMINATOR.REQUEST);

      const view = new DataView(data.buffer);
      expect(view.getBigUint64(8, true)).toBe(12345n);
    });
  });

  describe("buildEntropyFinalizeData", () => {
    it("should build correct byte layout", () => {
      const data = buildEntropyFinalizeData();

      expect(data.length).toBe(1);
      expect(data[0]).toBe(ENTROPY_DISCRIMINATOR.FINALIZE);
    });
  });

  describe("buildEntropySlashData", () => {
    it("should build correct byte layout", () => {
      const data = buildEntropySlashData();

      expect(data.length).toBe(1);
      expect(data[0]).toBe(ENTROPY_DISCRIMINATOR.SLASH);
    });
  });

  describe("buildEntropyUpdateConfigData", () => {
    it("should build correct byte layout", () => {
      const newProvider = new Uint8Array(32).fill(0xee);

      const data = buildEntropyUpdateConfigData({
        newProvider,
        newMinBond: 2000000n,
        newRevealWindowSlots: 200n,
        newSlashBasisPoints: 7500n,
      });

      expect(data.length).toBe(64);
      expect(data[0]).toBe(ENTROPY_DISCRIMINATOR.UPDATE_CONFIG);

      // Check newProvider at offset 8
      expect(data.slice(8, 40)).toEqual(newProvider);

      const view = new DataView(data.buffer);
      expect(view.getBigUint64(40, true)).toBe(2000000n);
      expect(view.getBigUint64(48, true)).toBe(200n);
      expect(view.getBigUint64(56, true)).toBe(7500n);
    });

    it("should throw on invalid newProvider length", () => {
      expect(() =>
        buildEntropyUpdateConfigData({
          newProvider: new Uint8Array(16),
          newMinBond: 0n,
          newRevealWindowSlots: 0n,
          newSlashBasisPoints: 0n,
        })
      ).toThrow("newProvider must be 32 bytes");
    });
  });
});

describe("Entropy account meta builders", () => {
  const testAddress = address("11111111111111111111111111111111");

  describe("getEntropyInitializeAccountMetas", () => {
    it("should return correct account structure", () => {
      const metas = getEntropyInitializeAccountMetas({
        config: testAddress,
        authority: testAddress,
        provider: testAddress,
        systemProgram: testAddress,
      });

      expect(metas).toHaveLength(4);
      expect(metas[0].role).toBe("writable");
      expect(metas[1].role).toBe("signer");
      expect(metas[2].role).toBe("readonly");
      expect(metas[3].role).toBe("readonly");
    });
  });

  describe("getEntropyCommitAccountMetas", () => {
    it("should return correct account structure", () => {
      const metas = getEntropyCommitAccountMetas({
        commitment: testAddress,
        provider: testAddress,
        config: testAddress,
        systemProgram: testAddress,
      });

      expect(metas).toHaveLength(4);
      expect(metas[0].role).toBe("writable");
      expect(metas[1].role).toBe("writable_signer");
      expect(metas[2].role).toBe("readonly");
    });
  });

  describe("getEntropyRevealAccountMetas", () => {
    it("should return correct account structure", () => {
      const metas = getEntropyRevealAccountMetas({
        commitment: testAddress,
        provider: testAddress,
        config: testAddress,
      });

      expect(metas).toHaveLength(3);
      expect(metas[0].role).toBe("writable");
      expect(metas[1].role).toBe("signer");
      expect(metas[2].role).toBe("readonly");
    });
  });
});

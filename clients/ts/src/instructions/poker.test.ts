/**
 * Tests for poker instruction builders (AC-8.3)
 *
 * Verifies that generated instruction data matches the expected byte layouts
 * defined in the Rust program.
 */

import { describe, it, expect } from "vitest";
import { address } from "@solana/kit";
import {
  buildInitializeData,
  buildCreateTableData,
  buildJoinTableData,
  buildLeaveTableData,
  buildStartHandData,
  buildTimeoutActionData,
  buildPlayerActionData,
  buildSettleData,
  buildRevealSeedData,
  buildInitStakingPoolData,
  buildDepositStakeData,
  buildWithdrawStakeData,
  buildClaimRewardsData,
  buildSweepRakeData,
  getInitializeAccountMetas,
  getCreateTableAccountMetas,
  getJoinTableAccountMetas,
  getPlayerActionAccountMetas,
  ACTION_TYPE,
} from "./poker.js";
import { POKER_DISCRIMINATOR } from "../constants.js";

describe("Poker instruction builders", () => {
  describe("buildInitializeData", () => {
    it("should build correct byte layout", () => {
      const data = buildInitializeData({
        minPlayers: 2,
        minBuyIn: 1000n,
        maxBuyIn: 10000n,
        actionTimeoutSlots: 50n,
      });

      expect(data.length).toBe(32);
      expect(data[0]).toBe(POKER_DISCRIMINATOR.INITIALIZE);
      expect(data[1]).toBe(2); // minPlayers

      // Check minBuyIn at offset 8 (little-endian)
      const view = new DataView(data.buffer);
      expect(view.getBigUint64(8, true)).toBe(1000n);
      expect(view.getBigUint64(16, true)).toBe(10000n);
      expect(view.getBigUint64(24, true)).toBe(50n);
    });
  });

  describe("buildCreateTableData", () => {
    it("should build correct byte layout", () => {
      const data = buildCreateTableData({
        tableId: 12345n,
        smallBlind: 5n,
        bigBlind: 10n,
      });

      expect(data.length).toBe(32);
      expect(data[0]).toBe(POKER_DISCRIMINATOR.CREATE_TABLE);

      const view = new DataView(data.buffer);
      expect(view.getBigUint64(8, true)).toBe(12345n);
      expect(view.getBigUint64(16, true)).toBe(5n);
      expect(view.getBigUint64(24, true)).toBe(10n);
    });
  });

  describe("buildJoinTableData", () => {
    it("should build correct byte layout", () => {
      const data = buildJoinTableData({
        buyInAmount: 5000n,
      });

      expect(data.length).toBe(16);
      expect(data[0]).toBe(POKER_DISCRIMINATOR.JOIN_TABLE);

      const view = new DataView(data.buffer);
      expect(view.getBigUint64(8, true)).toBe(5000n);
    });
  });

  describe("buildLeaveTableData", () => {
    it("should build correct byte layout", () => {
      const data = buildLeaveTableData();

      expect(data.length).toBe(1);
      expect(data[0]).toBe(POKER_DISCRIMINATOR.LEAVE_TABLE);
    });
  });

  describe("buildStartHandData", () => {
    it("should build correct byte layout", () => {
      const seedCommitment = new Uint8Array(32).fill(0xaa);
      const holeCardHashes = Array.from({ length: 10 }, (_, i) =>
        new Uint8Array(32).fill(i)
      );

      const data = buildStartHandData({ seedCommitment, holeCardHashes });

      expect(data.length).toBe(360);
      expect(data[0]).toBe(POKER_DISCRIMINATOR.START_HAND);

      // Check seed commitment at offset 8
      expect(data.slice(8, 40)).toEqual(seedCommitment);

      // Check each hole card hash
      for (let i = 0; i < 10; i++) {
        expect(data.slice(40 + i * 32, 40 + (i + 1) * 32)).toEqual(holeCardHashes[i]);
      }
    });

    it("should throw on invalid seedCommitment length", () => {
      expect(() =>
        buildStartHandData({
          seedCommitment: new Uint8Array(16),
          holeCardHashes: Array.from({ length: 10 }, () => new Uint8Array(32)),
        })
      ).toThrow("seedCommitment must be 32 bytes");
    });

    it("should throw on invalid holeCardHashes count", () => {
      expect(() =>
        buildStartHandData({
          seedCommitment: new Uint8Array(32),
          holeCardHashes: Array.from({ length: 5 }, () => new Uint8Array(32)),
        })
      ).toThrow("holeCardHashes must have exactly 10 entries");
    });
  });

  describe("buildTimeoutActionData", () => {
    it("should build correct byte layout", () => {
      const data = buildTimeoutActionData();

      expect(data.length).toBe(1);
      expect(data[0]).toBe(POKER_DISCRIMINATOR.TIMEOUT_ACTION);
    });
  });

  describe("buildPlayerActionData", () => {
    it("should build fold action", () => {
      const data = buildPlayerActionData({
        actionType: ACTION_TYPE.FOLD,
        amount: 0n,
      });

      expect(data.length).toBe(16);
      expect(data[0]).toBe(POKER_DISCRIMINATOR.PLAYER_ACTION);
      expect(data[1]).toBe(ACTION_TYPE.FOLD);
    });

    it("should build raise action with amount", () => {
      const data = buildPlayerActionData({
        actionType: ACTION_TYPE.RAISE,
        amount: 500n,
      });

      expect(data.length).toBe(16);
      expect(data[0]).toBe(POKER_DISCRIMINATOR.PLAYER_ACTION);
      expect(data[1]).toBe(ACTION_TYPE.RAISE);

      const view = new DataView(data.buffer);
      expect(view.getBigUint64(8, true)).toBe(500n);
    });

    it("should build all-in action", () => {
      const data = buildPlayerActionData({
        actionType: ACTION_TYPE.ALL_IN,
        amount: 0n,
      });

      expect(data[0]).toBe(POKER_DISCRIMINATOR.PLAYER_ACTION);
      expect(data[1]).toBe(ACTION_TYPE.ALL_IN);
    });
  });

  describe("buildSettleData", () => {
    it("should build correct byte layout", () => {
      const data = buildSettleData({});

      expect(data.length).toBe(1);
      expect(data[0]).toBe(POKER_DISCRIMINATOR.SETTLE);
    });
  });

  describe("buildRevealSeedData", () => {
    it("should build correct byte layout", () => {
      const seed = new Uint8Array(32).fill(0xbb);
      const revealedHoleCards: Array<[number, number]> = Array.from(
        { length: 10 },
        (_, i) => [i * 2, i * 2 + 1] as [number, number]
      );

      const data = buildRevealSeedData({ seed, revealedHoleCards });

      expect(data.length).toBe(60);
      expect(data[0]).toBe(POKER_DISCRIMINATOR.REVEAL_SEED);

      // Check seed at offset 8
      expect(data.slice(8, 40)).toEqual(seed);

      // Check revealed hole cards at offset 40
      for (let i = 0; i < 10; i++) {
        expect(data[40 + i * 2]).toBe(revealedHoleCards[i][0]);
        expect(data[40 + i * 2 + 1]).toBe(revealedHoleCards[i][1]);
      }
    });
  });

  describe("buildInitStakingPoolData", () => {
    it("should build correct byte layout", () => {
      const data = buildInitStakingPoolData();

      expect(data.length).toBe(1);
      expect(data[0]).toBe(POKER_DISCRIMINATOR.INIT_STAKING_POOL);
    });
  });

  describe("buildDepositStakeData", () => {
    it("should build correct byte layout", () => {
      const data = buildDepositStakeData({ amount: 10000n });

      expect(data.length).toBe(16);
      expect(data[0]).toBe(POKER_DISCRIMINATOR.DEPOSIT_STAKE);

      const view = new DataView(data.buffer);
      expect(view.getBigUint64(8, true)).toBe(10000n);
    });
  });

  describe("buildWithdrawStakeData", () => {
    it("should build correct byte layout", () => {
      const data = buildWithdrawStakeData({ amount: 5000n });

      expect(data.length).toBe(16);
      expect(data[0]).toBe(POKER_DISCRIMINATOR.WITHDRAW_STAKE);

      const view = new DataView(data.buffer);
      expect(view.getBigUint64(8, true)).toBe(5000n);
    });
  });

  describe("buildClaimRewardsData", () => {
    it("should build correct byte layout", () => {
      const data = buildClaimRewardsData();

      expect(data.length).toBe(1);
      expect(data[0]).toBe(POKER_DISCRIMINATOR.CLAIM_REWARDS);
    });
  });

  describe("buildSweepRakeData", () => {
    it("should build correct byte layout", () => {
      const data = buildSweepRakeData();

      expect(data.length).toBe(1);
      expect(data[0]).toBe(POKER_DISCRIMINATOR.SWEEP_RAKE);
    });
  });
});

describe("Account meta builders", () => {
  const testAddress = address("11111111111111111111111111111111");

  describe("getInitializeAccountMetas", () => {
    it("should return correct account structure", () => {
      const metas = getInitializeAccountMetas({
        config: testAddress,
        authority: testAddress,
        crispsMint: testAddress,
        entropyProgram: testAddress,
        systemProgram: testAddress,
      });

      expect(metas).toHaveLength(5);
      expect(metas[0].role).toBe("writable");
      expect(metas[1].role).toBe("writable_signer");
      expect(metas[2].role).toBe("readonly");
    });
  });

  describe("getCreateTableAccountMetas", () => {
    it("should return correct account structure", () => {
      const metas = getCreateTableAccountMetas({
        table: testAddress,
        vault: testAddress,
        payer: testAddress,
        config: testAddress,
        crispsMint: testAddress,
        tokenProgram: testAddress,
        systemProgram: testAddress,
      });

      expect(metas).toHaveLength(7);
      expect(metas[0].role).toBe("writable"); // table
      expect(metas[1].role).toBe("writable"); // vault
      expect(metas[2].role).toBe("writable_signer"); // payer
    });
  });

  describe("getJoinTableAccountMetas", () => {
    it("should return correct account structure", () => {
      const metas = getJoinTableAccountMetas({
        table: testAddress,
        vault: testAddress,
        playerTokenAccount: testAddress,
        player: testAddress,
        config: testAddress,
        tokenProgram: testAddress,
      });

      expect(metas).toHaveLength(6);
      expect(metas[3].role).toBe("signer"); // player
    });
  });

  describe("getPlayerActionAccountMetas", () => {
    it("should return correct account structure", () => {
      const metas = getPlayerActionAccountMetas({
        table: testAddress,
        player: testAddress,
        config: testAddress,
        clock: testAddress,
      });

      expect(metas).toHaveLength(4);
      expect(metas[0].role).toBe("writable"); // table
      expect(metas[1].role).toBe("signer"); // player
      expect(metas[2].role).toBe("readonly"); // config
      expect(metas[3].role).toBe("readonly"); // clock
    });
  });
});

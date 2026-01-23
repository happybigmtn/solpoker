/**
 * SDK smoke tests for core instruction flows (AC-POK8.3)
 *
 * Verifies that the typed SDK can build valid instructions for complete game flows.
 * These tests demonstrate the SDK can construct proper instruction data and account
 * metas for the core poker lifecycle: join → action → leave.
 */

import { describe, it, expect } from "vitest";
import { address } from "@solana/kit";
import {
  // Instruction builders
  buildInitializeData,
  buildCreateTableData,
  buildJoinTableData,
  buildLeaveTableData,
  buildPlayerActionData,
  buildSettleData,
  buildInitStakingPoolData,
  buildDepositStakeData,
  buildWithdrawStakeData,
  buildClaimRewardsData,
  buildSweepRakeData,
  // Account meta builders
  getInitializeAccountMetas,
  getCreateTableAccountMetas,
  getJoinTableAccountMetas,
  getLeaveTableAccountMetas,
  getPlayerActionAccountMetas,
  getSettleAccountMetas,
  getInitStakingPoolAccountMetas,
  getDepositStakeAccountMetas,
  getWithdrawStakeAccountMetas,
  getClaimRewardsAccountMetas,
  getSweepRakeAccountMetas,
  // Constants
  ACTION_TYPE,
  POKER_DISCRIMINATOR,
  // PDA derivation
  derivePokerConfigPda,
  deriveTablePda,
  deriveVaultPda,
  deriveStakingPoolPda,
  deriveStakeVaultPda,
  deriveRewardsVaultPda,
  deriveStakerPositionPda,
} from "./index.js";

// Test addresses (using real program IDs and valid keypair pubkeys)
const POKER_PROGRAM = address("3oG9MCSnE7UJDQKzEoJdmHrZ3qA7Y5ADdWbYqH1KpxLv");
const ENTROPY_PROGRAM = address("GG5nqvfpYHXyMF5A5yyMYjTCKQmKTDjMheJ4iCRSvTRf");
const TOKEN_2022 = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
const CLOCK_SYSVAR = address("SysvarC1ock11111111111111111111111111111111");
// Valid keypair pubkeys for test accounts
const CRISPS_MINT = address("H23jVpt1CPdGSoHPb3mE8nxsWYbWrZMCgkLT1qLGAJMG");
const AUTHORITY = address("H23jVpt1CPdGSoHPb3mE8nxsWYbWrZMCgkLT1qLGAJMG");
const PLAYER = address("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");
const PLAYER_TOKEN = address("H23jVpt1CPdGSoHPb3mE8nxsWYbWrZMCgkLT1qLGAJMG");

describe("SDK Core Flow Smoke Tests (AC-POK8.3)", () => {
  describe("Program Initialization Flow", () => {
    it("can build complete initialization transaction components", async () => {
      // Derive config PDA
      const [configPda] = await derivePokerConfigPda(POKER_PROGRAM);

      // Build instruction data
      const data = buildInitializeData({
        minPlayers: 2,
        minBuyIn: 100_000_000n, // 0.1 CRISPS (9 decimals)
        maxBuyIn: 10_000_000_000n, // 10 CRISPS
        actionTimeoutSlots: 100n,
      });

      // Build account metas
      const accounts = getInitializeAccountMetas({
        config: configPda,
        authority: AUTHORITY,
        crispsMint: CRISPS_MINT,
        entropyProgram: ENTROPY_PROGRAM,
        systemProgram: SYSTEM_PROGRAM,
      });

      // Verify structure
      expect(data[0]).toBe(POKER_DISCRIMINATOR.INITIALIZE);
      expect(data.length).toBe(32);
      expect(accounts.length).toBe(5);
      expect(accounts[0].address).toBe(configPda);
      expect(accounts[1].role).toBe("writable_signer"); // authority must sign
    });
  });

  describe("Table Lifecycle Flow", () => {
    it("can build create table transaction components", async () => {
      const tableId = 12345n;

      // Derive PDAs
      const [tablePda] = await deriveTablePda(POKER_PROGRAM, tableId);
      const [vaultPda] = await deriveVaultPda(POKER_PROGRAM, tableId);
      const [configPda] = await derivePokerConfigPda(POKER_PROGRAM);

      // Build instruction data
      const data = buildCreateTableData({
        tableId,
        smallBlind: 50_000_000n, // 0.05 CRISPS
        bigBlind: 100_000_000n, // 0.1 CRISPS
      });

      // Build account metas
      const accounts = getCreateTableAccountMetas({
        table: tablePda,
        vault: vaultPda,
        payer: AUTHORITY,
        config: configPda,
        crispsMint: CRISPS_MINT,
        tokenProgram: TOKEN_2022,
        systemProgram: SYSTEM_PROGRAM,
      });

      // Verify structure
      expect(data[0]).toBe(POKER_DISCRIMINATOR.CREATE_TABLE);
      expect(data.length).toBe(32);
      expect(accounts.length).toBe(7);
      expect(accounts[0].address).toBe(tablePda);
      expect(accounts[0].role).toBe("writable");
      expect(accounts[1].address).toBe(vaultPda);
    });

    it("can build join table transaction components", async () => {
      const tableId = 12345n;
      const buyIn = 500_000_000n; // 0.5 CRISPS

      // Derive PDAs
      const [tablePda] = await deriveTablePda(POKER_PROGRAM, tableId);
      const [vaultPda] = await deriveVaultPda(POKER_PROGRAM, tableId);
      const [configPda] = await derivePokerConfigPda(POKER_PROGRAM);

      // Build instruction data
      const data = buildJoinTableData({ buyInAmount: buyIn });

      // Build account metas
      const accounts = getJoinTableAccountMetas({
        table: tablePda,
        vault: vaultPda,
        playerTokenAccount: PLAYER_TOKEN,
        player: PLAYER,
        config: configPda,
        tokenProgram: TOKEN_2022,
      });

      // Verify structure
      expect(data[0]).toBe(POKER_DISCRIMINATOR.JOIN_TABLE);
      expect(data.length).toBe(16);
      expect(accounts.length).toBe(6);
      expect(accounts[3].role).toBe("signer"); // player must sign
    });

    it("can build leave table transaction components", async () => {
      const tableId = 12345n;

      // Derive PDAs
      const [tablePda] = await deriveTablePda(POKER_PROGRAM, tableId);
      const [vaultPda] = await deriveVaultPda(POKER_PROGRAM, tableId);
      const [configPda] = await derivePokerConfigPda(POKER_PROGRAM);

      // Build instruction data
      const data = buildLeaveTableData();

      // Build account metas
      const accounts = getLeaveTableAccountMetas({
        table: tablePda,
        vault: vaultPda,
        playerTokenAccount: PLAYER_TOKEN,
        player: PLAYER,
        config: configPda,
        tokenProgram: TOKEN_2022,
      });

      // Verify structure
      expect(data[0]).toBe(POKER_DISCRIMINATOR.LEAVE_TABLE);
      expect(data.length).toBe(1);
      expect(accounts.length).toBe(6);
    });
  });

  describe("Betting Action Flow", () => {
    it("can build all player action types", async () => {
      const tableId = 12345n;
      const [tablePda] = await deriveTablePda(POKER_PROGRAM, tableId);
      const [configPda] = await derivePokerConfigPda(POKER_PROGRAM);

      const actionCases = [
        { type: ACTION_TYPE.FOLD, amount: 0n, name: "fold" },
        { type: ACTION_TYPE.CHECK, amount: 0n, name: "check" },
        { type: ACTION_TYPE.CALL, amount: 0n, name: "call" },
        { type: ACTION_TYPE.RAISE, amount: 200_000_000n, name: "raise" },
        { type: ACTION_TYPE.ALL_IN, amount: 0n, name: "all-in" },
      ];

      for (const action of actionCases) {
        const data = buildPlayerActionData({
          actionType: action.type,
          amount: action.amount,
        });

        const accounts = getPlayerActionAccountMetas({
          table: tablePda,
          player: PLAYER,
          config: configPda,
          clock: CLOCK_SYSVAR,
        });

        expect(data[0]).toBe(POKER_DISCRIMINATOR.PLAYER_ACTION);
        expect(data[1]).toBe(action.type);
        expect(data.length).toBe(16);
        expect(accounts.length).toBe(4);
        expect(accounts[1].role).toBe("signer"); // player must sign
      }
    });
  });

  describe("Settlement Flow", () => {
    it("can build settle transaction components", async () => {
      const tableId = 12345n;
      const [tablePda] = await deriveTablePda(POKER_PROGRAM, tableId);
      const [configPda] = await derivePokerConfigPda(POKER_PROGRAM);

      const data = buildSettleData({});
      const accounts = getSettleAccountMetas({
        table: tablePda,
        config: configPda,
      });

      expect(data[0]).toBe(POKER_DISCRIMINATOR.SETTLE);
      expect(data.length).toBe(1);
      expect(accounts.length).toBe(2);
    });
  });

  describe("Staking Flow", () => {
    it("can build complete staking lifecycle", async () => {
      const [configPda] = await derivePokerConfigPda(POKER_PROGRAM);
      const [stakingPoolPda] = await deriveStakingPoolPda(POKER_PROGRAM);
      const [stakeVaultPda] = await deriveStakeVaultPda(POKER_PROGRAM);
      const [rewardsVaultPda] = await deriveRewardsVaultPda(POKER_PROGRAM);
      const [stakerPositionPda] = await deriveStakerPositionPda(POKER_PROGRAM, PLAYER);

      // Init staking pool
      const initData = buildInitStakingPoolData();
      const initAccounts = getInitStakingPoolAccountMetas({
        stakingPool: stakingPoolPda,
        stakeVault: stakeVaultPda,
        rewardsVault: rewardsVaultPda,
        payer: AUTHORITY,
        config: configPda,
        crispsMint: CRISPS_MINT,
        tokenProgram: TOKEN_2022,
        systemProgram: SYSTEM_PROGRAM,
      });
      expect(initData[0]).toBe(POKER_DISCRIMINATOR.INIT_STAKING_POOL);
      expect(initAccounts.length).toBe(8);

      // Deposit stake
      const depositData = buildDepositStakeData({ amount: 1_000_000_000n });
      const depositAccounts = getDepositStakeAccountMetas({
        stakingPool: stakingPoolPda,
        stakerPosition: stakerPositionPda,
        stakeVault: stakeVaultPda,
        stakerTokenAccount: PLAYER_TOKEN,
        staker: PLAYER,
        config: configPda,
        tokenProgram: TOKEN_2022,
        systemProgram: SYSTEM_PROGRAM,
      });
      expect(depositData[0]).toBe(POKER_DISCRIMINATOR.DEPOSIT_STAKE);
      expect(depositAccounts.length).toBe(8);

      // Claim rewards
      const claimData = buildClaimRewardsData();
      const claimAccounts = getClaimRewardsAccountMetas({
        stakingPool: stakingPoolPda,
        stakerPosition: stakerPositionPda,
        rewardsVault: rewardsVaultPda,
        stakerTokenAccount: PLAYER_TOKEN,
        staker: PLAYER,
        config: configPda,
        tokenProgram: TOKEN_2022,
      });
      expect(claimData[0]).toBe(POKER_DISCRIMINATOR.CLAIM_REWARDS);
      expect(claimAccounts.length).toBe(7);

      // Withdraw stake
      const withdrawData = buildWithdrawStakeData({ amount: 500_000_000n });
      const withdrawAccounts = getWithdrawStakeAccountMetas({
        stakingPool: stakingPoolPda,
        stakerPosition: stakerPositionPda,
        stakeVault: stakeVaultPda,
        stakerTokenAccount: PLAYER_TOKEN,
        staker: PLAYER,
        config: configPda,
        tokenProgram: TOKEN_2022,
      });
      expect(withdrawData[0]).toBe(POKER_DISCRIMINATOR.WITHDRAW_STAKE);
      expect(withdrawAccounts.length).toBe(7);
    });
  });

  describe("Rake Flow", () => {
    it("can build sweep rake transaction components", async () => {
      const tableId = 12345n;
      const [tablePda] = await deriveTablePda(POKER_PROGRAM, tableId);
      const [vaultPda] = await deriveVaultPda(POKER_PROGRAM, tableId);
      const [configPda] = await derivePokerConfigPda(POKER_PROGRAM);
      const [stakingPoolPda] = await deriveStakingPoolPda(POKER_PROGRAM);
      const [rewardsVaultPda] = await deriveRewardsVaultPda(POKER_PROGRAM);

      const data = buildSweepRakeData();
      const accounts = getSweepRakeAccountMetas({
        table: tablePda,
        tableVault: vaultPda,
        stakingPool: stakingPoolPda,
        rewardsVault: rewardsVaultPda,
        config: configPda,
        tokenProgram: TOKEN_2022,
      });

      expect(data[0]).toBe(POKER_DISCRIMINATOR.SWEEP_RAKE);
      expect(data.length).toBe(1);
      expect(accounts.length).toBe(6);
    });
  });

  describe("Complete Game Session (Integration)", () => {
    it("can build all instructions for a complete poker session", async () => {
      const tableId = 999n;

      // 1. Derive all needed PDAs
      const [configPda] = await derivePokerConfigPda(POKER_PROGRAM);
      const [tablePda] = await deriveTablePda(POKER_PROGRAM, tableId);
      const [vaultPda] = await deriveVaultPda(POKER_PROGRAM, tableId);

      // 2. Create table
      const createTableData = buildCreateTableData({
        tableId,
        smallBlind: 50_000_000n,
        bigBlind: 100_000_000n,
      });
      expect(createTableData.length).toBe(32);

      // 3. Join table
      const joinData = buildJoinTableData({ buyInAmount: 1_000_000_000n });
      expect(joinData.length).toBe(16);

      // 4. Player actions (simulate a simple hand)
      const checkData = buildPlayerActionData({
        actionType: ACTION_TYPE.CHECK,
        amount: 0n,
      });
      expect(checkData[1]).toBe(ACTION_TYPE.CHECK);

      const raiseData = buildPlayerActionData({
        actionType: ACTION_TYPE.RAISE,
        amount: 300_000_000n,
      });
      expect(raiseData[1]).toBe(ACTION_TYPE.RAISE);

      const callData = buildPlayerActionData({
        actionType: ACTION_TYPE.CALL,
        amount: 0n,
      });
      expect(callData[1]).toBe(ACTION_TYPE.CALL);

      const foldData = buildPlayerActionData({
        actionType: ACTION_TYPE.FOLD,
        amount: 0n,
      });
      expect(foldData[1]).toBe(ACTION_TYPE.FOLD);

      // 5. Settle
      const settleData = buildSettleData({});
      expect(settleData.length).toBe(1);

      // 6. Leave table
      const leaveData = buildLeaveTableData();
      expect(leaveData.length).toBe(1);

      // All instructions can be built successfully
      expect(true).toBe(true);
    });
  });
});

describe("IDL Consistency", () => {
  it("discriminators match IDL definitions", async () => {
    // Import IDL
    const idl = await import("../idl/poker.json");

    // Verify each instruction discriminator matches
    const instructionDiscriminators = new Map(
      idl.instructions.map((ix: { name: string; discriminator: number }) => [
        ix.name,
        ix.discriminator,
      ])
    );

    expect(instructionDiscriminators.get("initialize")).toBe(
      POKER_DISCRIMINATOR.INITIALIZE
    );
    expect(instructionDiscriminators.get("createTable")).toBe(
      POKER_DISCRIMINATOR.CREATE_TABLE
    );
    expect(instructionDiscriminators.get("joinTable")).toBe(
      POKER_DISCRIMINATOR.JOIN_TABLE
    );
    expect(instructionDiscriminators.get("leaveTable")).toBe(
      POKER_DISCRIMINATOR.LEAVE_TABLE
    );
    expect(instructionDiscriminators.get("playerAction")).toBe(
      POKER_DISCRIMINATOR.PLAYER_ACTION
    );
    expect(instructionDiscriminators.get("settle")).toBe(
      POKER_DISCRIMINATOR.SETTLE
    );
  });

  it("instruction sizes match IDL layout definitions", async () => {
    const idl = await import("../idl/poker.json");

    const getLayoutSize = (name: string): number => {
      const ix = idl.instructions.find(
        (i: { name: string }) => i.name === name
      );
      return ix?.layout?.size ?? 0;
    };

    // Verify sizes match actual builders
    expect(
      buildInitializeData({
        minPlayers: 2,
        minBuyIn: 0n,
        maxBuyIn: 0n,
        actionTimeoutSlots: 0n,
      }).length
    ).toBe(getLayoutSize("initialize"));

    expect(
      buildCreateTableData({ tableId: 0n, smallBlind: 1n, bigBlind: 2n }).length
    ).toBe(getLayoutSize("createTable"));

    expect(buildJoinTableData({ buyInAmount: 100n }).length).toBe(
      getLayoutSize("joinTable")
    );

    expect(buildLeaveTableData().length).toBe(getLayoutSize("leaveTable"));

    expect(
      buildPlayerActionData({ actionType: 0, amount: 0n }).length
    ).toBe(getLayoutSize("playerAction"));

    expect(buildSettleData({}).length).toBe(getLayoutSize("settle"));
  });
});

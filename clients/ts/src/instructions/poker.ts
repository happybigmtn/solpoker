/**
 * Poker program instruction builders
 *
 * These functions construct instruction data that matches the Rust program's
 * expected layouts exactly, including alignment and padding.
 */

import { POKER_DISCRIMINATOR, ACTION_TYPE } from "../constants.js";
import type {
  InitializeArgs,
  InitializeAccounts,
  CreateTableArgs,
  CreateTableAccounts,
  JoinTableArgs,
  JoinTableAccounts,
  LeaveTableAccounts,
  StartHandArgs,
  StartHandAccounts,
  TimeoutActionAccounts,
  PlayerActionArgs,
  PlayerActionAccounts,
  SettleArgs,
  SettleAccounts,
  RevealSeedArgs,
  RevealSeedAccounts,
  InitStakingPoolAccounts,
  DepositStakeArgs,
  DepositStakeAccounts,
  WithdrawStakeArgs,
  WithdrawStakeAccounts,
  ClaimRewardsAccounts,
  SweepRakeAccounts,
} from "../types.js";

// Re-export ACTION_TYPE for convenience
export { ACTION_TYPE };

/**
 * Build instruction data for Initialize
 * Layout: discriminator(1) + min_players(1) + padding(6) + min_buy_in(8) + max_buy_in(8) + action_timeout_slots(8) = 32 bytes
 */
export function buildInitializeData(args: InitializeArgs): Uint8Array {
  const data = new Uint8Array(32);
  const view = new DataView(data.buffer);

  data[0] = POKER_DISCRIMINATOR.INITIALIZE;
  data[1] = args.minPlayers;
  // padding [2..8]
  view.setBigUint64(8, args.minBuyIn, true);
  view.setBigUint64(16, args.maxBuyIn, true);
  view.setBigUint64(24, args.actionTimeoutSlots, true);

  return data;
}

/**
 * Get account metas for Initialize instruction
 */
export function getInitializeAccountMetas(accounts: InitializeAccounts) {
  return [
    { address: accounts.config, role: "writable" as const },
    { address: accounts.authority, role: "writable_signer" as const },
    { address: accounts.crispsMint, role: "readonly" as const },
    { address: accounts.entropyProgram, role: "readonly" as const },
    { address: accounts.systemProgram, role: "readonly" as const },
  ];
}

/**
 * Build instruction data for CreateTable
 * Layout: discriminator(1) + padding(7) + table_id(8) + small_blind(8) + big_blind(8) = 32 bytes
 */
export function buildCreateTableData(args: CreateTableArgs): Uint8Array {
  const data = new Uint8Array(32);
  const view = new DataView(data.buffer);

  data[0] = POKER_DISCRIMINATOR.CREATE_TABLE;
  // padding [1..8]
  view.setBigUint64(8, args.tableId, true);
  view.setBigUint64(16, args.smallBlind, true);
  view.setBigUint64(24, args.bigBlind, true);

  return data;
}

/**
 * Get account metas for CreateTable instruction
 */
export function getCreateTableAccountMetas(accounts: CreateTableAccounts) {
  return [
    { address: accounts.table, role: "writable" as const },
    { address: accounts.vault, role: "writable" as const },
    { address: accounts.payer, role: "writable_signer" as const },
    { address: accounts.config, role: "readonly" as const },
    { address: accounts.crispsMint, role: "readonly" as const },
    { address: accounts.tokenProgram, role: "readonly" as const },
    { address: accounts.systemProgram, role: "readonly" as const },
  ];
}

/**
 * Build instruction data for JoinTable
 * Layout: discriminator(1) + padding(7) + buy_in_amount(8) = 16 bytes
 */
export function buildJoinTableData(args: JoinTableArgs): Uint8Array {
  const data = new Uint8Array(16);
  const view = new DataView(data.buffer);

  data[0] = POKER_DISCRIMINATOR.JOIN_TABLE;
  // padding [1..8]
  view.setBigUint64(8, args.buyInAmount, true);

  return data;
}

/**
 * Get account metas for JoinTable instruction
 */
export function getJoinTableAccountMetas(accounts: JoinTableAccounts) {
  return [
    { address: accounts.table, role: "writable" as const },
    { address: accounts.vault, role: "writable" as const },
    { address: accounts.playerTokenAccount, role: "writable" as const },
    { address: accounts.player, role: "signer" as const },
    { address: accounts.config, role: "readonly" as const },
    { address: accounts.tokenProgram, role: "readonly" as const },
  ];
}

/**
 * Build instruction data for LeaveTable
 * Layout: discriminator(1) = 1 byte
 */
export function buildLeaveTableData(): Uint8Array {
  return new Uint8Array([POKER_DISCRIMINATOR.LEAVE_TABLE]);
}

/**
 * Get account metas for LeaveTable instruction
 */
export function getLeaveTableAccountMetas(accounts: LeaveTableAccounts) {
  return [
    { address: accounts.table, role: "writable" as const },
    { address: accounts.vault, role: "writable" as const },
    { address: accounts.playerTokenAccount, role: "writable" as const },
    { address: accounts.player, role: "signer" as const },
    { address: accounts.config, role: "readonly" as const },
    { address: accounts.tokenProgram, role: "readonly" as const },
  ];
}

/**
 * Build instruction data for StartHand
 * Layout: discriminator(1) + padding(7) + seed_commitment(32) + hole_card_hashes(32*10) = 360 bytes
 */
export function buildStartHandData(args: StartHandArgs): Uint8Array {
  if (args.seedCommitment.length !== 32) {
    throw new Error("seedCommitment must be 32 bytes");
  }
  if (args.holeCardHashes.length !== 10) {
    throw new Error("holeCardHashes must have exactly 10 entries");
  }

  const data = new Uint8Array(360);

  data[0] = POKER_DISCRIMINATOR.START_HAND;
  // padding [1..8]
  data.set(args.seedCommitment, 8);

  for (let i = 0; i < 10; i++) {
    if (args.holeCardHashes[i].length !== 32) {
      throw new Error(`holeCardHashes[${i}] must be 32 bytes`);
    }
    data.set(args.holeCardHashes[i], 40 + i * 32);
  }

  return data;
}

/**
 * Get account metas for StartHand instruction
 */
export function getStartHandAccountMetas(accounts: StartHandAccounts) {
  return [
    { address: accounts.table, role: "writable" as const },
    { address: accounts.provider, role: "signer" as const },
    { address: accounts.config, role: "readonly" as const },
    { address: accounts.clock, role: "readonly" as const },
    { address: accounts.entropyProgram, role: "readonly" as const },
    { address: accounts.entropyConfig, role: "readonly" as const },
    { address: accounts.entropyCommitment, role: "readonly" as const },
    { address: accounts.entropyRequest, role: "writable" as const },
    { address: accounts.slotHashes, role: "readonly" as const },
    { address: accounts.systemProgram, role: "readonly" as const },
  ];
}

/**
 * Build instruction data for TimeoutAction
 * Layout: discriminator(1) = 1 byte
 */
export function buildTimeoutActionData(): Uint8Array {
  return new Uint8Array([POKER_DISCRIMINATOR.TIMEOUT_ACTION]);
}

/**
 * Get account metas for TimeoutAction instruction
 */
export function getTimeoutActionAccountMetas(accounts: TimeoutActionAccounts) {
  return [
    { address: accounts.table, role: "writable" as const },
    { address: accounts.config, role: "readonly" as const },
    { address: accounts.clock, role: "readonly" as const },
  ];
}

/**
 * Build instruction data for PlayerAction
 * Layout: discriminator(1) + action_type(1) + padding(6) + amount(8) = 16 bytes
 */
export function buildPlayerActionData(args: PlayerActionArgs): Uint8Array {
  const data = new Uint8Array(16);
  const view = new DataView(data.buffer);

  data[0] = POKER_DISCRIMINATOR.PLAYER_ACTION;
  data[1] = args.actionType;
  // padding [2..8]
  view.setBigUint64(8, args.amount, true);

  return data;
}

/**
 * Get account metas for PlayerAction instruction
 */
export function getPlayerActionAccountMetas(accounts: PlayerActionAccounts) {
  return [
    { address: accounts.table, role: "writable" as const },
    { address: accounts.player, role: "signer" as const },
    { address: accounts.config, role: "readonly" as const },
    { address: accounts.clock, role: "readonly" as const },
  ];
}

/**
 * Build instruction data for Settle
 * Layout: discriminator(1)
 */
export function buildSettleData(_args: SettleArgs): Uint8Array {
  return new Uint8Array([POKER_DISCRIMINATOR.SETTLE]);
}

/**
 * Get account metas for Settle instruction
 */
export function getSettleAccountMetas(accounts: SettleAccounts) {
  return [
    { address: accounts.table, role: "writable" as const },
    { address: accounts.config, role: "readonly" as const },
  ];
}

/**
 * Build instruction data for RevealSeed
 * Layout: discriminator(1) + padding(7) + seed(32) + revealed_hole_cards(2*10) = 60 bytes
 */
export function buildRevealSeedData(args: RevealSeedArgs): Uint8Array {
  if (args.seed.length !== 32) {
    throw new Error("seed must be 32 bytes");
  }
  if (args.revealedHoleCards.length !== 10) {
    throw new Error("revealedHoleCards must have exactly 10 entries");
  }

  const data = new Uint8Array(60);

  data[0] = POKER_DISCRIMINATOR.REVEAL_SEED;
  // padding [1..8]
  data.set(args.seed, 8);

  for (let i = 0; i < 10; i++) {
    data[40 + i * 2] = args.revealedHoleCards[i][0];
    data[40 + i * 2 + 1] = args.revealedHoleCards[i][1];
  }

  return data;
}

/**
 * Get account metas for RevealSeed instruction
 */
export function getRevealSeedAccountMetas(accounts: RevealSeedAccounts) {
  return [
    { address: accounts.table, role: "writable" as const },
    { address: accounts.provider, role: "signer" as const },
    { address: accounts.config, role: "readonly" as const },
    { address: accounts.entropyProgram, role: "readonly" as const },
    { address: accounts.entropyConfig, role: "readonly" as const },
    { address: accounts.entropyCommitment, role: "readonly" as const },
    { address: accounts.entropyRequest, role: "writable" as const },
  ];
}

/**
 * Build instruction data for InitStakingPool
 * Layout: discriminator(1) = 1 byte
 */
export function buildInitStakingPoolData(): Uint8Array {
  return new Uint8Array([POKER_DISCRIMINATOR.INIT_STAKING_POOL]);
}

/**
 * Get account metas for InitStakingPool instruction
 */
export function getInitStakingPoolAccountMetas(accounts: InitStakingPoolAccounts) {
  return [
    { address: accounts.stakingPool, role: "writable" as const },
    { address: accounts.stakeVault, role: "writable" as const },
    { address: accounts.rewardsVault, role: "writable" as const },
    { address: accounts.payer, role: "writable_signer" as const },
    { address: accounts.config, role: "readonly" as const },
    { address: accounts.crispsMint, role: "readonly" as const },
    { address: accounts.tokenProgram, role: "readonly" as const },
    { address: accounts.systemProgram, role: "readonly" as const },
  ];
}

/**
 * Build instruction data for DepositStake
 * Layout: discriminator(1) + padding(7) + amount(8) = 16 bytes
 */
export function buildDepositStakeData(args: DepositStakeArgs): Uint8Array {
  const data = new Uint8Array(16);
  const view = new DataView(data.buffer);

  data[0] = POKER_DISCRIMINATOR.DEPOSIT_STAKE;
  // padding [1..8]
  view.setBigUint64(8, args.amount, true);

  return data;
}

/**
 * Get account metas for DepositStake instruction
 */
export function getDepositStakeAccountMetas(accounts: DepositStakeAccounts) {
  return [
    { address: accounts.stakingPool, role: "writable" as const },
    { address: accounts.stakerPosition, role: "writable" as const },
    { address: accounts.stakeVault, role: "writable" as const },
    { address: accounts.stakerTokenAccount, role: "writable" as const },
    { address: accounts.staker, role: "signer" as const },
    { address: accounts.config, role: "readonly" as const },
    { address: accounts.tokenProgram, role: "readonly" as const },
    { address: accounts.systemProgram, role: "readonly" as const },
  ];
}

/**
 * Build instruction data for WithdrawStake
 * Layout: discriminator(1) + padding(7) + amount(8) = 16 bytes
 */
export function buildWithdrawStakeData(args: WithdrawStakeArgs): Uint8Array {
  const data = new Uint8Array(16);
  const view = new DataView(data.buffer);

  data[0] = POKER_DISCRIMINATOR.WITHDRAW_STAKE;
  // padding [1..8]
  view.setBigUint64(8, args.amount, true);

  return data;
}

/**
 * Get account metas for WithdrawStake instruction
 */
export function getWithdrawStakeAccountMetas(accounts: WithdrawStakeAccounts) {
  return [
    { address: accounts.stakingPool, role: "writable" as const },
    { address: accounts.stakerPosition, role: "writable" as const },
    { address: accounts.stakeVault, role: "writable" as const },
    { address: accounts.stakerTokenAccount, role: "writable" as const },
    { address: accounts.staker, role: "signer" as const },
    { address: accounts.config, role: "readonly" as const },
    { address: accounts.tokenProgram, role: "readonly" as const },
  ];
}

/**
 * Build instruction data for ClaimRewards
 * Layout: discriminator(1) = 1 byte
 */
export function buildClaimRewardsData(): Uint8Array {
  return new Uint8Array([POKER_DISCRIMINATOR.CLAIM_REWARDS]);
}

/**
 * Get account metas for ClaimRewards instruction
 */
export function getClaimRewardsAccountMetas(accounts: ClaimRewardsAccounts) {
  return [
    { address: accounts.stakingPool, role: "writable" as const },
    { address: accounts.stakerPosition, role: "writable" as const },
    { address: accounts.rewardsVault, role: "writable" as const },
    { address: accounts.stakerTokenAccount, role: "writable" as const },
    { address: accounts.staker, role: "signer" as const },
    { address: accounts.config, role: "readonly" as const },
    { address: accounts.tokenProgram, role: "readonly" as const },
  ];
}

/**
 * Build instruction data for SweepRake
 * Layout: discriminator(1) = 1 byte
 */
export function buildSweepRakeData(): Uint8Array {
  return new Uint8Array([POKER_DISCRIMINATOR.SWEEP_RAKE]);
}

/**
 * Get account metas for SweepRake instruction
 */
export function getSweepRakeAccountMetas(accounts: SweepRakeAccounts) {
  return [
    { address: accounts.table, role: "writable" as const },
    { address: accounts.tableVault, role: "writable" as const },
    { address: accounts.stakingPool, role: "writable" as const },
    { address: accounts.rewardsVault, role: "writable" as const },
    { address: accounts.config, role: "readonly" as const },
    { address: accounts.tokenProgram, role: "readonly" as const },
  ];
}

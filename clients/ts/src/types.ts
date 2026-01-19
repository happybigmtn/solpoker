/**
 * TypeScript types matching Rust struct layouts
 */

import type { Address } from "@solana/kit";

/**
 * Instruction data for Initialize poker program
 * Rust layout: discriminator(1) + min_players(1) + padding(6) + min_buy_in(8) + max_buy_in(8) + action_timeout_slots(8)
 */
export interface InitializeArgs {
  minPlayers: number;
  minBuyIn: bigint;
  maxBuyIn: bigint;
  actionTimeoutSlots: bigint;
}

/**
 * Accounts for Initialize instruction
 */
export interface InitializeAccounts {
  config: Address;
  authority: Address;
  crispsMint: Address;
  entropyProgram: Address;
  systemProgram: Address;
}

/**
 * Instruction data for CreateTable
 * Rust layout: discriminator(1) + padding(7) + table_id(8) + small_blind(8) + big_blind(8)
 */
export interface CreateTableArgs {
  tableId: bigint;
  smallBlind: bigint;
  bigBlind: bigint;
}

/**
 * Accounts for CreateTable instruction
 */
export interface CreateTableAccounts {
  table: Address;
  vault: Address;
  payer: Address;
  config: Address;
  crispsMint: Address;
  tokenProgram: Address;
  systemProgram: Address;
}

/**
 * Instruction data for JoinTable
 * Rust layout: discriminator(1) + padding(7) + buy_in_amount(8)
 */
export interface JoinTableArgs {
  buyInAmount: bigint;
}

/**
 * Accounts for JoinTable instruction
 */
export interface JoinTableAccounts {
  table: Address;
  vault: Address;
  playerTokenAccount: Address;
  player: Address;
  config: Address;
  tokenProgram: Address;
}

/**
 * Accounts for LeaveTable instruction
 */
export interface LeaveTableAccounts {
  table: Address;
  vault: Address;
  playerTokenAccount: Address;
  player: Address;
  config: Address;
  tokenProgram: Address;
}

/**
 * Instruction data for StartHand
 * Rust layout: discriminator(1) + padding(7) + seed_commitment(32) + hole_card_hashes(32*10)
 */
export interface StartHandArgs {
  seedCommitment: Uint8Array; // 32 bytes
  holeCardHashes: Uint8Array[]; // 10 entries of 32 bytes each
}

/**
 * Accounts for StartHand instruction
 */
export interface StartHandAccounts {
  table: Address;
  provider: Address;
  config: Address;
  clock: Address;
  entropyProgram: Address;
  entropyConfig: Address;
  entropyCommitment: Address;
  entropyRequest: Address;
  slotHashes: Address;
  systemProgram: Address;
}

/**
 * Accounts for TimeoutAction instruction
 */
export interface TimeoutActionAccounts {
  table: Address;
  config: Address;
  clock: Address;
}

/**
 * Instruction data for PlayerAction
 * Rust layout: discriminator(1) + action_type(1) + padding(6) + amount(8)
 */
export interface PlayerActionArgs {
  actionType: number;
  amount: bigint;
}

/**
 * Accounts for PlayerAction instruction
 */
export interface PlayerActionAccounts {
  table: Address;
  player: Address;
  config: Address;
  clock: Address;
}

/**
 * Instruction data for Settle
 * Rust layout: discriminator(1) + padding(7) + hand_strengths(8*10)
 */
export interface SettleArgs {}

/**
 * Accounts for Settle instruction
 */
export interface SettleAccounts {
  table: Address;
  config: Address;
}

/**
 * Instruction data for RevealSeed
 * Rust layout: discriminator(1) + padding(7) + seed(32) + revealed_hole_cards(2*10)
 */
export interface RevealSeedArgs {
  seed: Uint8Array; // 32 bytes
  revealedHoleCards: Array<[number, number]>; // 10 pairs of card indices
}

/**
 * Accounts for RevealSeed instruction
 */
export interface RevealSeedAccounts {
  table: Address;
  provider: Address;
  config: Address;
  entropyProgram: Address;
  entropyConfig: Address;
  entropyCommitment: Address;
  entropyRequest: Address;
}

/**
 * Accounts for InitStakingPool instruction
 */
export interface InitStakingPoolAccounts {
  stakingPool: Address;
  stakeVault: Address;
  rewardsVault: Address;
  payer: Address;
  config: Address;
  crispsMint: Address;
  tokenProgram: Address;
  systemProgram: Address;
}

/**
 * Instruction data for DepositStake
 * Rust layout: discriminator(1) + padding(7) + amount(8)
 */
export interface DepositStakeArgs {
  amount: bigint;
}

/**
 * Accounts for DepositStake instruction
 */
export interface DepositStakeAccounts {
  stakingPool: Address;
  stakerPosition: Address;
  stakeVault: Address;
  stakerTokenAccount: Address;
  staker: Address;
  config: Address;
  tokenProgram: Address;
  systemProgram: Address;
}

/**
 * Instruction data for WithdrawStake
 * Rust layout: discriminator(1) + padding(7) + amount(8)
 */
export interface WithdrawStakeArgs {
  amount: bigint;
}

/**
 * Accounts for WithdrawStake instruction
 */
export interface WithdrawStakeAccounts {
  stakingPool: Address;
  stakerPosition: Address;
  stakeVault: Address;
  stakerTokenAccount: Address;
  staker: Address;
  config: Address;
  tokenProgram: Address;
}

/**
 * Accounts for ClaimRewards instruction
 */
export interface ClaimRewardsAccounts {
  stakingPool: Address;
  stakerPosition: Address;
  rewardsVault: Address;
  stakerTokenAccount: Address;
  staker: Address;
  config: Address;
  tokenProgram: Address;
}

/**
 * Accounts for SweepRake instruction
 */
export interface SweepRakeAccounts {
  table: Address;
  tableVault: Address;
  stakingPool: Address;
  rewardsVault: Address;
  config: Address;
  tokenProgram: Address;
}

// Entropy program types

/**
 * Instruction data for Entropy Initialize
 * Rust layout: discriminator(1) + padding(7) + min_bond(8) + reveal_window_slots(8) + slash_basis_points(8)
 */
export interface EntropyInitializeArgs {
  minBond: bigint;
  revealWindowSlots: bigint;
  slashBasisPoints: bigint;
}

/**
 * Accounts for Entropy Initialize instruction
 */
export interface EntropyInitializeAccounts {
  config: Address;
  authority: Address;
  provider: Address;
  systemProgram: Address;
}

/**
 * Instruction data for Entropy Commit
 * Rust layout: discriminator(1) + padding(7) + hash(32) + sequence(8) + bond_amount(8)
 */
export interface EntropyCommitArgs {
  hash: Uint8Array; // 32 bytes
  sequence: bigint;
  bondAmount: bigint;
}

/**
 * Accounts for Entropy Commit instruction
 */
export interface EntropyCommitAccounts {
  commitment: Address;
  provider: Address;
  config: Address;
  systemProgram: Address;
}

/**
 * Instruction data for Entropy Reveal
 * Rust layout: discriminator(1) + padding(7) + preimage(32)
 */
export interface EntropyRevealArgs {
  preimage: Uint8Array; // 32 bytes
}

/**
 * Accounts for Entropy Reveal instruction
 */
export interface EntropyRevealAccounts {
  commitment: Address;
  provider: Address;
  config: Address;
}

/**
 * Instruction data for Entropy Request
 * Rust layout: discriminator(1) + padding(7) + request_id(8)
 */
export interface EntropyRequestArgs {
  requestId: bigint;
}

/**
 * Accounts for Entropy Request instruction
 */
export interface EntropyRequestAccounts {
  request: Address;
  requester: Address;
  commitment: Address;
  config: Address;
  slotHashes: Address;
  systemProgram: Address;
}

/**
 * Accounts for Entropy Finalize instruction
 */
export interface EntropyFinalizeAccounts {
  request: Address;
  commitment: Address;
  config: Address;
}

/**
 * Accounts for Entropy Slash instruction
 */
export interface EntropySlashAccounts {
  commitment: Address;
  provider: Address;
  slasher: Address;
  config: Address;
  clock: Address;
}

/**
 * Instruction data for Entropy UpdateConfig
 * Rust layout: discriminator(1) + padding(7) + new_provider(32) + new_min_bond(8) + new_reveal_window_slots(8) + new_slash_basis_points(8)
 */
export interface EntropyUpdateConfigArgs {
  newProvider: Uint8Array; // 32 bytes (all zeros to keep current)
  newMinBond: bigint; // 0 to keep current
  newRevealWindowSlots: bigint; // 0 to keep current
  newSlashBasisPoints: bigint; // 0 to keep current
}

/**
 * Accounts for Entropy UpdateConfig instruction
 */
export interface EntropyUpdateConfigAccounts {
  config: Address;
  authority: Address;
}

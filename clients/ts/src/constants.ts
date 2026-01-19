/**
 * Program constants and discriminators
 */

// Poker program instruction discriminators
export const POKER_DISCRIMINATOR = {
  INITIALIZE: 0,
  CREATE_TABLE: 1,
  JOIN_TABLE: 2,
  LEAVE_TABLE: 3,
  START_HAND: 4,
  TIMEOUT_ACTION: 5,
  PLAYER_ACTION: 6,
  SETTLE: 7,
  REVEAL_SEED: 8,
  INIT_STAKING_POOL: 9,
  DEPOSIT_STAKE: 10,
  WITHDRAW_STAKE: 11,
  CLAIM_REWARDS: 12,
  SWEEP_RAKE: 13,
} as const;

// Entropy program instruction discriminators
export const ENTROPY_DISCRIMINATOR = {
  INITIALIZE: 0,
  COMMIT: 1,
  REVEAL: 2,
  REQUEST: 3,
  FINALIZE: 4,
  SLASH: 5,
  UPDATE_CONFIG: 6,
} as const;

// Player action types for betting rounds (AC-5.1, AC-5.2)
export const ACTION_TYPE = {
  FOLD: 0,
  CHECK: 1,
  CALL: 2,
  RAISE: 3,
  ALL_IN: 4,
} as const;

// Account discriminators (for state parsing)
export const ACCOUNT_DISCRIMINATOR = {
  CONFIG: 1,
  TABLE: 2,
  STAKING_POOL: 3,
  STAKER_POSITION: 4,
} as const;

// Table status values
export const TABLE_STATUS = {
  WAITING: 0,
  PLAYING: 1,
  CLOSED: 2,
  SHOWDOWN: 3,
} as const;

// Seat status values
export const SEAT_STATUS = {
  EMPTY: 0,
  OCCUPIED: 1,
  SITTING_OUT: 2,
  FOLDED: 3,
  ALL_IN: 4,
} as const;

// Street values
export const STREET = {
  PREFLOP: 0,
  FLOP: 1,
  TURN: 2,
  RIVER: 3,
} as const;

// Account sizes (matching Rust constants)
export const CONFIG_SIZE = 128;
export const TABLE_SIZE = 1136;
export const STAKING_POOL_SIZE = 96;
export const STAKER_POSITION_SIZE = 64;
export const MAX_SEATS = 10;

// System program IDs
export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/**
 * TypeScript types for on-chain poker table state.
 *
 * These types mirror the Rust structs in robopoker-poker/src/state.rs
 * for client-side parsing and display.
 */

/** Maximum seats per table (AC-4.1) */
export const MAX_SEATS = 10;

/** Seat status values (mirrors seat_status module in Rust) */
export const SeatStatus = {
  EMPTY: 0,
  OCCUPIED: 1,
  SITTING_OUT: 2,
  FOLDED: 3,
  ALL_IN: 4,
} as const;

export type SeatStatusValue = (typeof SeatStatus)[keyof typeof SeatStatus];

/** Table status values (mirrors table_status module in Rust) */
export const TableStatus = {
  WAITING: 0,
  PLAYING: 1,
  CLOSED: 2,
  SHOWDOWN: 3,
} as const;

export type TableStatusValue = (typeof TableStatus)[keyof typeof TableStatus];

/** Betting street values */
export const Street = {
  PREFLOP: 0,
  FLOP: 1,
  TURN: 2,
  RIVER: 3,
} as const;

export type StreetValue = (typeof Street)[keyof typeof Street];

/**
 * A single seat at a poker table.
 * Mirrors the Rust `Seat` struct (96 bytes on-chain).
 */
export interface Seat {
  /** Seat status (empty, occupied, sitting_out, folded, all_in) */
  status: SeatStatusValue;
  /** Whether player has acted this street */
  hasActed: boolean;
  /** Player pubkey as base58 string (empty string if empty) */
  player: string;
  /** Player's chip stack at this table */
  stack: bigint;
  /** Player's current bet in this street */
  currentBet: bigint;
  /** Total amount player has contributed to pot this hand */
  totalBet: bigint;
  /** Hash of hole cards (32 bytes as hex string) */
  holeCardHash: string;
}

/**
 * Table state for UI rendering.
 * Mirrors the Rust `Table` struct (1,136 bytes on-chain).
 */
export interface TableState {
  /** Table status (waiting, playing, closed, showdown) */
  status: TableStatusValue;
  /** Number of occupied seats */
  playerCount: number;
  /** Current dealer position (0-9) */
  dealerPosition: number;
  /** Current actor seat index */
  currentActor: number;
  /** Current betting street */
  currentStreet: StreetValue;
  /** Number of players still active in the hand */
  activeCount: number;
  /** Whether seed has been revealed */
  seedRevealed: boolean;
  /** Unique table ID */
  tableId: bigint;
  /** Hand counter for entropy request IDs */
  handId: bigint;
  /** Small blind amount */
  smallBlind: bigint;
  /** Big blind amount */
  bigBlind: bigint;
  /** Slot deadline for current action (0 = no deadline) */
  actionDeadlineSlot: bigint;
  /** Current bet amount to call this street */
  currentBet: bigint;
  /** Minimum raise amount */
  minRaise: bigint;
  /** Total pot accumulated this hand */
  pot: bigint;
  /** Accumulated rake collected at this table */
  rakeAccumulated: bigint;
  /** Vault token account address (base58) */
  vault: string;
  /** Seed commitment hash (32 bytes as hex string) */
  seedCommitment: string;
  /** Revealed seed (32 bytes as hex string) */
  revealedSeed: string;
  /** Seats array (MAX_SEATS = 10) */
  seats: Seat[];
}

/**
 * Create an empty seat for initialization.
 */
export function emptySeat(): Seat {
  return {
    status: SeatStatus.EMPTY,
    hasActed: false,
    player: '',
    stack: 0n,
    currentBet: 0n,
    totalBet: 0n,
    holeCardHash: '',
  };
}

/**
 * Create an empty table state for initialization.
 */
export function emptyTableState(): TableState {
  return {
    status: TableStatus.WAITING,
    playerCount: 0,
    dealerPosition: 0,
    currentActor: 0,
    currentStreet: Street.PREFLOP,
    activeCount: 0,
    seedRevealed: false,
    tableId: 0n,
    handId: 0n,
    smallBlind: 0n,
    bigBlind: 0n,
    actionDeadlineSlot: 0n,
    currentBet: 0n,
    minRaise: 0n,
    pot: 0n,
    rakeAccumulated: 0n,
    vault: '',
    seedCommitment: '',
    revealedSeed: '',
    seats: Array.from({ length: MAX_SEATS }, emptySeat),
  };
}

/**
 * Number of board cards visible by street.
 * AC-CI6.3: Board cards update as streets are dealt.
 */
export function getBoardCardCount(street: StreetValue): number {
  switch (street) {
    case Street.PREFLOP:
      return 0;
    case Street.FLOP:
      return 3;
    case Street.TURN:
      return 4;
    case Street.RIVER:
      return 5;
    default:
      return 0;
  }
}

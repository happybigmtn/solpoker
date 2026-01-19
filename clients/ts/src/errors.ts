/**
 * Error decoding utilities for robopoker programs.
 *
 * AC-CI4.1: Transaction failures surface user-readable error messages.
 * AC-CI4.2: Program errors are decoded from transaction logs and displayed.
 */

/**
 * Poker program error codes.
 * These values match the PokerError enum in robopoker-poker/src/error.rs.
 */
export const POKER_ERROR_CODES = {
  InvalidInstruction: 0,
  AlreadyInitialized: 1,
  NotInitialized: 2,
  MissingSigner: 3,
  InvalidPda: 4,
  InvalidAccountDataLength: 5,
  TableFull: 6,
  PlayerAlreadySeated: 7,
  PlayerNotFound: 8,
  BuyInTooLow: 9,
  BuyInTooHigh: 10,
  InvalidMint: 11,
  InsufficientBalance: 12,
  ArithmeticOverflow: 13,
  InvalidAccountOwner: 14,
  TableIsPlaying: 15,
  NotEnoughPlayers: 16,
  TableNotWaiting: 17,
  DeadlineNotReached: 18,
  NoActionPending: 19,
  NotYourTurn: 20,
  InvalidActionType: 21,
  CannotFoldWhenCheck: 22,
  CannotCheckWhenBet: 23,
  RaiseTooSmall: 24,
  RaiseExceedsStack: 25,
  CallExceedsStack: 26,
  PlayerAlreadyFolded: 27,
  PlayerAlreadyAllIn: 28,
  HandNotInProgress: 29,
  DuplicateMutableAccount: 30,
  InvalidSeedCommitment: 31,
  HoleCardHashMismatch: 32,
  SeedAlreadyRevealed: 33,
  SeedNotRevealed: 34,
  TableNotShowdown: 35,
  StakingPoolNotInitialized: 36,
  StakerPositionNotFound: 37,
  InsufficientStakedAmount: 38,
  NoRewardsAvailable: 39,
  ZeroStakeAmount: 40,
  StakingPoolAlreadyInitialized: 41,
  ProviderMismatch: 42,
  InvalidSysvar: 43,
  PotInvariantViolation: 44,
  AccountNotWritable: 45,
} as const;

/**
 * Entropy program error codes.
 * These values match the EntropyError enum in robopoker-entropy/src/error.rs.
 */
export const ENTROPY_ERROR_CODES = {
  InvalidInstruction: 0,
  InvalidAccountOwner: 1,
  InvalidAccountDataLength: 2,
  ProviderMismatch: 3,
  InvalidCommitment: 4,
  InvalidPreimage: 5,
  RevealWindowExpired: 6,
  RevealWindowNotExpired: 7,
  RequestAlreadyFinalized: 8,
  InsufficientBond: 9,
  InvalidPda: 10,
  MissingSigner: 11,
  ArithmeticOverflow: 12,
  AlreadyInitialized: 13,
  NotInitialized: 14,
  InvalidSlothash: 15,
  DuplicateMutableAccount: 16,
  AccountNotWritable: 17,
} as const;

/**
 * User-friendly error messages for poker program errors.
 * AC-CI4.1: Messages are clear, specific, and suggest a next action.
 */
export const POKER_ERROR_MESSAGES: Record<number, string> = {
  [POKER_ERROR_CODES.InvalidInstruction]: 'Invalid instruction. Please refresh and try again.',
  [POKER_ERROR_CODES.AlreadyInitialized]: 'This account is already initialized.',
  [POKER_ERROR_CODES.NotInitialized]: 'Account not initialized. Please refresh the page.',
  [POKER_ERROR_CODES.MissingSigner]: 'Missing signature. Please approve the transaction in your wallet.',
  [POKER_ERROR_CODES.InvalidPda]: 'Invalid account address. Please refresh the page.',
  [POKER_ERROR_CODES.InvalidAccountDataLength]: 'Invalid account data. Please refresh the page.',
  [POKER_ERROR_CODES.TableFull]: 'This table is full. Try joining another table.',
  [POKER_ERROR_CODES.PlayerAlreadySeated]: 'You are already seated at this table.',
  [POKER_ERROR_CODES.PlayerNotFound]: 'You are not seated at this table. Join the table first.',
  [POKER_ERROR_CODES.BuyInTooLow]: 'Buy-in amount is too low. Increase your buy-in.',
  [POKER_ERROR_CODES.BuyInTooHigh]: 'Buy-in amount exceeds the table maximum.',
  [POKER_ERROR_CODES.InvalidMint]: 'Invalid token. This table only accepts CRISPS.',
  [POKER_ERROR_CODES.InsufficientBalance]: 'Insufficient balance. Add more CRISPS to your wallet.',
  [POKER_ERROR_CODES.ArithmeticOverflow]: 'Calculation error. Please try a smaller amount.',
  [POKER_ERROR_CODES.InvalidAccountOwner]: 'Invalid account owner. Please refresh the page.',
  [POKER_ERROR_CODES.TableIsPlaying]: 'Cannot leave while a hand is in progress. Wait for the hand to complete.',
  [POKER_ERROR_CODES.NotEnoughPlayers]: 'Not enough players to start. Wait for more players to join.',
  [POKER_ERROR_CODES.TableNotWaiting]: 'Table is not ready. Please wait.',
  [POKER_ERROR_CODES.DeadlineNotReached]: 'Action deadline not reached. Please wait.',
  [POKER_ERROR_CODES.NoActionPending]: 'No action is pending.',
  [POKER_ERROR_CODES.NotYourTurn]: "It's not your turn to act.",
  [POKER_ERROR_CODES.InvalidActionType]: 'Invalid action for the current game state.',
  [POKER_ERROR_CODES.CannotFoldWhenCheck]: "You can check for free. Fold isn't necessary.",
  [POKER_ERROR_CODES.CannotCheckWhenBet]: 'There is a bet to call. You must call, raise, or fold.',
  [POKER_ERROR_CODES.RaiseTooSmall]: 'Raise amount is too small. The minimum raise is the big blind.',
  [POKER_ERROR_CODES.RaiseExceedsStack]: "Raise exceeds your stack. Use all-in instead.",
  [POKER_ERROR_CODES.CallExceedsStack]: 'Call exceeds your stack. Going all-in.',
  [POKER_ERROR_CODES.PlayerAlreadyFolded]: 'You already folded this hand.',
  [POKER_ERROR_CODES.PlayerAlreadyAllIn]: 'You are already all-in.',
  [POKER_ERROR_CODES.HandNotInProgress]: 'No hand is currently in progress.',
  [POKER_ERROR_CODES.DuplicateMutableAccount]: 'Transaction error. Please try again.',
  [POKER_ERROR_CODES.InvalidSeedCommitment]: 'Invalid entropy commitment. Please contact support.',
  [POKER_ERROR_CODES.HoleCardHashMismatch]: 'Card verification failed. Please contact support.',
  [POKER_ERROR_CODES.SeedAlreadyRevealed]: 'Seed already revealed for this hand.',
  [POKER_ERROR_CODES.SeedNotRevealed]: 'Waiting for entropy reveal. Please wait.',
  [POKER_ERROR_CODES.TableNotShowdown]: 'Hand is not at showdown.',
  [POKER_ERROR_CODES.StakingPoolNotInitialized]: 'Staking pool not initialized.',
  [POKER_ERROR_CODES.StakerPositionNotFound]: 'No staking position found for this address.',
  [POKER_ERROR_CODES.InsufficientStakedAmount]: 'Insufficient staked amount.',
  [POKER_ERROR_CODES.NoRewardsAvailable]: 'No rewards available to claim.',
  [POKER_ERROR_CODES.ZeroStakeAmount]: 'Stake amount must be greater than zero.',
  [POKER_ERROR_CODES.StakingPoolAlreadyInitialized]: 'Staking pool already initialized.',
  [POKER_ERROR_CODES.ProviderMismatch]: 'Entropy provider mismatch. Please contact support.',
  [POKER_ERROR_CODES.InvalidSysvar]: 'Invalid system variable. Please refresh and try again.',
  [POKER_ERROR_CODES.PotInvariantViolation]: 'Pot calculation error. Please contact support.',
  [POKER_ERROR_CODES.AccountNotWritable]: 'Account permission error. Please try again.',
};

/**
 * User-friendly error messages for entropy program errors.
 */
export const ENTROPY_ERROR_MESSAGES: Record<number, string> = {
  [ENTROPY_ERROR_CODES.InvalidInstruction]: 'Invalid instruction. Please refresh and try again.',
  [ENTROPY_ERROR_CODES.InvalidAccountOwner]: 'Invalid account owner. Please refresh the page.',
  [ENTROPY_ERROR_CODES.InvalidAccountDataLength]: 'Invalid account data. Please refresh the page.',
  [ENTROPY_ERROR_CODES.ProviderMismatch]: 'Entropy provider mismatch.',
  [ENTROPY_ERROR_CODES.InvalidCommitment]: 'Invalid entropy commitment.',
  [ENTROPY_ERROR_CODES.InvalidPreimage]: 'Invalid entropy preimage.',
  [ENTROPY_ERROR_CODES.RevealWindowExpired]: 'Entropy reveal window expired.',
  [ENTROPY_ERROR_CODES.RevealWindowNotExpired]: 'Reveal window not yet expired.',
  [ENTROPY_ERROR_CODES.RequestAlreadyFinalized]: 'Entropy request already finalized.',
  [ENTROPY_ERROR_CODES.InsufficientBond]: 'Insufficient provider bond.',
  [ENTROPY_ERROR_CODES.InvalidPda]: 'Invalid account address. Please refresh the page.',
  [ENTROPY_ERROR_CODES.MissingSigner]: 'Missing signature. Please approve the transaction in your wallet.',
  [ENTROPY_ERROR_CODES.ArithmeticOverflow]: 'Calculation error. Please try a smaller amount.',
  [ENTROPY_ERROR_CODES.AlreadyInitialized]: 'Account already initialized.',
  [ENTROPY_ERROR_CODES.NotInitialized]: 'Account not initialized. Please refresh the page.',
  [ENTROPY_ERROR_CODES.InvalidSlothash]: 'Invalid slot hash. Please try again.',
  [ENTROPY_ERROR_CODES.DuplicateMutableAccount]: 'Transaction error. Please try again.',
  [ENTROPY_ERROR_CODES.AccountNotWritable]: 'Account permission error. Please try again.',
};

/**
 * Parse a custom program error code from an error message or logs.
 *
 * Solana program errors appear in formats like:
 * - "custom program error: 0x15" (hex)
 * - "Custom(21)" (decimal)
 * - "Error Code: 21"
 *
 * @param errorMessage - The error message or log line to parse
 * @returns The error code if found, undefined otherwise
 */
export function parseCustomErrorCode(errorMessage: string): number | undefined {
  // Match "custom program error: 0x" followed by hex digits
  const hexMatch = errorMessage.match(/custom program error:\s*0x([0-9a-fA-F]+)/i);
  if (hexMatch) {
    return parseInt(hexMatch[1], 16);
  }

  // Match "Custom(" followed by decimal digits
  const customMatch = errorMessage.match(/Custom\s*\(\s*(\d+)\s*\)/i);
  if (customMatch) {
    return parseInt(customMatch[1], 10);
  }

  // Match "Error Code: " followed by digits
  const errorCodeMatch = errorMessage.match(/Error Code:\s*(\d+)/i);
  if (errorCodeMatch) {
    return parseInt(errorCodeMatch[1], 10);
  }

  return undefined;
}

/**
 * Check if a log line indicates which program emitted the error.
 * Programs log "Program <ID> invoke" when called.
 *
 * @param logs - Array of transaction logs
 * @param programId - The program ID to check for
 * @returns true if the program was invoked before an error
 */
export function isProgramInvoked(logs: string[], programId: string): boolean {
  for (const log of logs) {
    if (log.includes(`Program ${programId} invoke`)) {
      return true;
    }
  }
  return false;
}

/**
 * Decoded program error with context.
 */
export interface DecodedProgramError {
  /** The error code */
  code: number;
  /** User-friendly error message */
  message: string;
  /** Which program the error came from */
  program: 'poker' | 'entropy' | 'unknown';
  /** Original error message */
  originalError: string;
}

/**
 * Decode a program error from an error message and optional logs.
 *
 * AC-CI4.2: Decodes program errors from transaction logs and provides
 * user-readable messages.
 *
 * @param error - The error object or message
 * @param logs - Optional transaction logs for context
 * @param pokerProgramId - Optional poker program ID for attribution
 * @param entropyProgramId - Optional entropy program ID for attribution
 * @returns Decoded error with user-friendly message
 */
export function decodeProgramError(
  error: Error | string,
  logs?: string[],
  pokerProgramId?: string,
  entropyProgramId?: string
): DecodedProgramError | undefined {
  const errorMessage = error instanceof Error ? error.message : error;

  // Try to parse the error code
  const code = parseCustomErrorCode(errorMessage);

  // Also check logs for error code if not found in message
  let logCode: number | undefined;
  if (logs) {
    for (const log of logs) {
      logCode = parseCustomErrorCode(log);
      if (logCode !== undefined) break;
    }
  }

  const finalCode = code ?? logCode;
  if (finalCode === undefined) {
    return undefined;
  }

  // Determine which program emitted the error
  let program: 'poker' | 'entropy' | 'unknown' = 'unknown';
  let message: string;

  if (logs && pokerProgramId && isProgramInvoked(logs, pokerProgramId)) {
    program = 'poker';
    message = POKER_ERROR_MESSAGES[finalCode] ?? `Poker program error ${finalCode}. Please try again.`;
  } else if (logs && entropyProgramId && isProgramInvoked(logs, entropyProgramId)) {
    program = 'entropy';
    message = ENTROPY_ERROR_MESSAGES[finalCode] ?? `Entropy program error ${finalCode}. Please try again.`;
  } else {
    // Try poker first since it's more common, then entropy
    if (finalCode in POKER_ERROR_MESSAGES) {
      program = 'poker';
      message = POKER_ERROR_MESSAGES[finalCode];
    } else if (finalCode in ENTROPY_ERROR_MESSAGES) {
      program = 'entropy';
      message = ENTROPY_ERROR_MESSAGES[finalCode];
    } else {
      message = `Program error ${finalCode}. Please try again.`;
    }
  }

  return {
    code: finalCode,
    message,
    program,
    originalError: errorMessage,
  };
}

/**
 * Common network and RPC error patterns.
 */
export const NETWORK_ERROR_PATTERNS = [
  'network',
  'timeout',
  'connection',
  'econnrefused',
  'enotfound',
  'socket',
  'fetch',
  'aborted',
  '503',
  '502',
  '504',
  'service unavailable',
  'bad gateway',
  'gateway timeout',
] as const;

/**
 * Check if an error is a network error that should trigger retry UI.
 *
 * AC-CI4.3: Network errors trigger retry with user feedback.
 *
 * @param error - The error to check
 * @returns true if the error is a network error
 */
export function isNetworkError(error: Error | string): boolean {
  const message = (error instanceof Error ? error.message : error).toLowerCase();
  return NETWORK_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

/**
 * Check if an error is a simulation error.
 *
 * AC-CI4.4: Simulation errors are surfaced before signing.
 *
 * @param error - The error to check
 * @returns true if the error came from simulation
 */
export function isSimulationError(error: Error | string): boolean {
  const message = (error instanceof Error ? error.message : error).toLowerCase();
  return (
    message.includes('simulation') ||
    message.includes('preflight') ||
    message.includes('simulate')
  );
}

/**
 * Check if an error is a user rejection (wallet declined).
 *
 * @param error - The error to check
 * @returns true if the user rejected the transaction
 */
export function isUserRejection(error: Error | string): boolean {
  const message = (error instanceof Error ? error.message : error).toLowerCase();
  return (
    message.includes('user rejected') ||
    message.includes('user denied') ||
    message.includes('rejected by user') ||
    message.includes('cancelled') ||
    message.includes('canceled')
  );
}

/**
 * Format an error into a user-friendly message.
 *
 * AC-CI4.1: Transaction failures surface user-readable error messages.
 * AC-PQ.CI2: Error messages are clear, specific, and suggest a next action.
 *
 * @param error - The error to format
 * @param logs - Optional transaction logs for context
 * @param pokerProgramId - Optional poker program ID
 * @param entropyProgramId - Optional entropy program ID
 * @returns User-friendly error message
 */
export function formatTransactionError(
  error: Error | string,
  logs?: string[],
  pokerProgramId?: string,
  entropyProgramId?: string
): string {
  const errorMessage = error instanceof Error ? error.message : error;

  // Check for user rejection first
  if (isUserRejection(error)) {
    return 'You cancelled the transaction. Please approve it in your wallet to continue.';
  }

  // Check for network errors
  if (isNetworkError(error)) {
    return 'Network error. Please check your connection and try again.';
  }

  // Check for simulation errors
  if (isSimulationError(error)) {
    return 'Transaction simulation failed. Please check your balance and try again.';
  }

  // Try to decode program error
  const decoded = decodeProgramError(error, logs, pokerProgramId, entropyProgramId);
  if (decoded) {
    return decoded.message;
  }

  // Check for common Solana errors
  const lowerError = errorMessage.toLowerCase();

  if (lowerError.includes('insufficient funds') || lowerError.includes('insufficient lamports')) {
    return "You don't have enough SOL for transaction fees. Please add SOL to your wallet.";
  }

  if (lowerError.includes('blockhash not found') || lowerError.includes('blockhash expired')) {
    return 'The transaction expired. Please try again.';
  }

  if (lowerError.includes('account not found')) {
    return 'Account not found. Please refresh the page.';
  }

  if (lowerError.includes('already processed')) {
    return 'Transaction was already processed.';
  }

  // Default message
  return 'Transaction failed. Please try again.';
}

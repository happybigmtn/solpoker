//! Error definitions for the poker program.

use pinocchio::program_error::ProgramError;

/// Custom error codes for the poker program
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum PokerError {
    /// Invalid instruction data
    InvalidInstruction = 0,
    /// Account already initialized
    AlreadyInitialized = 1,
    /// Account not initialized
    NotInitialized = 2,
    /// Missing required signer
    MissingSigner = 3,
    /// Invalid PDA derivation
    InvalidPda = 4,
    /// Invalid account data length
    InvalidAccountDataLength = 5,
    /// Table is full
    TableFull = 6,
    /// Player already seated
    PlayerAlreadySeated = 7,
    /// Player not found at table
    PlayerNotFound = 8,
    /// Buy-in amount too low
    BuyInTooLow = 9,
    /// Buy-in amount too high
    BuyInTooHigh = 10,
    /// Invalid mint (not CRISPS)
    InvalidMint = 11,
    /// Insufficient balance
    InsufficientBalance = 12,
    /// Arithmetic overflow
    ArithmeticOverflow = 13,
    /// Invalid account owner
    InvalidAccountOwner = 14,
    /// Table is playing, cannot leave
    TableIsPlaying = 15,
    /// Not enough players to start hand (AC-4.3)
    NotEnoughPlayers = 16,
    /// Table not in waiting state
    TableNotWaiting = 17,
    /// Action deadline not yet reached (AC-4.4)
    DeadlineNotReached = 18,
    /// No action pending (AC-4.4)
    NoActionPending = 19,
    /// Not player's turn to act (AC-5.3)
    NotYourTurn = 20,
    /// Invalid action type for current state (AC-5.3)
    InvalidActionType = 21,
    /// Cannot fold when no bet to call (AC-5.3)
    CannotFoldWhenCheck = 22,
    /// Cannot check when there's a bet to call (AC-5.3)
    CannotCheckWhenBet = 23,
    /// Raise amount too small (AC-5.2)
    RaiseTooSmall = 24,
    /// Raise amount exceeds stack (AC-5.2)
    RaiseExceedsStack = 25,
    /// Call amount exceeds stack (should use all-in) (AC-5.2)
    CallExceedsStack = 26,
    /// Player already folded
    PlayerAlreadyFolded = 27,
    /// Player already all-in
    PlayerAlreadyAllIn = 28,
    /// Hand not in progress
    HandNotInProgress = 29,
    /// Duplicate mutable accounts (AC-7.3)
    DuplicateMutableAccount = 30,
    /// Invalid seed commitment hash (AC-2.7)
    InvalidSeedCommitment = 31,
    /// Hole card hash mismatch (AC-2.8)
    HoleCardHashMismatch = 32,
    /// Seed already revealed for this hand
    SeedAlreadyRevealed = 33,
    /// Seed not yet revealed (AC-2.8: required for settlement)
    SeedNotRevealed = 34,
    /// Table not in showdown state
    TableNotShowdown = 35,
    // =========================================================================
    // Staking errors (AC-3.4, AC-3.5, AC-3.6)
    // =========================================================================
    /// Staking pool not initialized (AC-3.5)
    StakingPoolNotInitialized = 36,
    /// Staker position not found (AC-3.5)
    StakerPositionNotFound = 37,
    /// Insufficient staked amount for withdrawal (AC-3.5)
    InsufficientStakedAmount = 38,
    /// No rewards available to claim (AC-3.6)
    NoRewardsAvailable = 39,
    /// Stake amount must be greater than zero (AC-3.5)
    ZeroStakeAmount = 40,
    /// Staking pool already initialized
    StakingPoolAlreadyInitialized = 41,
    /// Entropy provider mismatch
    ProviderMismatch = 42,
}

impl From<PokerError> for ProgramError {
    fn from(e: PokerError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

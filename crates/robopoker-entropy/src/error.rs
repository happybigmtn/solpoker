//! Error types for the entropy program.

use pinocchio::program_error::ProgramError;

/// Entropy program errors
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum EntropyError {
    /// Invalid instruction discriminator
    InvalidInstruction = 0,
    /// Account not owned by this program
    InvalidAccountOwner = 1,
    /// Invalid account data length
    InvalidAccountDataLength = 2,
    /// Provider mismatch - only configured provider can operate
    ProviderMismatch = 3,
    /// Invalid commitment hash
    InvalidCommitment = 4,
    /// Reveal preimage does not match commitment
    InvalidPreimage = 5,
    /// Reveal window has expired
    RevealWindowExpired = 6,
    /// Reveal window has not expired (cannot slash yet)
    RevealWindowNotExpired = 7,
    /// Request already finalized
    RequestAlreadyFinalized = 8,
    /// Insufficient bond amount
    InsufficientBond = 9,
    /// Invalid PDA derivation
    InvalidPda = 10,
    /// Missing required signer
    MissingSigner = 11,
    /// Arithmetic overflow
    ArithmeticOverflow = 12,
    /// Config already initialized
    AlreadyInitialized = 13,
    /// Config not initialized
    NotInitialized = 14,
    /// Invalid slothash
    InvalidSlothash = 15,
    /// Duplicate mutable accounts (AC-POK7.3)
    DuplicateMutableAccount = 16,
    /// Account is not writable
    AccountNotWritable = 17,
}

impl From<EntropyError> for ProgramError {
    fn from(e: EntropyError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

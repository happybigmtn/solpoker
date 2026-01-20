//! Error types for the entropy provider.

use thiserror::Error;

/// Errors that can occur in the entropy provider.
#[derive(Error, Debug)]
pub enum ProviderError {
    /// Chain is exhausted (no more preimages available)
    #[error("hash chain exhausted at position {0}")]
    ChainExhausted(u64),

    /// Invalid chain depth (must be > 0)
    #[error("invalid chain depth: {0} (must be > 0)")]
    InvalidDepth(u64),

    /// Chain file I/O error
    #[error("chain file error: {0}")]
    IoError(#[from] std::io::Error),

    /// Chain serialization error
    #[error("chain serialization error: {0}")]
    SerializationError(#[from] serde_json::Error),

    /// Commitment hash mismatch (chain integrity violated)
    #[error("commitment hash mismatch at position {position}")]
    HashMismatch { position: u64 },

    /// Attempted to load chain with incompatible version
    #[error("incompatible chain version: found {found}, expected {expected}")]
    IncompatibleVersion { found: u32, expected: u32 },

    /// Commitment not found in pending tracker
    #[error("commitment not found: sequence {0}")]
    CommitmentNotFound(u64),
}

/// Result type alias for provider operations.
pub type Result<T> = std::result::Result<T, ProviderError>;

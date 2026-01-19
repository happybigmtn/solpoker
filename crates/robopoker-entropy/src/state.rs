//! Account state structures for the entropy program.
//!
//! All structures use fixed-size layouts suitable for on-chain storage.
//! Fields are ordered largest-to-smallest for optimal alignment.
//!
//! # Account Byte Sizes (AC-1.5)
//!
//! | Account    | Size (bytes) | Notes                       |
//! |------------|-------------:|-----------------------------|
//! | Config     |           96 | Global entropy config       |
//! | Commitment |          128 | Provider commitment record  |
//! | Request    |          160 | Randomness request record   |
//!
//! Sizes are asserted in `tests/mollusk_tests.rs`.

use pinocchio::pubkey::Pubkey;

/// Size constants for account data
pub const CONFIG_SIZE: usize = core::mem::size_of::<Config>();
pub const COMMITMENT_SIZE: usize = core::mem::size_of::<Commitment>();
pub const REQUEST_SIZE: usize = core::mem::size_of::<Request>();

/// Account discriminators for type safety
pub mod discriminator {
    pub const CONFIG: u8 = 1;
    pub const COMMITMENT: u8 = 2;
    pub const REQUEST: u8 = 3;
}

/// Global configuration account (PDA: [b"config"])
///
/// Stores the authorized provider pubkey, bond requirements, and timing parameters.
/// Only one config exists per program deployment.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Config {
    /// Account discriminator
    pub discriminator: u8,
    /// Whether the config has been initialized
    pub initialized: u8,
    /// Padding for alignment
    pub _padding: [u8; 6],
    /// The authorized entropy provider pubkey (AC-2.5: single-provider mode)
    pub provider: Pubkey,
    /// Authority that can update config
    pub authority: Pubkey,
    /// Minimum bond required from provider (in lamports)
    pub min_bond: u64,
    /// Number of slots provider has to reveal after request
    pub reveal_window_slots: u64,
    /// Slash penalty as basis points of bond (e.g., 10000 = 100%)
    pub slash_basis_points: u64,
}

impl Config {
    pub const SEEDS: &'static [&'static [u8]] = &[b"config"];

    /// Load config from account data (zero-copy)
    ///
    /// # Safety
    /// Caller must ensure data length >= CONFIG_SIZE and alignment is correct
    #[inline]
    pub unsafe fn from_bytes_unchecked(data: &[u8]) -> &Self {
        unsafe { &*(data.as_ptr() as *const Self) }
    }

    /// Load mutable config from account data (zero-copy)
    ///
    /// # Safety
    /// Caller must ensure data length >= CONFIG_SIZE and alignment is correct
    #[inline]
    pub unsafe fn from_bytes_unchecked_mut(data: &mut [u8]) -> &mut Self {
        unsafe { &mut *(data.as_mut_ptr() as *mut Self) }
    }

    /// Check if config is initialized
    #[inline]
    pub fn is_initialized(&self) -> bool {
        self.discriminator == discriminator::CONFIG && self.initialized == 1
    }
}

/// Provider commitment account (PDA: [b"commitment", provider, sequence.to_le_bytes()])
///
/// Represents a single commitment in the provider's hash chain.
/// The provider commits to hash(preimage), then later reveals the preimage.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Commitment {
    /// Account discriminator
    pub discriminator: u8,
    /// Commitment status: 0=pending, 1=revealed, 2=slashed
    pub status: u8,
    /// Padding for alignment
    pub _padding: [u8; 6],
    /// The provider who made this commitment
    pub provider: Pubkey,
    /// The commitment hash (SHA256 of preimage)
    pub hash: [u8; 32],
    /// Bond amount locked for this commitment
    pub bond_amount: u64,
    /// Slot when commitment was created
    pub commit_slot: u64,
    /// Sequence number in provider's chain
    pub sequence: u64,
    /// The revealed preimage (zeroed until reveal)
    pub preimage: [u8; 32],
}

impl Commitment {
    /// Load commitment from account data (zero-copy)
    ///
    /// # Safety
    /// Caller must ensure data length >= COMMITMENT_SIZE
    #[inline]
    pub unsafe fn from_bytes_unchecked(data: &[u8]) -> &Self {
        unsafe { &*(data.as_ptr() as *const Self) }
    }

    /// Load mutable commitment from account data (zero-copy)
    ///
    /// # Safety
    /// Caller must ensure data length >= COMMITMENT_SIZE
    #[inline]
    pub unsafe fn from_bytes_unchecked_mut(data: &mut [u8]) -> &mut Self {
        unsafe { &mut *(data.as_mut_ptr() as *mut Self) }
    }

    /// Check if this commitment is pending reveal
    #[inline]
    pub fn is_pending(&self) -> bool {
        self.discriminator == discriminator::COMMITMENT && self.status == 0
    }

    /// Check if this commitment has been revealed
    #[inline]
    pub fn is_revealed(&self) -> bool {
        self.discriminator == discriminator::COMMITMENT && self.status == 1
    }

    /// Check if this commitment has been slashed
    #[inline]
    pub fn is_slashed(&self) -> bool {
        self.discriminator == discriminator::COMMITMENT && self.status == 2
    }
}

/// Commitment status values
pub mod commitment_status {
    pub const PENDING: u8 = 0;
    pub const REVEALED: u8 = 1;
    pub const SLASHED: u8 = 2;
}

/// Randomness request account (PDA: [b"request", requester, request_id.to_le_bytes()])
///
/// Represents a request for randomness from a specific commitment.
/// The poker program creates these via CPI.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Request {
    /// Account discriminator
    pub discriminator: u8,
    /// Request status: 0=pending, 1=finalized
    pub status: u8,
    /// Padding for alignment
    pub _padding: [u8; 6],
    /// The program/account that requested randomness
    pub requester: Pubkey,
    /// The commitment this request is against
    pub commitment: Pubkey,
    /// Unique request ID from the requester
    pub request_id: u64,
    /// Slot when request was created
    pub request_slot: u64,
    /// Slot deadline for reveal (request_slot + reveal_window)
    pub deadline_slot: u64,
    /// The derived randomness (zeroed until finalized)
    pub randomness: [u8; 32],
    /// The slothash at request time (used in randomness derivation)
    pub slothash: [u8; 32],
}

impl Request {
    /// Load request from account data (zero-copy)
    ///
    /// # Safety
    /// Caller must ensure data length >= REQUEST_SIZE
    #[inline]
    pub unsafe fn from_bytes_unchecked(data: &[u8]) -> &Self {
        unsafe { &*(data.as_ptr() as *const Self) }
    }

    /// Load mutable request from account data (zero-copy)
    ///
    /// # Safety
    /// Caller must ensure data length >= REQUEST_SIZE
    #[inline]
    pub unsafe fn from_bytes_unchecked_mut(data: &mut [u8]) -> &mut Self {
        unsafe { &mut *(data.as_mut_ptr() as *mut Self) }
    }

    /// Check if request is pending
    #[inline]
    pub fn is_pending(&self) -> bool {
        self.discriminator == discriminator::REQUEST && self.status == 0
    }

    /// Check if request is finalized
    #[inline]
    pub fn is_finalized(&self) -> bool {
        self.discriminator == discriminator::REQUEST && self.status == 1
    }
}

/// Request status values
pub mod request_status {
    pub const PENDING: u8 = 0;
    pub const FINALIZED: u8 = 1;
}

/// Derive randomness from preimage and slothash (AC-2.2)
///
/// The randomness is XOR of the preimage and slothash, providing:
/// - Unpredictability from slothash (derived from validator VRF)
/// - Commitment binding from preimage (provider can't change after request)
#[inline]
pub fn derive_randomness(preimage: &[u8; 32], slothash: &[u8; 32]) -> [u8; 32] {
    let mut result = [0u8; 32];
    for i in 0..32 {
        result[i] = preimage[i] ^ slothash[i];
    }
    result
}

/// Compute SHA256 hash (for commitment verification)
///
/// Uses Solana's syscall for efficient on-chain hashing.
#[inline]
pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut result = [0u8; 32];
    // Use sol_sha256 syscall
    // The syscall expects an array of slices (pointer + count)
    #[cfg(target_os = "solana")]
    {
        let vals: &[&[u8]] = &[data];
        unsafe {
            pinocchio::syscalls::sol_sha256(
                vals.as_ptr() as *const u8,
                vals.len() as u64,
                result.as_mut_ptr(),
            );
        }
    }
    // For non-Solana targets (testing), use a simple placeholder
    #[cfg(not(target_os = "solana"))]
    {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(data);
        result.copy_from_slice(&hasher.finalize());
    }
    result
}

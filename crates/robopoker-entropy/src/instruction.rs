//! Instruction definitions for the entropy program.
//!
//! Each instruction has a discriminator byte followed by instruction-specific data.

/// Instruction discriminators
pub mod discriminator {
    /// Initialize program config
    pub const INITIALIZE: u8 = 0;
    /// Provider posts a new commitment
    pub const COMMIT: u8 = 1;
    /// Provider reveals preimage for a commitment
    pub const REVEAL: u8 = 2;
    /// Request randomness from a commitment (via CPI)
    pub const REQUEST: u8 = 3;
    /// Finalize a request with derived randomness
    pub const FINALIZE: u8 = 4;
    /// Slash provider for missed reveal
    pub const SLASH: u8 = 5;
    /// Update config parameters
    pub const UPDATE_CONFIG: u8 = 6;
}

#[inline]
fn read_unaligned<T: Copy>(data: &[u8]) -> T {
    debug_assert!(data.len() >= core::mem::size_of::<T>());
    // SAFETY: read_unaligned permits any alignment; caller validates length.
    unsafe { core::ptr::read_unaligned(data.as_ptr() as *const T) }
}

/// Initialize instruction data
/// Accounts:
///   0. [writable] Config PDA
///   1. [signer] Authority
///   2. [] Provider pubkey
///   3. [] System program
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct Initialize {
    pub discriminator: u8,
    pub _padding: [u8; 7],
    /// Minimum bond required (lamports)
    pub min_bond: u64,
    /// Reveal window (slots)
    pub reveal_window_slots: u64,
    /// Slash penalty (basis points, e.g., 10000 = 100%)
    pub slash_basis_points: u64,
}

impl Initialize {
    pub const SIZE: usize = core::mem::size_of::<Self>();

    /// Parse from instruction data
    ///
    /// Caller must ensure data.len() >= SIZE
    #[inline]
    pub fn from_bytes(data: &[u8]) -> Self {
        read_unaligned::<Self>(data)
    }

    /// # Safety
    /// Caller must ensure data.len() >= SIZE and data is properly aligned
    #[inline]
    pub unsafe fn from_bytes_unchecked(data: &[u8]) -> &Self {
        unsafe { &*(data.as_ptr() as *const Self) }
    }
}

/// Commit instruction data
/// Accounts:
///   0. [writable] Commitment PDA
///   1. [signer, writable] Provider
///   2. [] Config
///   3. [] System program
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct Commit {
    pub discriminator: u8,
    pub _padding: [u8; 7],
    /// The commitment hash (SHA256 of preimage)
    pub hash: [u8; 32],
    /// Sequence number for this commitment
    pub sequence: u64,
    /// Bond amount to lock (must be >= config.min_bond)
    pub bond_amount: u64,
}

impl Commit {
    pub const SIZE: usize = core::mem::size_of::<Self>();

    /// Parse from instruction data
    ///
    /// Caller must ensure data.len() >= SIZE
    #[inline]
    pub fn from_bytes(data: &[u8]) -> Self {
        read_unaligned::<Self>(data)
    }

    /// # Safety
    /// Caller must ensure data.len() >= SIZE and data is properly aligned
    #[inline]
    pub unsafe fn from_bytes_unchecked(data: &[u8]) -> &Self {
        unsafe { &*(data.as_ptr() as *const Self) }
    }
}

/// Reveal instruction data
/// Accounts:
///   0. [writable] Commitment
///   1. [signer] Provider
///   2. [] Config
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct Reveal {
    pub discriminator: u8,
    pub _padding: [u8; 7],
    /// The preimage that hashes to the commitment
    pub preimage: [u8; 32],
}

impl Reveal {
    pub const SIZE: usize = core::mem::size_of::<Self>();

    /// Parse from instruction data
    ///
    /// Caller must ensure data.len() >= SIZE
    #[inline]
    pub fn from_bytes(data: &[u8]) -> Self {
        read_unaligned::<Self>(data)
    }

    /// # Safety
    /// Caller must ensure data.len() >= SIZE and data is properly aligned
    #[inline]
    pub unsafe fn from_bytes_unchecked(data: &[u8]) -> &Self {
        unsafe { &*(data.as_ptr() as *const Self) }
    }
}

/// Request instruction data (called via CPI from poker program)
/// Accounts:
///   0. [writable] Request PDA
///   1. [signer] Requester (poker program PDA or authority)
///   2. [writable, signer] Payer (funds request account creation)
///   3. [] Commitment
///   4. [] Config
///   5. [] SlotHashes sysvar
///   6. [] System program
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct Request {
    pub discriminator: u8,
    pub _padding: [u8; 7],
    /// Unique request ID from the requester
    pub request_id: u64,
}

impl Request {
    pub const SIZE: usize = core::mem::size_of::<Self>();

    /// Parse from instruction data
    ///
    /// Caller must ensure data.len() >= SIZE
    #[inline]
    pub fn from_bytes(data: &[u8]) -> Self {
        read_unaligned::<Self>(data)
    }

    /// # Safety
    /// Caller must ensure data.len() >= SIZE and data is properly aligned
    #[inline]
    pub unsafe fn from_bytes_unchecked(data: &[u8]) -> &Self {
        unsafe { &*(data.as_ptr() as *const Self) }
    }
}

/// Finalize instruction data
/// Accounts:
///   0. [writable] Request
///   1. [] Commitment (must be revealed)
///   2. [] Config
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct Finalize {
    pub discriminator: u8,
}

impl Finalize {
    pub const SIZE: usize = 1;

    /// Parse from instruction data
    ///
    /// Caller must ensure data.len() >= SIZE
    #[inline]
    pub fn from_bytes(data: &[u8]) -> Self {
        read_unaligned::<Self>(data)
    }

    /// # Safety
    /// Caller must ensure data.len() >= SIZE and data is properly aligned
    #[inline]
    pub unsafe fn from_bytes_unchecked(data: &[u8]) -> &Self {
        unsafe { &*(data.as_ptr() as *const Self) }
    }
}

/// Slash instruction data
/// Accounts:
///   0. [writable] Commitment
///   1. [] Request (for deadline verification)
///   2. [writable] Provider (receives remaining bond after slash)
///   3. [writable] Slasher (receives slash reward)
///   4. [] Config
///   5. [] Clock sysvar
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct Slash {
    pub discriminator: u8,
}

impl Slash {
    pub const SIZE: usize = 1;

    /// Parse from instruction data
    ///
    /// Caller must ensure data.len() >= SIZE
    #[inline]
    pub fn from_bytes(data: &[u8]) -> Self {
        read_unaligned::<Self>(data)
    }

    /// # Safety
    /// Caller must ensure data.len() >= SIZE and data is properly aligned
    #[inline]
    pub unsafe fn from_bytes_unchecked(data: &[u8]) -> &Self {
        unsafe { &*(data.as_ptr() as *const Self) }
    }
}

/// Update config instruction data
/// Accounts:
///   0. [writable] Config
///   1. [signer] Authority
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct UpdateConfig {
    pub discriminator: u8,
    pub _padding: [u8; 7],
    /// New provider (or all zeros to keep current)
    pub new_provider: [u8; 32],
    /// New min bond (or 0 to keep current)
    pub new_min_bond: u64,
    /// New reveal window (or 0 to keep current)
    pub new_reveal_window_slots: u64,
    /// New slash basis points (or 0 to keep current)
    pub new_slash_basis_points: u64,
}

impl UpdateConfig {
    pub const SIZE: usize = core::mem::size_of::<Self>();

    /// Parse from instruction data
    ///
    /// Caller must ensure data.len() >= SIZE
    #[inline]
    pub fn from_bytes(data: &[u8]) -> Self {
        read_unaligned::<Self>(data)
    }

    /// # Safety
    /// Caller must ensure data.len() >= SIZE and data is properly aligned
    #[inline]
    pub unsafe fn from_bytes_unchecked(data: &[u8]) -> &Self {
        unsafe { &*(data.as_ptr() as *const Self) }
    }
}

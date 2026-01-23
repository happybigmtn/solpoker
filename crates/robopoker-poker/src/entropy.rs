//! Minimal entropy program state layouts for cross-program validation.

use pinocchio::pubkey::Pubkey;

use crate::error::PokerError;

#[inline]
fn is_aligned<T>(data: *const u8) -> bool {
    let align = core::mem::align_of::<T>();
    (data as usize) & (align - 1) == 0
}

pub const CONFIG_SIZE: usize = core::mem::size_of::<EntropyConfig>();
pub const COMMITMENT_SIZE: usize = core::mem::size_of::<EntropyCommitment>();
pub const REQUEST_SIZE: usize = core::mem::size_of::<EntropyRequest>();

pub mod discriminator {
    pub const CONFIG: u8 = 1;
    pub const COMMITMENT: u8 = 2;
    pub const REQUEST: u8 = 3;
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct EntropyConfig {
    pub discriminator: u8,
    pub initialized: u8,
    pub _padding: [u8; 6],
    pub provider: Pubkey,
    pub authority: Pubkey,
    pub min_bond: u64,
    pub reveal_window_slots: u64,
    pub slash_basis_points: u64,
}

impl EntropyConfig {
    #[inline]
    pub fn is_initialized(&self) -> bool {
        self.discriminator == discriminator::CONFIG && self.initialized == 1
    }

    #[inline]
    pub fn from_bytes(data: &[u8]) -> Result<&Self, PokerError> {
        if data.len() < CONFIG_SIZE || !is_aligned::<Self>(data.as_ptr()) {
            return Err(PokerError::InvalidAccountDataLength);
        }
        Ok(unsafe { &*(data.as_ptr() as *const Self) })
    }

    #[inline]
    pub unsafe fn from_bytes_unchecked(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }
}

pub mod commitment_status {
    pub const PENDING: u8 = 0;
    pub const REVEALED: u8 = 1;
    pub const SLASHED: u8 = 2;
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct EntropyCommitment {
    pub discriminator: u8,
    pub status: u8,
    pub _padding: [u8; 6],
    pub provider: Pubkey,
    pub hash: [u8; 32],
    pub bond_amount: u64,
    pub commit_slot: u64,
    pub sequence: u64,
    pub preimage: [u8; 32],
}

impl EntropyCommitment {
    #[inline]
    pub fn is_pending(&self) -> bool {
        self.discriminator == discriminator::COMMITMENT && self.status == commitment_status::PENDING
    }

    #[inline]
    pub fn is_revealed(&self) -> bool {
        self.discriminator == discriminator::COMMITMENT && self.status == commitment_status::REVEALED
    }

    #[inline]
    pub fn from_bytes(data: &[u8]) -> Result<&Self, PokerError> {
        if data.len() < COMMITMENT_SIZE || !is_aligned::<Self>(data.as_ptr()) {
            return Err(PokerError::InvalidAccountDataLength);
        }
        Ok(unsafe { &*(data.as_ptr() as *const Self) })
    }

    #[inline]
    pub unsafe fn from_bytes_unchecked(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }
}

pub mod request_status {
    pub const PENDING: u8 = 0;
    pub const FINALIZED: u8 = 1;
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct EntropyRequest {
    pub discriminator: u8,
    pub status: u8,
    pub _padding: [u8; 6],
    pub requester: Pubkey,
    pub commitment: Pubkey,
    pub request_id: u64,
    pub request_slot: u64,
    pub deadline_slot: u64,
    pub randomness: [u8; 32],
    pub slothash: [u8; 32],
}

impl EntropyRequest {
    #[inline]
    pub fn is_pending(&self) -> bool {
        self.discriminator == discriminator::REQUEST && self.status == request_status::PENDING
    }

    #[inline]
    pub fn is_finalized(&self) -> bool {
        self.discriminator == discriminator::REQUEST && self.status == request_status::FINALIZED
    }

    #[inline]
    pub fn from_bytes(data: &[u8]) -> Result<&Self, PokerError> {
        if data.len() < REQUEST_SIZE || !is_aligned::<Self>(data.as_ptr()) {
            return Err(PokerError::InvalidAccountDataLength);
        }
        Ok(unsafe { &*(data.as_ptr() as *const Self) })
    }

    #[inline]
    pub unsafe fn from_bytes_unchecked(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }
}

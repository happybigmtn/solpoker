//! Account state structures for the poker program.
//!
//! All structures use fixed-size layouts suitable for on-chain storage.
//! Fields are ordered largest-to-smallest for optimal alignment (AC-POK1.5).
//!
//! # Account Byte Sizes (AC-POK1.5)
//!
//! | Account        | Size (bytes) | Notes                           |
//! |----------------|-------------:|--------------------------------|
//! | Config         |          128 | Global program configuration    |
//! | Table          |        1,144 | Header (184) + 10 seats (960)   |
//! | Seat           |           96 | Per-player state within table   |
//! | StakingPool    |           96 | Global staking pool state       |
//! | StakerPosition |           64 | Individual staker position      |
//!
//! All sizes are verified by snapshot tests in `tests/litesvm_tests.rs`.

use pinocchio::pubkey::Pubkey;

use crate::error::PokerError;

#[inline]
fn is_aligned<T>(data: *const u8) -> bool {
    let align = core::mem::align_of::<T>();
    (data as usize) & (align - 1) == 0
}

/// Implements zero-copy byte access methods for account state structs.
///
/// Generates:
/// - `from_bytes(&[u8])` - checked immutable load
/// - `from_bytes_mut(&mut [u8])` - checked mutable load
/// - `from_bytes_unchecked(&[u8])` - unchecked immutable load (unsafe)
/// - `from_bytes_unchecked_mut(&mut [u8])` - unchecked mutable load (unsafe)
macro_rules! impl_account_bytes {
    ($type:ty, $size:expr) => {
        impl $type {
            /// Load from account data (zero-copy with alignment check)
            #[inline]
            pub fn from_bytes(data: &[u8]) -> Result<&Self, PokerError> {
                if data.len() < $size || !is_aligned::<Self>(data.as_ptr()) {
                    return Err(PokerError::InvalidAccountDataLength);
                }
                Ok(unsafe { &*(data.as_ptr() as *const Self) })
            }

            /// Load mutable from account data (zero-copy with alignment check)
            #[inline]
            pub fn from_bytes_mut(data: &mut [u8]) -> Result<&mut Self, PokerError> {
                if data.len() < $size || !is_aligned::<Self>(data.as_ptr()) {
                    return Err(PokerError::InvalidAccountDataLength);
                }
                Ok(unsafe { &mut *(data.as_mut_ptr() as *mut Self) })
            }

            /// Load from account data without validation (zero-copy).
            ///
            /// # Safety
            ///
            /// Caller must guarantee all of the following:
            /// - `data.len() >= size_of::<Self>()` (currently $size bytes)
            /// - `data.as_ptr()` is properly aligned for `Self` (8-byte alignment for structs with u64 fields)
            /// - The data represents a valid initialized instance of `Self`
            /// - The returned reference's lifetime does not outlive `data`
            #[inline]
            pub unsafe fn from_bytes_unchecked(data: &[u8]) -> &Self {
                unsafe { &*(data.as_ptr() as *const Self) }
            }

            /// Load mutable from account data without validation (zero-copy).
            ///
            /// # Safety
            ///
            /// Caller must guarantee all of the following:
            /// - `data.len() >= size_of::<Self>()` (currently $size bytes)
            /// - `data.as_ptr()` is properly aligned for `Self` (8-byte alignment for structs with u64 fields)
            /// - The data represents a valid initialized instance of `Self`
            /// - The returned reference's lifetime does not outlive `data`
            /// - No other references to `data` exist for the lifetime of the returned reference
            #[inline]
            pub unsafe fn from_bytes_unchecked_mut(data: &mut [u8]) -> &mut Self {
                unsafe { &mut *(data.as_mut_ptr() as *mut Self) }
            }
        }
    };
}

/// Size constants for account data
pub const CONFIG_SIZE: usize = core::mem::size_of::<Config>();
pub const TABLE_SIZE: usize = core::mem::size_of::<Table>();
pub const STAKING_POOL_SIZE: usize = core::mem::size_of::<StakingPool>();
pub const STAKER_POSITION_SIZE: usize = core::mem::size_of::<StakerPosition>();

/// Account discriminators for type safety
pub mod discriminator {
    pub const CONFIG: u8 = 1;
    pub const TABLE: u8 = 2;
    /// Staking pool (global, one per program)
    pub const STAKING_POOL: u8 = 3;
    /// Individual staker position
    pub const STAKER_POSITION: u8 = 4;
}

/// Maximum seats per table (AC-POK4.1)
pub const MAX_SEATS: usize = 10;

/// Seat status values
pub mod seat_status {
    /// Seat is empty and available
    pub const EMPTY: u8 = 0;
    /// Seat is occupied by a player (actively betting)
    pub const OCCUPIED: u8 = 1;
    /// Player is sitting out
    pub const SITTING_OUT: u8 = 2;
    /// Player has folded this hand
    pub const FOLDED: u8 = 3;
    /// Player is all-in
    pub const ALL_IN: u8 = 4;
}

/// Betting street values (AC-POK5.1: betting rounds)
pub mod street {
    /// Preflop - before community cards
    pub const PREFLOP: u8 = 0;
    /// Flop - first 3 community cards
    pub const FLOP: u8 = 1;
    /// Turn - 4th community card
    pub const TURN: u8 = 2;
    /// River - 5th community card
    pub const RIVER: u8 = 3;
}

/// Global configuration account (PDA: [b"config"])
///
/// Stores the CRISPS mint address and authority for the poker program.
/// AC-POK3.1: CRISPS mint is Token-2022 with authority recorded in config.
/// AC-POK3.4: Rake percentage stored here for hand settlement.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Config {
    /// Account discriminator
    pub discriminator: u8,
    /// Whether the config has been initialized
    pub initialized: u8,
    /// Minimum players to start a hand (AC-POK4.3)
    pub min_players: u8,
    /// Padding for alignment
    pub _padding: [u8; 3],
    /// Rake percentage in basis points (AC-POK3.4)
    /// e.g., 250 = 2.5%, max 10000 = 100%
    pub rake_bps: u16,
    /// The CRISPS mint address (Token-2022)
    pub crisps_mint: Pubkey,
    /// Authority that can create tables and update config
    pub authority: Pubkey,
    /// Entropy program ID for randomness requests
    pub entropy_program: Pubkey,
    /// Minimum buy-in amount (in CRISPS base units)
    pub min_buy_in: u64,
    /// Maximum buy-in amount (in CRISPS base units)
    pub max_buy_in: u64,
    /// Slots allowed per action before timeout (AC-POK4.4)
    pub action_timeout_slots: u64,
}

impl_account_bytes!(Config, CONFIG_SIZE);

impl Config {
    pub const SEEDS: &'static [&'static [u8]] = &[b"config"];

    /// Check if config is initialized
    #[inline]
    pub fn is_initialized(&self) -> bool {
        self.discriminator == discriminator::CONFIG && self.initialized == 1
    }
}

/// A single seat at a poker table
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Seat {
    /// Seat status (empty, occupied, sitting_out, folded, all_in)
    pub status: u8,
    /// Whether player has acted this street (for tracking betting round completion)
    pub has_acted: u8,
    /// Padding for alignment
    pub _padding: [u8; 6],
    /// Player pubkey (zero if empty)
    pub player: Pubkey,
    /// Player's chip stack at this table (u64 per AC-POK1.3)
    pub stack: u64,
    /// Player's current bet in this street (AC-POK5.1: stake matching)
    pub current_bet: u64,
    /// Total amount player has contributed to pot this hand
    pub total_bet: u64,
    /// Hash of hole cards for this hand (AC-POK2.6: privacy hybrid)
    /// SHA256(card1_u8 || card2_u8) where cards are 0-51 indices
    /// Zeroed when not in a hand
    pub hole_card_hash: [u8; 32],
}

impl Seat {
    pub const SIZE: usize = core::mem::size_of::<Self>();

    /// Check if seat is empty
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.status == seat_status::EMPTY
    }

    /// Check if seat is occupied (actively playing)
    #[inline]
    pub fn is_occupied(&self) -> bool {
        self.status == seat_status::OCCUPIED
    }

    /// Check if seat is active in the hand (occupied or all-in, not folded)
    #[inline]
    pub fn is_active(&self) -> bool {
        self.status == seat_status::OCCUPIED || self.status == seat_status::ALL_IN
    }

    /// Check if seat can act (occupied and not all-in)
    #[inline]
    pub fn can_act(&self) -> bool {
        self.status == seat_status::OCCUPIED
    }

    /// Check if player is all-in
    #[inline]
    pub fn is_all_in(&self) -> bool {
        self.status == seat_status::ALL_IN
    }

    /// Check if player has folded
    #[inline]
    pub fn is_folded(&self) -> bool {
        self.status == seat_status::FOLDED
    }
}

impl Default for Seat {
    fn default() -> Self {
        Self {
            status: seat_status::EMPTY,
            has_acted: 0,
            _padding: [0; 6],
            player: Pubkey::default(),
            stack: 0,
            current_bet: 0,
            total_bet: 0,
            hole_card_hash: [0; 32],
        }
    }
}

/// Table account (PDA: [b"table", table_id.to_le_bytes()])
///
/// Represents a poker table with up to MAX_SEATS players.
/// AC-POK3.2: Each table has a PDA-owned vault token account for escrow.
/// AC-POK4.1: Tables support MAX_SEATS = 10.
/// AC-POK4.4: Action timeouts enforced via slot-based deadlines.
/// AC-POK5.1: Betting rounds enforce turn order and stake matching.
/// AC-POK2.6, AC-POK2.7, AC-POK2.8: Privacy hybrid with seed commitment for deck verification.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Table {
    /// Account discriminator
    pub discriminator: u8,
    /// Table status: 0=waiting, 1=playing, 2=closed, 3=showdown
    pub status: u8,
    /// Number of occupied seats
    pub player_count: u8,
    /// Current dealer position (0-9)
    pub dealer_position: u8,
    /// Current actor seat index (only valid when status=PLAYING)
    pub current_actor: u8,
    /// Current betting street (AC-POK5.1: preflop=0, flop=1, turn=2, river=3)
    pub current_street: u8,
    /// Whether seed has been revealed for this hand (AC-POK2.7)
    pub seed_revealed: u8,
    /// Padding for alignment
    pub _padding: u8,
    /// Bitmap of active seats (bit i set = seat i is active, not folded)
    /// Use count_ones() to get active count, trailing_zeros() to find next active
    pub active_bitmap: u16,
    /// Padding to maintain 8-byte alignment for following u64 fields
    pub _padding2: [u8; 6],
    /// Unique table ID
    pub table_id: u64,
    /// Hand counter for entropy request IDs
    pub hand_id: u64,
    /// Small blind amount
    pub small_blind: u64,
    /// Big blind amount
    pub big_blind: u64,
    /// Slot deadline for current action (AC-POK4.4: 0 = no deadline)
    pub action_deadline_slot: u64,
    /// Current bet amount to call this street (AC-POK5.1: stake matching)
    pub current_bet: u64,
    /// Minimum raise amount (AC-POK5.2: raise bounds)
    pub min_raise: u64,
    /// Total pot accumulated this hand
    pub pot: u64,
    /// Accumulated rake collected at this table (AC-POK3.4)
    /// Swept to staking pool rewards vault periodically
    pub rake_accumulated: u64,
    /// Vault token account address (PDA-owned, Token-2022)
    pub vault: Pubkey,
    /// Seed commitment hash for this hand (AC-POK2.7: sha256(seed))
    /// Provider commits to this before cards are dealt
    pub seed_commitment: [u8; 32],
    /// The revealed seed (zeroed until seed is revealed) (AC-POK2.7)
    pub revealed_seed: [u8; 32],
    /// Seats array (fixed-size for on-chain, AC-POK1.2)
    pub seats: [Seat; MAX_SEATS],
}

impl_account_bytes!(Table, TABLE_SIZE);

impl Table {
    /// PDA seeds prefix
    pub const SEEDS_PREFIX: &'static [u8] = b"table";
    /// Vault PDA seeds prefix
    pub const VAULT_SEEDS_PREFIX: &'static [u8] = b"vault";

    /// Check if table is initialized
    #[inline]
    pub fn is_initialized(&self) -> bool {
        self.discriminator == discriminator::TABLE
    }

    /// Find an empty seat index
    #[inline]
    pub fn find_empty_seat(&self) -> Option<usize> {
        self.seats.iter().position(|s| s.is_empty())
    }

    /// Find seat index for a player (excludes sitting out)
    #[inline]
    pub fn find_player_seat(&self, player: &Pubkey) -> Option<usize> {
        self.seats.iter().position(|s| {
            !s.is_empty() && s.status != seat_status::SITTING_OUT && &s.player == player
        })
    }

    /// Find seat index for any player by pubkey (including folded/all-in)
    #[inline]
    pub fn find_any_player_seat(&self, player: &Pubkey) -> Option<usize> {
        self.seats
            .iter()
            .position(|s| !s.is_empty() && &s.player == player)
    }

    /// Get total chips in all seats (for invariant checks)
    #[inline]
    pub fn total_chips(&self) -> u64 {
        self.seats.iter().map(|s| s.stack).sum()
    }

    /// Count active players from stored bitmap (O(1) via popcount)
    #[inline]
    pub fn active_count(&self) -> u8 {
        self.active_bitmap.count_ones() as u8
    }

    /// Set a seat as active in the bitmap
    #[inline]
    pub fn set_active(&mut self, idx: usize) {
        self.active_bitmap |= 1 << idx;
    }

    /// Clear a seat from the active bitmap
    #[inline]
    pub fn clear_active(&mut self, idx: usize) {
        self.active_bitmap &= !(1 << idx);
    }

    /// Rebuild active_bitmap from seat states (use after bulk changes)
    #[inline]
    pub fn rebuild_active_bitmap(&mut self) {
        self.active_bitmap = 0;
        for (i, seat) in self.seats.iter().enumerate() {
            if seat.is_active() {
                self.active_bitmap |= 1 << i;
            }
        }
    }

    /// Check if a seat is active via bitmap (O(1))
    #[inline]
    pub fn is_seat_active(&self, idx: usize) -> bool {
        (self.active_bitmap >> idx) & 1 != 0
    }

    /// Compute bitmap of seats that can act (occupied, not all-in).
    #[inline]
    pub fn can_act_bitmap(&self) -> u16 {
        let mut bitmap: u16 = 0;
        for (i, seat) in self.seats.iter().enumerate() {
            if seat.can_act() {
                bitmap |= 1 << i;
            }
        }
        bitmap
    }

    /// Count players who can still act (occupied, not all-in)
    #[inline]
    pub fn count_can_act(&self) -> u8 {
        self.can_act_bitmap().count_ones() as u8
    }

    /// Find next set bit after position in bitmap (wraps around).
    /// Returns None if no bits are set.
    #[inline]
    pub fn bitmap_next(bitmap: u16, from: usize) -> Option<usize> {
        if bitmap == 0 {
            return None;
        }
        for i in 1..=MAX_SEATS {
            let idx = (from + i) % MAX_SEATS;
            if (bitmap >> idx) & 1 != 0 {
                return Some(idx);
            }
        }
        None
    }

    /// Find next active seat after given position (wraps around)
    /// Uses can_act check (occupied and not all-in)
    #[inline]
    pub fn next_active_seat(&self, from: usize) -> Option<usize> {
        Self::bitmap_next(self.can_act_bitmap(), from)
    }

    /// Check if betting round is complete (all active players have matched or are all-in)
    #[inline]
    pub fn is_betting_complete(&self) -> bool {
        let bet_to_match = self.current_bet;
        self.seats.iter().all(|s| {
            // Empty, sitting out, or folded seats don't matter
            if s.is_empty() || s.status == seat_status::SITTING_OUT || s.is_folded() {
                return true;
            }
            // All-in players are done
            if s.is_all_in() {
                return true;
            }
            // Active players must have acted and matched the bet (or gone all-in)
            s.has_acted != 0 && s.current_bet == bet_to_match
        })
    }

    /// Get amount player needs to call
    #[inline]
    pub fn amount_to_call(&self, seat_idx: usize) -> u64 {
        self.current_bet
            .saturating_sub(self.seats[seat_idx].current_bet)
    }

    /// Reset betting state for new street
    pub fn reset_street_bets(&mut self) {
        self.current_bet = 0;
        self.min_raise = self.big_blind;
        for seat in self.seats.iter_mut() {
            seat.current_bet = 0;
            seat.has_acted = 0;
        }
    }
}

/// Table status values
pub mod table_status {
    /// Waiting for players
    pub const WAITING: u8 = 0;
    /// Hand in progress (betting rounds)
    pub const PLAYING: u8 = 1;
    /// Table closed
    pub const CLOSED: u8 = 2;
    /// Showdown - awaiting seed reveal (AC-POK2.7)
    pub const SHOWDOWN: u8 = 3;
}

/// Global staking pool account (PDA: [b"staking_pool"])
///
/// Manages the global stake pool for rake distribution (AC-POK3.4, AC-POK3.5, AC-POK3.6).
/// - Rake is collected from hands and accumulated here
/// - Stakers deposit CRISPS to earn proportional rewards
/// - Rewards are claimable based on stake share
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StakingPool {
    /// Account discriminator
    pub discriminator: u8,
    /// Whether the staking pool has been initialized
    pub initialized: u8,
    /// Padding for alignment
    pub _padding: [u8; 6],
    /// Total CRISPS staked by all stakers (AC-POK3.5)
    pub total_staked: u64,
    /// Pending rake rewards not yet distributed (AC-POK3.4)
    pub accumulated_rewards: u64,
    /// Rewards-per-token accumulator (scaled) for proportional payouts
    pub total_distributed: u64,
    /// Vault token account holding staked CRISPS (PDA-owned)
    pub stake_vault: Pubkey,
    /// Rewards vault holding accumulated rake (PDA-owned)
    pub rewards_vault: Pubkey,
}

impl_account_bytes!(StakingPool, STAKING_POOL_SIZE);

impl StakingPool {
    /// PDA seeds prefix
    pub const SEEDS_PREFIX: &'static [u8] = b"staking_pool";
    /// Stake vault PDA seeds prefix
    pub const STAKE_VAULT_SEEDS_PREFIX: &'static [u8] = b"stake_vault";
    /// Rewards vault PDA seeds prefix
    pub const REWARDS_VAULT_SEEDS_PREFIX: &'static [u8] = b"rewards_vault";

    /// Check if staking pool is initialized
    #[inline]
    pub fn is_initialized(&self) -> bool {
        self.discriminator == discriminator::STAKING_POOL && self.initialized == 1
    }
}

/// Individual staker position account (PDA: [b"staker", staker_pubkey])
///
/// Tracks a single staker's deposited CRISPS and reward claims (AC-POK3.5, AC-POK3.6).
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StakerPosition {
    /// Account discriminator
    pub discriminator: u8,
    /// Whether the position has been initialized
    pub initialized: u8,
    /// Padding for alignment
    pub _padding: [u8; 6],
    /// The staker's pubkey
    pub staker: Pubkey,
    /// Amount of CRISPS staked by this staker (AC-POK3.5)
    pub staked_amount: u64,
    /// Rewards accrued but not yet claimed by this staker (AC-POK3.6)
    pub rewards_claimed: u64,
    /// Snapshot of rewards-per-token accumulator at last claim/update
    pub last_rewards_per_token: u64,
}

impl_account_bytes!(StakerPosition, STAKER_POSITION_SIZE);

impl StakerPosition {
    /// PDA seeds prefix
    pub const SEEDS_PREFIX: &'static [u8] = b"staker";

    /// Check if staker position is initialized
    #[inline]
    pub fn is_initialized(&self) -> bool {
        self.discriminator == discriminator::STAKER_POSITION && self.initialized == 1
    }
}

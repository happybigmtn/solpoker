//! Instruction definitions for the poker program.
//!
//! Each instruction has a discriminator byte followed by instruction-specific data.

/// Instruction discriminators
pub mod discriminator {
    /// Initialize program config
    pub const INITIALIZE: u8 = 0;
    /// Create a new table
    pub const CREATE_TABLE: u8 = 1;
    /// Join a table (buy-in)
    pub const JOIN_TABLE: u8 = 2;
    /// Leave a table (cash out)
    pub const LEAVE_TABLE: u8 = 3;
    /// Start a new hand with seed commitment (AC-4.3, AC-2.6, AC-2.7)
    pub const START_HAND: u8 = 4;
    /// Process timeout auto-action (AC-4.4)
    pub const TIMEOUT_ACTION: u8 = 5;
    /// Player action during betting round (AC-5.1, AC-5.2, AC-5.3)
    pub const PLAYER_ACTION: u8 = 6;
    /// Settle hand and distribute pot (AC-6.1, AC-6.2)
    pub const SETTLE: u8 = 7;
    /// Reveal seed at showdown (AC-2.7, AC-2.8)
    pub const REVEAL_SEED: u8 = 8;
    /// Initialize staking pool (AC-3.5)
    pub const INIT_STAKING_POOL: u8 = 9;
    /// Deposit CRISPS into staking pool (AC-3.5)
    pub const DEPOSIT_STAKE: u8 = 10;
    /// Withdraw CRISPS from staking pool (AC-3.5)
    pub const WITHDRAW_STAKE: u8 = 11;
    /// Claim accumulated rake rewards (AC-3.6)
    pub const CLAIM_REWARDS: u8 = 12;
    /// Sweep accumulated rake from table to staking pool (AC-3.4)
    pub const SWEEP_RAKE: u8 = 13;
}

/// Initialize instruction data
/// Accounts:
///   0. [writable] Config PDA
///   1. [signer] Authority
///   2. [] CRISPS mint (Token-2022)
///   3. [] Entropy program
///   4. [] System program
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct Initialize {
    pub discriminator: u8,
    /// Minimum players to start a hand (AC-4.3)
    pub min_players: u8,
    pub _padding: [u8; 6],
    /// Minimum buy-in amount
    pub min_buy_in: u64,
    /// Maximum buy-in amount
    pub max_buy_in: u64,
    /// Slots allowed per action before timeout (AC-4.4)
    pub action_timeout_slots: u64,
}

impl Initialize {
    pub const SIZE: usize = core::mem::size_of::<Self>();

    /// Parse from instruction data
    ///
    /// # Safety
    /// Caller must ensure data.len() >= SIZE
    #[inline]
    pub unsafe fn from_bytes_unchecked(data: &[u8]) -> &Self {
        unsafe { &*(data.as_ptr() as *const Self) }
    }
}

/// Create table instruction data
/// Accounts:
///   0. [writable] Table PDA
///   1. [writable] Vault token account PDA
///   2. [signer, writable] Payer
///   3. [] Config
///   4. [] CRISPS mint
///   5. [] Token-2022 program
///   6. [] System program
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct CreateTable {
    pub discriminator: u8,
    pub _padding: [u8; 7],
    /// Unique table ID
    pub table_id: u64,
    /// Small blind amount
    pub small_blind: u64,
    /// Big blind amount
    pub big_blind: u64,
}

impl CreateTable {
    pub const SIZE: usize = core::mem::size_of::<Self>();

    /// Parse from instruction data
    ///
    /// # Safety
    /// Caller must ensure data.len() >= SIZE
    #[inline]
    pub unsafe fn from_bytes_unchecked(data: &[u8]) -> &Self {
        unsafe { &*(data.as_ptr() as *const Self) }
    }
}

/// Join table instruction data (AC-3.3: debit player, credit vault)
/// Accounts:
///   0. [writable] Table
///   1. [writable] Vault token account
///   2. [writable] Player token account
///   3. [signer] Player
///   4. [] Config
///   5. [] Token-2022 program
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct JoinTable {
    pub discriminator: u8,
    pub _padding: [u8; 7],
    /// Amount of CRISPS to buy-in with
    pub buy_in_amount: u64,
}

impl JoinTable {
    pub const SIZE: usize = core::mem::size_of::<Self>();

    /// Parse from instruction data
    ///
    /// # Safety
    /// Caller must ensure data.len() >= SIZE
    #[inline]
    pub unsafe fn from_bytes_unchecked(data: &[u8]) -> &Self {
        unsafe { &*(data.as_ptr() as *const Self) }
    }
}

/// Leave table instruction data (AC-3.3: credit player, debit vault)
/// Accounts:
///   0. [writable] Table
///   1. [writable] Vault token account
///   2. [writable] Player token account
///   3. [signer] Player
///   4. [] Config
///   5. [] Token-2022 program
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct LeaveTable {
    pub discriminator: u8,
}

impl LeaveTable {
    pub const SIZE: usize = 1;

    /// Parse from instruction data
    ///
    /// # Safety
    /// Caller must ensure data.len() >= SIZE
    #[inline]
    pub unsafe fn from_bytes_unchecked(data: &[u8]) -> &Self {
        unsafe { &*(data.as_ptr() as *const Self) }
    }
}

/// Start hand instruction data (AC-4.3, AC-2.6, AC-2.7)
///
/// Includes seed commitment and hole card hashes for privacy hybrid flow.
/// The provider commits sha256(seed), and hole_card_hashes[i] = sha256(card1||card2)
/// for each active seat derived from shuffle_with_seed(seed).
///
/// Accounts:
///   0. [writable] Table
///   1. [signer] Provider (entropy provider)
///   2. [] Config
///   3. [] Clock sysvar (for action deadline calculation)
///   4. [] Entropy program
///   5. [] Entropy config
///   6. [] Entropy commitment
///   7. [writable] Entropy request
///   8. [] SlotHashes sysvar
///   9. [] System program
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct StartHand {
    pub discriminator: u8,
    /// Padding for alignment
    pub _padding: [u8; 7],
    /// SHA256 hash of the deck seed (AC-2.7: provider commits before deal)
    pub seed_commitment: [u8; 32],
    /// SHA256(card1_u8 || card2_u8) for each seat (AC-2.6: hole card privacy)
    /// Zero for empty seats or seats not in the hand
    pub hole_card_hashes: [[u8; 32]; 10],
}

impl StartHand {
    pub const SIZE: usize = core::mem::size_of::<Self>();

    /// Parse from instruction data
    ///
    /// # Safety
    /// Caller must ensure data.len() >= SIZE
    #[inline]
    pub unsafe fn from_bytes_unchecked(data: &[u8]) -> &Self {
        unsafe { &*(data.as_ptr() as *const Self) }
    }
}

/// Timeout action instruction data (AC-4.4: deterministic fallback action)
/// Accounts:
///   0. [writable] Table
///   1. [] Config
///   2. [] Clock sysvar (for current slot verification)
///
/// Anyone can call this to enforce timeout; the program verifies
/// the deadline has passed and applies the deterministic fallback (fold/check).
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct TimeoutAction {
    pub discriminator: u8,
}

impl TimeoutAction {
    pub const SIZE: usize = 1;

    /// Parse from instruction data
    ///
    /// # Safety
    /// Caller must ensure data.len() >= SIZE
    #[inline]
    pub unsafe fn from_bytes_unchecked(data: &[u8]) -> &Self {
        unsafe { &*(data.as_ptr() as *const Self) }
    }
}

/// Player action types for betting rounds (AC-5.1, AC-5.2)
pub mod action_type {
    /// Fold - give up the hand
    pub const FOLD: u8 = 0;
    /// Check - pass when no bet to call
    pub const CHECK: u8 = 1;
    /// Call - match the current bet
    pub const CALL: u8 = 2;
    /// Raise - increase the bet (amount field specifies total raise to)
    pub const RAISE: u8 = 3;
    /// All-in - put all remaining chips in
    pub const ALL_IN: u8 = 4;
}

/// Player action instruction data (AC-5.1, AC-5.2, AC-5.3)
/// Accounts:
///   0. [writable] Table
///   1. [signer] Player
///   2. [] Config
///   3. [] Clock sysvar (for deadline reset)
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct PlayerAction {
    pub discriminator: u8,
    /// Action type (fold, check, call, raise, all-in)
    pub action_type: u8,
    /// Padding for alignment
    pub _padding: [u8; 6],
    /// Amount for raise actions (ignored for fold/check/call/all-in)
    /// For raise: this is the total amount to raise TO (not the raise increment)
    pub amount: u64,
}

impl PlayerAction {
    pub const SIZE: usize = core::mem::size_of::<Self>();

    /// Parse from instruction data
    ///
    /// # Safety
    /// Caller must ensure data.len() >= SIZE
    #[inline]
    pub unsafe fn from_bytes_unchecked(data: &[u8]) -> &Self {
        unsafe { &*(data.as_ptr() as *const Self) }
    }
}

/// Settle instruction data (AC-6.1, AC-6.2: showdown and payout)
/// Accounts:
///   0. [writable] Table
///   1. [] Config
///
/// This instruction settles the hand by:
/// 1. Deriving the deck from the revealed seed
/// 2. Evaluating hand strengths for all active (non-folded) players
/// 3. Computing side pots based on varying total_bet amounts
/// 4. Distributing winnings to each player's stack
/// 5. Resetting hand state for next hand
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct Settle {
    pub discriminator: u8,
}

impl Settle {
    pub const SIZE: usize = 1;

    /// Parse from instruction data
    ///
    /// # Safety
    /// Caller must ensure data.len() >= SIZE
    #[inline]
    pub unsafe fn from_bytes_unchecked(data: &[u8]) -> &Self {
        unsafe { &*(data.as_ptr() as *const Self) }
    }
}

/// Reveal seed instruction data (AC-2.7, AC-2.8: seed reveal and deck verification)
///
/// Provider reveals the 32-byte seed that was committed at hand start.
/// The program verifies:
/// 1. sha256(seed) == table.seed_commitment
/// 2. For each active seat, the hole cards derived from shuffle_with_seed(seed)
///    match the committed hole_card_hashes
///
/// This instruction must be called before Settle when there's a showdown.
///
/// Accounts:
///   0. [writable] Table
///   1. [signer] Provider (who committed the seed)
///   2. [] Config
///   3. [] Entropy program
///   4. [] Entropy config
///   5. [] Entropy commitment
///   6. [writable] Entropy request
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct RevealSeed {
    pub discriminator: u8,
    /// Padding for alignment
    pub _padding: [u8; 7],
    /// The preimage seed (reveals seed_commitment)
    pub seed: [u8; 32],
    /// Revealed hole cards for each seat (AC-2.8: must match derived deck order)
    /// Each entry is [card1_u8, card2_u8] where cards are 0-51 indices
    /// Zero for empty/folded seats
    pub revealed_hole_cards: [[u8; 2]; 10],
}

impl RevealSeed {
    pub const SIZE: usize = core::mem::size_of::<Self>();

    /// Parse from instruction data
    ///
    /// # Safety
    /// Caller must ensure data.len() >= SIZE
    #[inline]
    pub unsafe fn from_bytes_unchecked(data: &[u8]) -> &Self {
        unsafe { &*(data.as_ptr() as *const Self) }
    }
}

/// Initialize staking pool instruction data (AC-3.5)
///
/// Creates the global staking pool with associated vaults.
///
/// Accounts:
///   0. [writable] Staking pool PDA
///   1. [writable] Stake vault token account PDA
///   2. [writable] Rewards vault token account PDA
///   3. [signer, writable] Payer (authority)
///   4. [] Config
///   5. [] CRISPS mint
///   6. [] Token-2022 program
///   7. [] System program
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct InitStakingPool {
    pub discriminator: u8,
}

impl InitStakingPool {
    pub const SIZE: usize = 1;

    /// Parse from instruction data
    ///
    /// # Safety
    /// Caller must ensure data.len() >= SIZE
    #[inline]
    pub unsafe fn from_bytes_unchecked(data: &[u8]) -> &Self {
        unsafe { &*(data.as_ptr() as *const Self) }
    }
}

/// Deposit stake instruction data (AC-3.5)
///
/// Stakers deposit CRISPS into the staking pool to earn rewards.
///
/// Accounts:
///   0. [writable] Staking pool PDA
///   1. [writable] Staker position PDA (may be created)
///   2. [writable] Stake vault token account
///   3. [writable] Staker's token account
///   4. [signer] Staker
///   5. [] Config
///   6. [] Token-2022 program
///   7. [] System program
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct DepositStake {
    pub discriminator: u8,
    /// Padding for alignment
    pub _padding: [u8; 7],
    /// Amount of CRISPS to stake
    pub amount: u64,
}

impl DepositStake {
    pub const SIZE: usize = core::mem::size_of::<Self>();

    /// Parse from instruction data
    ///
    /// # Safety
    /// Caller must ensure data.len() >= SIZE
    #[inline]
    pub unsafe fn from_bytes_unchecked(data: &[u8]) -> &Self {
        unsafe { &*(data.as_ptr() as *const Self) }
    }
}

/// Withdraw stake instruction data (AC-3.5)
///
/// Stakers withdraw their deposited CRISPS from the staking pool.
///
/// Accounts:
///   0. [writable] Staking pool PDA
///   1. [writable] Staker position PDA
///   2. [writable] Stake vault token account
///   3. [writable] Staker's token account
///   4. [signer] Staker
///   5. [] Config
///   6. [] Token-2022 program
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct WithdrawStake {
    pub discriminator: u8,
    /// Padding for alignment
    pub _padding: [u8; 7],
    /// Amount of CRISPS to unstake
    pub amount: u64,
}

impl WithdrawStake {
    pub const SIZE: usize = core::mem::size_of::<Self>();

    /// Parse from instruction data
    ///
    /// # Safety
    /// Caller must ensure data.len() >= SIZE
    #[inline]
    pub unsafe fn from_bytes_unchecked(data: &[u8]) -> &Self {
        unsafe { &*(data.as_ptr() as *const Self) }
    }
}

/// Claim rewards instruction data (AC-3.6)
///
/// Stakers claim their proportional share of accumulated rake rewards.
///
/// Accounts:
///   0. [writable] Staking pool PDA
///   1. [writable] Staker position PDA
///   2. [writable] Rewards vault token account
///   3. [writable] Staker's token account
///   4. [signer] Staker
///   5. [] Config
///   6. [] Token-2022 program
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct ClaimRewards {
    pub discriminator: u8,
}

impl ClaimRewards {
    pub const SIZE: usize = 1;

    /// Parse from instruction data
    ///
    /// # Safety
    /// Caller must ensure data.len() >= SIZE
    #[inline]
    pub unsafe fn from_bytes_unchecked(data: &[u8]) -> &Self {
        unsafe { &*(data.as_ptr() as *const Self) }
    }
}

/// Sweep rake instruction data (AC-3.4)
///
/// Transfers accumulated rake from a table vault to the staking pool rewards vault.
/// Anyone can call this permissionlessly to sweep rake.
///
/// Accounts:
///   0. [writable] Table
///   1. [writable] Table vault token account
///   2. [writable] Staking pool PDA
///   3. [writable] Rewards vault token account
///   4. [] Config
///   5. [] Token-2022 program
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct SweepRake {
    pub discriminator: u8,
}

impl SweepRake {
    pub const SIZE: usize = 1;

    /// Parse from instruction data
    ///
    /// # Safety
    /// Caller must ensure data.len() >= SIZE
    #[inline]
    pub unsafe fn from_bytes_unchecked(data: &[u8]) -> &Self {
        unsafe { &*(data.as_ptr() as *const Self) }
    }
}

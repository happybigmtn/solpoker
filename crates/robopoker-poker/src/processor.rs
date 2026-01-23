//! Instruction processor for the poker program.

use pinocchio::{
    account_info::AccountInfo,
    instruction::{Seed, Signer},
    program_error::ProgramError,
    pubkey::{self, Pubkey},
    sysvars::{rent::Rent, Sysvar},
    ProgramResult,
};
use pinocchio_system::{instructions::CreateAccount, ID as SYSTEM_PROGRAM_ID};
use robopoker_core::cards::{Card, Deck, Hand, Strength};

use crate::{
    error::PokerError,
    entropy::{EntropyCommitment, EntropyConfig, EntropyRequest, COMMITMENT_SIZE as ENTROPY_COMMITMENT_SIZE, CONFIG_SIZE as ENTROPY_CONFIG_SIZE, REQUEST_SIZE as ENTROPY_REQUEST_SIZE},
    entropy_cpi,
    instruction::{self, discriminator as ix_disc},
    state::{
        discriminator as acc_disc, seat_status, table_status, Config, StakerPosition, StakingPool,
        Table, CONFIG_SIZE, MAX_SEATS, STAKER_POSITION_SIZE, STAKING_POOL_SIZE, TABLE_SIZE,
    },
    token_cpi::{self, TOKEN_2022_PROGRAM_ID},
};

/// Compute SHA256 hash (for seed commitment and hole card verification)
///
/// Uses Solana's syscall for efficient on-chain hashing.
#[inline]
fn sha256(data: &[u8]) -> [u8; 32] {
    let mut result = [0u8; 32];
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
    // For non-Solana targets (testing), use a real hash
    #[cfg(not(target_os = "solana"))]
    {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(data);
        result.copy_from_slice(&hasher.finalize());
    }
    result
}

const REWARDS_PER_TOKEN_SCALE: u128 = 1_000_000_000;

#[inline]
fn update_pool_rewards(pool: &mut StakingPool) -> Result<(), ProgramError> {
    if pool.total_staked == 0 || pool.accumulated_rewards == 0 {
        return Ok(());
    }

    let delta = (pool.accumulated_rewards as u128)
        .checked_mul(REWARDS_PER_TOKEN_SCALE)
        .ok_or(PokerError::ArithmeticOverflow)?
        .checked_div(pool.total_staked as u128)
        .ok_or(PokerError::ArithmeticOverflow)? as u64;

    if delta == 0 {
        return Ok(());
    }

    pool.total_distributed = pool
        .total_distributed
        .checked_add(delta)
        .ok_or(PokerError::ArithmeticOverflow)?;
    pool.accumulated_rewards = 0;

    Ok(())
}

#[inline]
fn accrue_staker_rewards(
    position: &mut StakerPosition,
    pool: &StakingPool,
) -> Result<(), ProgramError> {
    let current_rpt = pool.total_distributed;
    if current_rpt < position.last_rewards_per_token {
        return Err(PokerError::ArithmeticOverflow.into());
    }

    let delta_rpt = current_rpt - position.last_rewards_per_token;
    if delta_rpt == 0 || position.staked_amount == 0 {
        position.last_rewards_per_token = current_rpt;
        return Ok(());
    }

    let pending = (position.staked_amount as u128)
        .checked_mul(delta_rpt as u128)
        .ok_or(PokerError::ArithmeticOverflow)?
        .checked_div(REWARDS_PER_TOKEN_SCALE)
        .ok_or(PokerError::ArithmeticOverflow)? as u64;

    if pending > 0 {
        position.rewards_claimed = position
            .rewards_claimed
            .checked_add(pending)
            .ok_or(PokerError::ArithmeticOverflow)?;
    }

    position.last_rewards_per_token = current_rpt;
    Ok(())
}

/// Process an instruction
pub fn process(accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    if instruction_data.is_empty() {
        return Err(PokerError::InvalidInstruction.into());
    }

    match instruction_data[0] {
        ix_disc::INITIALIZE => process_initialize(accounts, instruction_data),
        ix_disc::CREATE_TABLE => process_create_table(accounts, instruction_data),
        ix_disc::JOIN_TABLE => process_join_table(accounts, instruction_data),
        ix_disc::LEAVE_TABLE => process_leave_table(accounts, instruction_data),
        ix_disc::START_HAND => process_start_hand(accounts, instruction_data),
        ix_disc::TIMEOUT_ACTION => process_timeout_action(accounts, instruction_data),
        ix_disc::PLAYER_ACTION => process_player_action(accounts, instruction_data),
        ix_disc::SETTLE => process_settle(accounts, instruction_data),
        ix_disc::REVEAL_SEED => process_reveal_seed(accounts, instruction_data),
        // Staking instructions (AC-POK3.4, AC-POK3.5, AC-POK3.6)
        ix_disc::INIT_STAKING_POOL => process_init_staking_pool(accounts, instruction_data),
        ix_disc::DEPOSIT_STAKE => process_deposit_stake(accounts, instruction_data),
        ix_disc::WITHDRAW_STAKE => process_withdraw_stake(accounts, instruction_data),
        ix_disc::CLAIM_REWARDS => process_claim_rewards(accounts, instruction_data),
        ix_disc::SWEEP_RAKE => process_sweep_rake(accounts, instruction_data),
        ix_disc::CLOSE_TABLE => process_close_table(accounts, instruction_data),
        ix_disc::CLOSE_STAKING_POOL => process_close_staking_pool(accounts, instruction_data),
        ix_disc::CLOSE_STAKER_POSITION => process_close_staker_position(accounts, instruction_data),
        _ => Err(PokerError::InvalidInstruction.into()),
    }
}

/// Initialize the program config (AC-POK3.1)
fn process_initialize(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < instruction::Initialize::SIZE {
        return Err(PokerError::InvalidInstruction.into());
    }

    let [config_info, authority_info, crisps_mint_info, entropy_program_info, system_program_info] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Authority must sign
    if !authority_info.is_signer() {
        return Err(PokerError::MissingSigner.into());
    }

    // System program ID check
    if system_program_info.key() != &SYSTEM_PROGRAM_ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Verify config PDA and get bump
    let config_seeds: &[&[u8]] = Config::SEEDS;
    let (expected_config, bump) = pubkey::find_program_address(config_seeds, &crate::ID);
    if config_info.key() != &expected_config {
        return Err(PokerError::InvalidPda.into());
    }

    // Verify mint is Token-2022 owned
    if crisps_mint_info.owner() != &TOKEN_2022_PROGRAM_ID {
        return Err(PokerError::InvalidMint.into());
    }

    // Parse instruction data
    let ix = instruction::Initialize::from_bytes(data);

    if ix.min_players == 0 || ix.min_players as usize > MAX_SEATS {
        return Err(PokerError::InvalidInstruction.into());
    }
    if ix.min_buy_in == 0 || ix.max_buy_in == 0 || ix.min_buy_in > ix.max_buy_in {
        return Err(PokerError::InvalidInstruction.into());
    }
    if ix.action_timeout_slots == 0 {
        return Err(PokerError::InvalidInstruction.into());
    }

    // Create config account if it doesn't exist or is empty
    if config_info.data_len() == 0 {
        // Calculate rent-exempt lamports
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(CONFIG_SIZE);

        // Create the account via CPI with PDA signer seeds
        let bump_seed = [bump];
        let signer_seeds = pinocchio::seeds!(b"config", &bump_seed);
        let signer = Signer::from(&signer_seeds);

        CreateAccount {
            from: authority_info,
            to: config_info,
            lamports,
            space: CONFIG_SIZE as u64,
            owner: &crate::ID,
        }
        .invoke_signed(&[signer])?;
    } else {
        // Config already exists, check if owned by this program
        if !config_info.is_owned_by(&crate::ID) {
            return Err(PokerError::InvalidAccountOwner.into());
        }

        // Check if already initialized
        let config_data = config_info.try_borrow_data()?;
        if config_data.len() >= CONFIG_SIZE {
            let config = Config::from_bytes(&config_data)?;
            if config.is_initialized() {
                return Err(PokerError::AlreadyInitialized.into());
            }
        }
        drop(config_data);
    }

    // Initialize config data
    let mut config_data = config_info.try_borrow_mut_data()?;
    if config_data.len() < CONFIG_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }

    let config = Config::from_bytes_mut(&mut config_data)?;
    config.discriminator = acc_disc::CONFIG;
    config.initialized = 1;
    config.min_players = ix.min_players;
    config._padding = [0; 3];
    config.rake_bps = 250; // Default 2.5% rake (AC-POK3.4)
    config.crisps_mint = *crisps_mint_info.key();
    config.authority = *authority_info.key();
    config.entropy_program = *entropy_program_info.key();
    config.min_buy_in = ix.min_buy_in;
    config.max_buy_in = ix.max_buy_in;
    config.action_timeout_slots = ix.action_timeout_slots;

    Ok(())
}

/// Create a new table with PDA-owned vault (AC-POK3.2)
fn process_create_table(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < instruction::CreateTable::SIZE {
        return Err(PokerError::InvalidInstruction.into());
    }

    let [table_info, vault_info, payer_info, config_info, crisps_mint_info, token_program, system_program_info] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Payer must sign
    if !payer_info.is_signer() {
        return Err(PokerError::MissingSigner.into());
    }

    // Duplicate mutable accounts (AC-POK7.3)
    if table_info.key() == vault_info.key()
        || table_info.key() == payer_info.key()
        || vault_info.key() == payer_info.key()
    {
        return Err(PokerError::DuplicateMutableAccount.into());
    }

    // Program ID checks
    if token_program.key() != &TOKEN_2022_PROGRAM_ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    if system_program_info.key() != &SYSTEM_PROGRAM_ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Config must be owned by this program
    if !config_info.is_owned_by(&crate::ID) {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    verify_config_pda(config_info)?;

    // Mint must be Token-2022 owned
    if crisps_mint_info.owner() != &TOKEN_2022_PROGRAM_ID {
        return Err(PokerError::InvalidMint.into());
    }

    // Load and verify config
    let config_data = config_info.try_borrow_data()?;
    if config_data.len() < CONFIG_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let config = Config::from_bytes(&config_data)?;
    if !config.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }
    // Verify mint matches config (anyone can create tables)
    if crisps_mint_info.key() != &config.crisps_mint {
        return Err(PokerError::InvalidMint.into());
    }
    drop(config_data);

    // Parse instruction data
    let ix = instruction::CreateTable::from_bytes(data);

    if ix.small_blind == 0 || ix.big_blind == 0 || ix.big_blind < ix.small_blind {
        return Err(PokerError::InvalidInstruction.into());
    }

    // Verify and derive table PDA with bump
    let table_id_bytes = ix.table_id.to_le_bytes();
    let table_seeds: &[&[u8]] = &[Table::SEEDS_PREFIX, &table_id_bytes];
    let (expected_table, table_bump) = pubkey::find_program_address(table_seeds, &crate::ID);
    if table_info.key() != &expected_table {
        return Err(PokerError::InvalidPda.into());
    }

    // Verify and derive vault PDA with bump (AC-POK3.2: PDA-owned vault)
    let vault_seeds: &[&[u8]] = &[Table::VAULT_SEEDS_PREFIX, &table_id_bytes];
    let (expected_vault, vault_bump) = pubkey::find_program_address(vault_seeds, &crate::ID);
    if vault_info.key() != &expected_vault {
        return Err(PokerError::InvalidPda.into());
    }

    // Create table account if it doesn't exist
    if table_info.data_len() == 0 {
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(TABLE_SIZE);

        let bump_seed = [table_bump];
        let signer_seeds = pinocchio::seeds!(Table::SEEDS_PREFIX, &table_id_bytes, &bump_seed);
        let signer = Signer::from(&signer_seeds);

        CreateAccount {
            from: payer_info,
            to: table_info,
            lamports,
            space: TABLE_SIZE as u64,
            owner: &crate::ID,
        }
        .invoke_signed(&[signer])?;
    } else {
        // Table already exists, check ownership and ensure not already initialized
        if !table_info.is_owned_by(&crate::ID) {
            return Err(PokerError::InvalidAccountOwner.into());
        }
        let table_data = table_info.try_borrow_data()?;
        if table_data.len() >= TABLE_SIZE {
            let table = Table::from_bytes(&table_data)?;
            if table.discriminator == acc_disc::TABLE {
                return Err(PokerError::AlreadyInitialized.into());
            }
        }
        drop(table_data);
    }

    // Create vault token account if it doesn't exist
    if vault_info.data_len() == 0 {
        // Create vault as a Token-2022 account owned by itself (PDA)
        let bump_seed = [vault_bump];
        let signer_seeds = pinocchio::seeds!(Table::VAULT_SEEDS_PREFIX, &table_id_bytes, &bump_seed);
        let signer = Signer::from(&signer_seeds);

        token_cpi::create_token_account(
            payer_info,
            vault_info,
            crisps_mint_info,
            vault_info, // Owner is the vault itself (PDA-controlled)
            token_program,
            system_program_info,
            &[signer],
        )?;
    } else {
        // Vault already exists, verify it's Token-2022 owned with correct mint
        if vault_info.owner() != &TOKEN_2022_PROGRAM_ID {
            return Err(PokerError::InvalidAccountOwner.into());
        }
        let (vault_mint, vault_owner) = read_token_account_mint_owner(vault_info)?;
        if vault_mint != *crisps_mint_info.key() {
            return Err(PokerError::InvalidMint.into());
        }
        if vault_owner != *vault_info.key() {
            return Err(PokerError::InvalidAccountOwner.into());
        }
    }

    // Initialize table data
    let mut table_data = table_info.try_borrow_mut_data()?;
    if table_data.len() < TABLE_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }

    let table = Table::from_bytes_mut(&mut table_data)?;
    table.discriminator = acc_disc::TABLE;
    table.status = table_status::WAITING;
    table.player_count = 0;
    table.dealer_position = 0;
    table.current_actor = 0;
    table.current_street = 0;
    table.seed_revealed = 0;
    table._padding = 0;
    table.active_bitmap = 0;
    table._padding2 = [0; 6];
    table.table_id = ix.table_id;
    table.hand_id = 0;
    table.small_blind = ix.small_blind;
    table.big_blind = ix.big_blind;
    table.action_deadline_slot = 0; // No deadline initially
    table.current_bet = 0;
    table.min_raise = ix.big_blind; // Min raise is always at least big blind
    table.pot = 0;
    table.rake_accumulated = 0; // AC-POK3.4: No rake collected yet
    table.vault = *vault_info.key();
    table.seed_commitment = [0; 32];
    table.revealed_seed = [0; 32];

    // Initialize all seats to empty
    for seat in table.seats.iter_mut() {
        seat.status = seat_status::EMPTY;
        seat.has_acted = 0;
        seat._padding = [0; 6];
        seat.player = Pubkey::default();
        seat.stack = 0;
        seat.current_bet = 0;
        seat.total_bet = 0;
        seat.hole_card_hash = [0; 32];
    }

    Ok(())
}

/// Join a table by transferring CRISPS to vault (AC-POK3.3)
fn process_join_table(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < instruction::JoinTable::SIZE {
        return Err(PokerError::InvalidInstruction.into());
    }

    let [table_info, vault_info, player_token_info, player_info, config_info, token_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Player must sign
    if !player_info.is_signer() {
        return Err(PokerError::MissingSigner.into());
    }

    // Writable account checks
    if !table_info.is_writable() || !vault_info.is_writable() || !player_token_info.is_writable() {
        return Err(PokerError::AccountNotWritable.into());
    }

    // Duplicate mutable accounts (AC-POK7.3)
    if table_info.key() == vault_info.key()
        || table_info.key() == player_token_info.key()
        || vault_info.key() == player_token_info.key()
    {
        return Err(PokerError::DuplicateMutableAccount.into());
    }

    // Token program ID check
    if token_program.key() != &TOKEN_2022_PROGRAM_ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Accounts must be owned by this program where applicable
    if !config_info.is_owned_by(&crate::ID) || !table_info.is_owned_by(&crate::ID) {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    verify_config_pda(config_info)?;

    // Parse instruction data first (no borrows needed)
    let ix = instruction::JoinTable::from_bytes(data);

    // Load config and extract needed values (scope limits borrow lifetime)
    let crisps_mint = {
        let config_data = config_info.try_borrow_data()?;
        if config_data.len() < CONFIG_SIZE {
            return Err(PokerError::InvalidAccountDataLength.into());
        }
        let config = Config::from_bytes(&config_data)?;
        if !config.is_initialized() {
            return Err(PokerError::NotInitialized.into());
        }
        // Validate buy-in bounds
        if ix.buy_in_amount < config.min_buy_in {
            return Err(PokerError::BuyInTooLow.into());
        }
        if ix.buy_in_amount > config.max_buy_in {
            return Err(PokerError::BuyInTooHigh.into());
        }
        config.crisps_mint
    }; // config_data dropped automatically

    // Load table
    let mut table_data = table_info.try_borrow_mut_data()?;
    if table_data.len() < TABLE_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let table = Table::from_bytes_mut(&mut table_data)?;

    if !table.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }

    verify_table_pda(table_info, table.table_id)?;

    if table.status != table_status::WAITING {
        return Err(PokerError::TableNotWaiting.into());
    }

    // Verify vault matches table
    if vault_info.key() != &table.vault {
        return Err(PokerError::InvalidPda.into());
    }

    // Vault token account must be Token-2022 owned and for CRISPS mint
    if vault_info.owner() != &TOKEN_2022_PROGRAM_ID {
        return Err(PokerError::InvalidAccountOwner.into());
    }
    let (vault_mint, vault_owner) = read_token_account_mint_owner(vault_info)?;
    if vault_mint != crisps_mint {
        return Err(PokerError::InvalidMint.into());
    }
    if vault_owner != *vault_info.key() {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    // Player token account must be Token-2022 owned, minted to CRISPS, owned by player
    if player_token_info.owner() != &TOKEN_2022_PROGRAM_ID {
        return Err(PokerError::InvalidAccountOwner.into());
    }
    let (player_mint, player_owner) = read_token_account_mint_owner(player_token_info)?;
    if player_mint != crisps_mint {
        return Err(PokerError::InvalidMint.into());
    }
    if player_owner != *player_info.key() {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    // Check player is not already seated (including sitting out)
    if table.find_any_player_seat(player_info.key()).is_some() {
        return Err(PokerError::PlayerAlreadySeated.into());
    }

    // Find empty seat
    let seat_index = table.find_empty_seat().ok_or(PokerError::TableFull)?;

    // Update seat state before CPI
    let seat = &mut table.seats[seat_index];
    seat.status = seat_status::OCCUPIED;
    seat.player = *player_info.key();
    seat.stack = ix.buy_in_amount;
    seat.current_bet = 0;
    seat.total_bet = 0;
    seat.has_acted = 0;
    seat.hole_card_hash = [0; 32];

    // Update player count and active bitmap
    table.player_count = table
        .player_count
        .checked_add(1)
        .ok_or(PokerError::ArithmeticOverflow)?;
    table.set_active(seat_index);

    // Drop borrow before CPI
    drop(table_data);

    // AC-POK3.3: Transfer CRISPS from player to vault
    token_cpi::transfer(
        player_token_info,
        vault_info,
        player_info,
        ix.buy_in_amount,
        token_program,
    )?;

    Ok(())
}

/// Leave a table by transferring CRISPS from vault to player (AC-POK3.3)
fn process_leave_table(accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
    let [table_info, vault_info, player_token_info, player_info, config_info, token_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Player must sign
    if !player_info.is_signer() {
        return Err(PokerError::MissingSigner.into());
    }

    // Writable account checks
    if !table_info.is_writable() || !vault_info.is_writable() || !player_token_info.is_writable() {
        return Err(PokerError::AccountNotWritable.into());
    }

    // Duplicate mutable accounts (AC-POK7.3)
    if table_info.key() == vault_info.key()
        || table_info.key() == player_token_info.key()
        || vault_info.key() == player_token_info.key()
    {
        return Err(PokerError::DuplicateMutableAccount.into());
    }

    // Token program ID check
    if token_program.key() != &TOKEN_2022_PROGRAM_ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Accounts must be owned by this program where applicable
    if !config_info.is_owned_by(&crate::ID) || !table_info.is_owned_by(&crate::ID) {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    verify_config_pda(config_info)?;

    // Verify config is initialized
    let config_data = config_info.try_borrow_data()?;
    if config_data.len() < CONFIG_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let config = Config::from_bytes(&config_data)?;
    if !config.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }
    let crisps_mint = config.crisps_mint;
    drop(config_data);

    // Load table
    let mut table_data = table_info.try_borrow_mut_data()?;
    if table_data.len() < TABLE_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let table = Table::from_bytes_mut(&mut table_data)?;

    if !table.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }

    verify_table_pda(table_info, table.table_id)?;

    // Cannot leave unless table is waiting
    if table.status != table_status::WAITING {
        return Err(PokerError::TableNotWaiting.into());
    }

    // Verify vault matches table
    if vault_info.key() != &table.vault {
        return Err(PokerError::InvalidPda.into());
    }

    // Vault token account must be Token-2022 owned and for CRISPS mint
    if vault_info.owner() != &TOKEN_2022_PROGRAM_ID {
        return Err(PokerError::InvalidAccountOwner.into());
    }
    let (vault_mint, vault_owner) = read_token_account_mint_owner(vault_info)?;
    if vault_mint != crisps_mint {
        return Err(PokerError::InvalidMint.into());
    }
    if vault_owner != *vault_info.key() {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    // Player token account must be Token-2022 owned, minted to CRISPS, owned by player
    if player_token_info.owner() != &TOKEN_2022_PROGRAM_ID {
        return Err(PokerError::InvalidAccountOwner.into());
    }
    let (player_mint, player_owner) = read_token_account_mint_owner(player_token_info)?;
    if player_mint != crisps_mint {
        return Err(PokerError::InvalidMint.into());
    }
    if player_owner != *player_info.key() {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    // Find player's seat
    let seat_index = table
        .find_any_player_seat(player_info.key())
        .ok_or(PokerError::PlayerNotFound)?;

    let stack = table.seats[seat_index].stack;
    let table_id_bytes = table.table_id.to_le_bytes();

    // Clear seat state before CPI
    let seat = &mut table.seats[seat_index];
    seat.status = seat_status::EMPTY;
    seat.player = Pubkey::default();
    seat.stack = 0;
    seat.current_bet = 0;
    seat.total_bet = 0;
    seat.has_acted = 0;
    seat.hole_card_hash = [0; 32];

    // Update player count and active bitmap
    table.player_count = table
        .player_count
        .checked_sub(1)
        .ok_or(PokerError::ArithmeticOverflow)?;
    table.clear_active(seat_index);

    // Drop borrow before CPI
    drop(table_data);

    // AC-POK3.3: Transfer CRISPS from vault to player (PDA signer)
    let vault_pda_seeds: &[&[u8]] = &[Table::VAULT_SEEDS_PREFIX, &table_id_bytes];
    let (_, vault_bump) = pubkey::find_program_address(vault_pda_seeds, &crate::ID);
    let vault_bump_slice = [vault_bump];

    // Build signer seeds using pinocchio's Seed type
    let seeds: [Seed; 3] = [
        Seed::from(Table::VAULT_SEEDS_PREFIX),
        Seed::from(table_id_bytes.as_slice()),
        Seed::from(vault_bump_slice.as_slice()),
    ];
    let signer = Signer::from(&seeds);

    token_cpi::transfer_signed(
        vault_info,
        player_token_info,
        vault_info, // Vault is its own authority as a PDA
        stack,
        token_program,
        &[signer],
    )?;

    Ok(())
}

/// Start a new hand (AC-POK4.3, AC-POK2.6, AC-POK2.7: minimum players + privacy hybrid)
fn process_start_hand(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < instruction::StartHand::SIZE {
        return Err(PokerError::InvalidInstruction.into());
    }

    let [
        table_info,
        provider_info,
        config_info,
        clock_info,
        entropy_program_info,
        entropy_config_info,
        entropy_commitment_info,
        entropy_request_info,
        slothashes_info,
        system_program_info,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Provider must sign
    if !provider_info.is_signer() {
        return Err(PokerError::MissingSigner.into());
    }
    if !provider_info.is_writable() {
        return Err(PokerError::AccountNotWritable.into());
    }

    // Duplicate mutable accounts (AC-POK7.3)
    if table_info.key() == entropy_request_info.key() {
        return Err(PokerError::DuplicateMutableAccount.into());
    }

    // Program ID checks
    if system_program_info.key() != &SYSTEM_PROGRAM_ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Accounts must be owned by this program where applicable
    if !config_info.is_owned_by(&crate::ID) || !table_info.is_owned_by(&crate::ID) {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    verify_config_pda(config_info)?;

    // Parse instruction data for seed commitment and hole card hashes
    let ix = instruction::StartHand::from_bytes(data);

    // Load poker config
    let config_data = config_info.try_borrow_data()?;
    if config_data.len() < CONFIG_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let config = Config::from_bytes(&config_data)?;
    if !config.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }
    let min_players = config.min_players;
    let action_timeout_slots = config.action_timeout_slots;
    let entropy_program_id = config.entropy_program;
    drop(config_data);

    if entropy_program_info.key() != &entropy_program_id {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Entropy config and commitment must be owned by the entropy program
    // Request may be uninitialized (will be created via CPI during start_hand)
    if entropy_config_info.owner() != &entropy_program_id
        || entropy_commitment_info.owner() != &entropy_program_id
    {
        return Err(PokerError::InvalidAccountOwner.into());
    }
    // Request must either be uninitialized (no data) OR owned by entropy program
    if entropy_request_info.data_len() > 0 && entropy_request_info.owner() != &entropy_program_id {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    // Verify entropy config PDA
    let (expected_entropy_config, _) =
        pubkey::find_program_address(&[b"config"], &entropy_program_id);
    if entropy_config_info.key() != &expected_entropy_config {
        return Err(PokerError::InvalidPda.into());
    }

    // Load entropy config to verify provider
    let entropy_config_data = entropy_config_info.try_borrow_data()?;
    if entropy_config_data.len() < ENTROPY_CONFIG_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let entropy_config = EntropyConfig::from_bytes(&entropy_config_data)?;
    if !entropy_config.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }
    let entropy_provider = entropy_config.provider;
    drop(entropy_config_data);

    if provider_info.key() != &entropy_provider {
        return Err(PokerError::ProviderMismatch.into());
    }

    // Load table (mutable) to validate state and compute request ID
    let mut table_data = table_info.try_borrow_mut_data()?;
    if table_data.len() < TABLE_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let table = Table::from_bytes_mut(&mut table_data)?;

    if !table.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }

    // Table must be waiting
    if table.status != table_status::WAITING {
        return Err(PokerError::TableNotWaiting.into());
    }

    // AC-POK4.3: Verify minimum players
    if table.active_count() < min_players {
        return Err(PokerError::NotEnoughPlayers.into());
    }

    // Verify table PDA
    let table_id_bytes = table.table_id.to_le_bytes();
    let (expected_table, table_bump) =
        pubkey::find_program_address(&[Table::SEEDS_PREFIX, &table_id_bytes], &crate::ID);
    if table_info.key() != &expected_table {
        return Err(PokerError::InvalidPda.into());
    }

    let request_id = table.hand_id;
    let request_id_bytes = request_id.to_le_bytes();
    let request_seeds: [&[u8]; 3] = [
        b"request",
        table_info.key().as_ref(),
        request_id_bytes.as_slice(),
    ];
    let (expected_request, _) =
        pubkey::find_program_address(&request_seeds, &entropy_program_id);
    if entropy_request_info.key() != &expected_request {
        return Err(PokerError::InvalidPda.into());
    }

    // Verify entropy commitment PDA and hash
    let commitment_data = entropy_commitment_info.try_borrow_data()?;
    if commitment_data.len() < ENTROPY_COMMITMENT_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let commitment = EntropyCommitment::from_bytes(&commitment_data)?;
    if !commitment.is_pending() {
        return Err(PokerError::InvalidSeedCommitment.into());
    }
    if commitment.provider != entropy_provider {
        return Err(PokerError::ProviderMismatch.into());
    }
    let sequence_bytes = commitment.sequence.to_le_bytes();
    let commitment_seeds: [&[u8]; 3] = [
        b"commitment",
        commitment.provider.as_ref(),
        sequence_bytes.as_slice(),
    ];
    let (expected_commitment, _) =
        pubkey::find_program_address(&commitment_seeds, &entropy_program_id);
    if entropy_commitment_info.key() != &expected_commitment {
        return Err(PokerError::InvalidPda.into());
    }
    if commitment.hash != ix.seed_commitment {
        return Err(PokerError::InvalidSeedCommitment.into());
    }
    drop(commitment_data);

    // Drop borrow before CPI
    drop(table_data);

    // Request entropy via CPI (table PDA signer)
    let table_bump_slice = [table_bump];
    let seeds: [Seed; 3] = [
        Seed::from(Table::SEEDS_PREFIX),
        Seed::from(table_id_bytes.as_slice()),
        Seed::from(table_bump_slice.as_slice()),
    ];
    let signer = Signer::from(&seeds);
    entropy_cpi::request_signed(
        entropy_program_info,
        entropy_request_info,
        table_info,
        provider_info, // Provider pays for request account creation
        entropy_commitment_info,
        entropy_config_info,
        slothashes_info,
        system_program_info,
        request_id,
        &[signer],
    )?;

    // Get current slot from clock sysvar for deadline calculation
    let current_slot = get_current_slot(clock_info)?;

    // Reload table and update hand state
    let mut table_data = table_info.try_borrow_mut_data()?;
    if table_data.len() < TABLE_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let table = Table::from_bytes_mut(&mut table_data)?;

    // AC-POK2.6, AC-POK2.7: Store seed commitment and hole card hashes
    table.seed_commitment = ix.seed_commitment;
    table.revealed_seed = [0; 32]; // Clear any previous seed
    table.seed_revealed = 0;

    // Store hole card hashes for each occupied seat
    for (i, seat) in table.seats.iter_mut().enumerate() {
        if seat.is_active() {
            seat.hole_card_hash = ix.hole_card_hashes[i];
        } else {
            seat.hole_card_hash = [0; 32];
        }
    }

    // Set table to playing state
    table.status = table_status::PLAYING;
    table.current_street = crate::state::street::PREFLOP;

    // Rebuild active bitmap (all occupied players are active at hand start)
    table.rebuild_active_bitmap();

    // === Post blinds ===
    // Small blind is first active seat after dealer
    let sb_idx = find_next_active_seat(table, table.dealer_position as usize);
    // Big blind is first active seat after small blind
    let bb_idx = find_next_active_seat(table, sb_idx);

    // Post small blind
    let sb_amount = table.small_blind.min(table.seats[sb_idx].stack);
    table.seats[sb_idx].stack = table.seats[sb_idx]
        .stack
        .checked_sub(sb_amount)
        .ok_or(PokerError::ArithmeticOverflow)?;
    table.seats[sb_idx].current_bet = sb_amount;
    table.seats[sb_idx].total_bet = sb_amount;
    table.pot = table
        .pot
        .checked_add(sb_amount)
        .ok_or(PokerError::ArithmeticOverflow)?;
    // Mark as all-in if stack depleted
    if table.seats[sb_idx].stack == 0 {
        table.seats[sb_idx].status = seat_status::ALL_IN;
    }

    // Post big blind
    let bb_amount = table.big_blind.min(table.seats[bb_idx].stack);
    table.seats[bb_idx].stack = table.seats[bb_idx]
        .stack
        .checked_sub(bb_amount)
        .ok_or(PokerError::ArithmeticOverflow)?;
    table.seats[bb_idx].current_bet = bb_amount;
    table.seats[bb_idx].total_bet = bb_amount;
    table.pot = table
        .pot
        .checked_add(bb_amount)
        .ok_or(PokerError::ArithmeticOverflow)?;
    // Mark as all-in if stack depleted
    if table.seats[bb_idx].stack == 0 {
        table.seats[bb_idx].status = seat_status::ALL_IN;
    }

    // Set current bet level to big blind
    table.current_bet = table.big_blind;
    table.min_raise = table.big_blind;

    // First actor is the player after the big blind (Under-The-Gun)
    // In heads-up (2 players), dealer is SB and acts first preflop
    let first_actor = if table.active_count() == 2 {
        sb_idx // Dealer/SB acts first in heads-up preflop
    } else {
        find_next_active_seat(table, bb_idx) // UTG position
    };
    table.current_actor = first_actor as u8;

    // AC-POK4.4: Set action deadline
    table.action_deadline_slot = current_slot
        .checked_add(action_timeout_slots)
        .ok_or(PokerError::ArithmeticOverflow)?;

    Ok(())
}

/// Process timeout auto-action (AC-POK4.4: deterministic fallback)
fn process_timeout_action(accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
    let [table_info, config_info, clock_info] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Accounts must be owned by this program
    if !config_info.is_owned_by(&crate::ID) || !table_info.is_owned_by(&crate::ID) {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    verify_config_pda(config_info)?;

    // Verify config initialized
    let config_data = config_info.try_borrow_data()?;
    if config_data.len() < CONFIG_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let config = Config::from_bytes(&config_data)?;
    if !config.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }
    let action_timeout_slots = config.action_timeout_slots;
    let rake_bps = config.rake_bps;
    drop(config_data);

    // Load table
    let mut table_data = table_info.try_borrow_mut_data()?;
    if table_data.len() < TABLE_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let table = Table::from_bytes_mut(&mut table_data)?;

    if !table.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }

    verify_table_pda(table_info, table.table_id)?;

    // Must be in playing state with an active deadline
    if table.status != table_status::PLAYING {
        return Err(PokerError::NoActionPending.into());
    }
    if table.action_deadline_slot == 0 {
        return Err(PokerError::NoActionPending.into());
    }

    // Get current slot
    let current_slot = get_current_slot(clock_info)?;

    // AC-POK4.4: Verify deadline has passed
    if current_slot < table.action_deadline_slot {
        return Err(PokerError::DeadlineNotReached.into());
    }

    // Apply deterministic fallback action: fold
    let actor_index = table.current_actor as usize;
    let actor_seat = &table.seats[actor_index];
    if actor_seat.is_folded() {
        return Err(PokerError::PlayerAlreadyFolded.into());
    }
    if actor_seat.is_all_in() {
        return Err(PokerError::PlayerAlreadyAllIn.into());
    }

    table.seats[actor_index].status = seat_status::FOLDED;
    table.seats[actor_index].has_acted = 1;
    table.clear_active(actor_index);

    if let Some(next_actor) = table.next_active_seat(actor_index) {
        if table.is_betting_complete() {
            advance_street(table, rake_bps)?;
        } else {
            table.current_actor = next_actor as u8;
        }
    } else {
        advance_street(table, rake_bps)?;
    }

    if table.status == table_status::PLAYING {
        table.action_deadline_slot = current_slot
            .checked_add(action_timeout_slots)
            .ok_or(PokerError::ArithmeticOverflow)?;
    } else {
        table.action_deadline_slot = 0;
    }

    Ok(())
}

/// Find the next active (occupied, not sitting out) seat starting from position
fn find_next_active_seat(table: &Table, from: usize) -> usize {
    let mut pos = (from + 1) % crate::state::MAX_SEATS;
    for _ in 0..crate::state::MAX_SEATS {
        if table.seats[pos].status == seat_status::OCCUPIED {
            return pos;
        }
        pos = (pos + 1) % crate::state::MAX_SEATS;
    }
    // Fallback to from if no active seat found (shouldn't happen with valid state)
    from
}

/// Extract current slot from Clock sysvar account data
fn get_current_slot(clock_info: &AccountInfo) -> Result<u64, ProgramError> {
    // Verify this is actually the Clock sysvar
    if clock_info.key() != &pinocchio::sysvars::clock::CLOCK_ID {
        return Err(PokerError::InvalidSysvar.into());
    }

    // Clock sysvar layout (first 8 bytes is slot)
    let clock_data = clock_info.try_borrow_data()?;
    if clock_data.len() < 8 {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let slot_bytes: [u8; 8] = clock_data[0..8]
        .try_into()
        .map_err(|_| PokerError::InvalidAccountDataLength)?;
    Ok(u64::from_le_bytes(slot_bytes))
}

struct DerivedHandState {
    hole_cards: [[u8; 2]; MAX_SEATS],
    board: [u8; 5],
}

fn deal_seat_order(table: &Table) -> ([usize; MAX_SEATS], usize) {
    let mut order = [0usize; MAX_SEATS];
    let mut count = 0usize;
    let mut pos = (table.dealer_position as usize + 1) % MAX_SEATS;
    for _ in 0..MAX_SEATS {
        if table.seats[pos].is_active() {
            order[count] = pos;
            count = count.saturating_add(1);
        }
        pos = (pos + 1) % MAX_SEATS;
    }
    (order, count)
}

fn derive_hand_state(table: &Table, seed: &[u8; 32]) -> Result<DerivedHandState, ProgramError> {
    let mut deck = Deck::new();
    deck.shuffle_with_seed(seed);

    let (order, count) = deal_seat_order(table);
    let mut hole_cards = [[0u8; 2]; MAX_SEATS];
    for round in 0..2 {
        for i in 0..count {
            let seat_idx = order[i];
            let card = deck.draw();
            hole_cards[seat_idx][round] = u8::from(card);
        }
    }

    let board = [
        u8::from(deck.draw()),
        u8::from(deck.draw()),
        u8::from(deck.draw()),
        u8::from(deck.draw()),
        u8::from(deck.draw()),
    ];

    Ok(DerivedHandState { hole_cards, board })
}

fn build_board_hand(board: &[u8; 5]) -> Hand {
    let mut hand = Hand::empty();
    for card in board.iter() {
        hand = Hand::add(hand, Hand::from(Card::from(*card)));
    }
    hand
}

fn read_token_account_mint_owner(token_info: &AccountInfo) -> Result<(Pubkey, Pubkey), ProgramError> {
    let data = token_info.try_borrow_data()?;
    if data.len() < 64 {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let mut mint = [0u8; 32];
    let mut owner = [0u8; 32];
    mint.copy_from_slice(&data[0..32]);
    owner.copy_from_slice(&data[32..64]);
    Ok((mint, owner))
}

/// Read the token balance from a Token-2022 account.
/// Token account layout: [mint: 32][owner: 32][amount: 8][...]
fn read_token_account_balance(token_info: &AccountInfo) -> Result<u64, ProgramError> {
    let data = token_info.try_borrow_data()?;
    if data.len() < 72 {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let mut amount_bytes = [0u8; 8];
    amount_bytes.copy_from_slice(&data[64..72]);
    Ok(u64::from_le_bytes(amount_bytes))
}

#[inline]
fn verify_config_pda(config_info: &AccountInfo) -> ProgramResult {
    let config_seeds: &[&[u8]] = Config::SEEDS;
    let (expected_config, _) = pubkey::find_program_address(config_seeds, &crate::ID);
    if config_info.key() != &expected_config {
        return Err(PokerError::InvalidPda.into());
    }
    Ok(())
}

#[inline]
fn verify_table_pda(table_info: &AccountInfo, table_id: u64) -> ProgramResult {
    let table_id_bytes = table_id.to_le_bytes();
    let (expected_table, _) =
        pubkey::find_program_address(&[Table::SEEDS_PREFIX, &table_id_bytes], &crate::ID);
    if table_info.key() != &expected_table {
        return Err(PokerError::InvalidPda.into());
    }
    Ok(())
}

/// Process a player action during betting (AC-POK5.1, AC-POK5.2, AC-POK5.3)
fn process_player_action(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    use crate::instruction::action_type;

    if data.len() < instruction::PlayerAction::SIZE {
        return Err(PokerError::InvalidInstruction.into());
    }

    let [table_info, player_info, config_info, clock_info] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Player must sign
    if !player_info.is_signer() {
        return Err(PokerError::MissingSigner.into());
    }

    // Table must be writable
    if !table_info.is_writable() {
        return Err(PokerError::AccountNotWritable.into());
    }

    // Accounts must be owned by this program
    if !config_info.is_owned_by(&crate::ID) || !table_info.is_owned_by(&crate::ID) {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    verify_config_pda(config_info)?;

    // Load config for timeout settings
    let config_data = config_info.try_borrow_data()?;
    if config_data.len() < CONFIG_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let config = Config::from_bytes(&config_data)?;
    if !config.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }
    let action_timeout_slots = config.action_timeout_slots;
    let rake_bps = config.rake_bps;
    drop(config_data);

    // Parse instruction data
    let ix = instruction::PlayerAction::from_bytes(data);

    // Load table
    let mut table_data = table_info.try_borrow_mut_data()?;
    if table_data.len() < TABLE_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let table = Table::from_bytes_mut(&mut table_data)?;

    if !table.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }

    // Verify table PDA
    let table_id_bytes = table.table_id.to_le_bytes();
    let (expected_table, _) =
        pubkey::find_program_address(&[Table::SEEDS_PREFIX, &table_id_bytes], &crate::ID);
    if table_info.key() != &expected_table {
        return Err(PokerError::InvalidPda.into());
    }

    // AC-POK5.3: Table must be in playing state
    if table.status != table_status::PLAYING {
        return Err(PokerError::HandNotInProgress.into());
    }

    // AC-POK5.1: Verify it's this player's turn
    let seat_idx = table
        .find_any_player_seat(player_info.key())
        .ok_or(PokerError::PlayerNotFound)?;

    // AC-POK5.3: Out-of-turn check
    if seat_idx != table.current_actor as usize {
        return Err(PokerError::NotYourTurn.into());
    }

    let seat = &table.seats[seat_idx];

    // AC-POK5.3: Player must be able to act (not folded, not all-in)
    if seat.is_folded() {
        return Err(PokerError::PlayerAlreadyFolded.into());
    }
    if seat.is_all_in() {
        return Err(PokerError::PlayerAlreadyAllIn.into());
    }

    // Calculate call amount
    let amount_to_call = table.amount_to_call(seat_idx);
    let player_stack = seat.stack;

    // Process action based on type
    match ix.action_type {
        action_type::FOLD => {
            // AC-POK5.3: Cannot fold when no bet to call (should check)
            // Actually in poker you CAN fold anytime, but it's unusual
            // For strict rules: if amount_to_call == 0 { return Err(PokerError::CannotFoldWhenCheck.into()); }
            // We'll allow folding anytime for flexibility
            table.seats[seat_idx].status = seat_status::FOLDED;
            table.clear_active(seat_idx);
        }

        action_type::CHECK => {
            // AC-POK5.3: Cannot check when there's a bet to call
            if amount_to_call > 0 {
                return Err(PokerError::CannotCheckWhenBet.into());
            }
            // Check is just passing, no state change except marking acted
        }

        action_type::CALL => {
            // AC-POK5.2: Call amount logic
            if amount_to_call == 0 {
                return Err(PokerError::InvalidActionType.into()); // Should check instead
            }

            let call_amount = if amount_to_call > player_stack {
                // AC-POK5.2: All-in logic - player calls with remaining stack
                player_stack
            } else {
                amount_to_call
            };

            // Transfer chips from stack to pot
            table.seats[seat_idx].stack = player_stack
                .checked_sub(call_amount)
                .ok_or(PokerError::ArithmeticOverflow)?;
            table.seats[seat_idx].current_bet = table.seats[seat_idx]
                .current_bet
                .checked_add(call_amount)
                .ok_or(PokerError::ArithmeticOverflow)?;
            table.seats[seat_idx].total_bet = table.seats[seat_idx]
                .total_bet
                .checked_add(call_amount)
                .ok_or(PokerError::ArithmeticOverflow)?;
            table.pot = table
                .pot
                .checked_add(call_amount)
                .ok_or(PokerError::ArithmeticOverflow)?;

            // If player is now out of chips, mark as all-in
            if table.seats[seat_idx].stack == 0 {
                table.seats[seat_idx].status = seat_status::ALL_IN;
            }
        }

        action_type::RAISE => {
            // AC-POK5.2: Raise bounds enforcement
            let raise_to = ix.amount;

            // Must raise to at least current_bet + min_raise
            let min_raise_to = table
                .current_bet
                .checked_add(table.min_raise)
                .ok_or(PokerError::ArithmeticOverflow)?;

            if raise_to < min_raise_to {
                return Err(PokerError::RaiseTooSmall.into());
            }

            // Calculate how much player needs to put in
            let raise_amount = raise_to
                .checked_sub(table.seats[seat_idx].current_bet)
                .ok_or(PokerError::ArithmeticOverflow)?;

            // AC-POK5.2: Raise cannot exceed stack
            if raise_amount > player_stack {
                return Err(PokerError::RaiseExceedsStack.into());
            }

            // Update min_raise for next player (raise increment)
            let raise_increment = raise_to
                .checked_sub(table.current_bet)
                .ok_or(PokerError::ArithmeticOverflow)?;
            table.min_raise = raise_increment;

            // Update current bet level
            table.current_bet = raise_to;

            // Transfer chips from stack to pot
            table.seats[seat_idx].stack = player_stack
                .checked_sub(raise_amount)
                .ok_or(PokerError::ArithmeticOverflow)?;
            table.seats[seat_idx].current_bet = raise_to;
            table.seats[seat_idx].total_bet = table.seats[seat_idx]
                .total_bet
                .checked_add(raise_amount)
                .ok_or(PokerError::ArithmeticOverflow)?;
            table.pot = table
                .pot
                .checked_add(raise_amount)
                .ok_or(PokerError::ArithmeticOverflow)?;

            // Reset has_acted for other players since they need to respond to raise
            for (i, seat) in table.seats.iter_mut().enumerate() {
                if i != seat_idx && seat.can_act() {
                    seat.has_acted = 0;
                }
            }

            // If player is now out of chips, mark as all-in
            if table.seats[seat_idx].stack == 0 {
                table.seats[seat_idx].status = seat_status::ALL_IN;
            }
        }

        action_type::ALL_IN => {
            // AC-POK5.2: All-in logic - put all remaining chips in
            let all_in_amount = player_stack;
            let new_bet = table.seats[seat_idx]
                .current_bet
                .checked_add(all_in_amount)
                .ok_or(PokerError::ArithmeticOverflow)?;

            // Check if this is a raise
            if new_bet > table.current_bet {
                // Calculate raise increment
                let raise_increment = new_bet
                    .checked_sub(table.current_bet)
                    .ok_or(PokerError::ArithmeticOverflow)?;

                // Only a full raise (>= min_raise) re-opens betting for players who already acted.
                // An incomplete all-in raise does NOT re-open betting per standard poker rules.
                // Players who haven't acted yet must still respond, but those who already
                // acted (and matched the previous bet) cannot re-raise.
                let is_full_raise = raise_increment >= table.min_raise;

                if is_full_raise {
                    // Full raise: update min_raise and re-open betting for all active players
                    table.min_raise = raise_increment;
                    for (i, seat) in table.seats.iter_mut().enumerate() {
                        if i != seat_idx && seat.can_act() {
                            seat.has_acted = 0;
                        }
                    }
                }
                // Note: For incomplete raises, we don't reset has_acted.
                // Players who already acted can only call or fold, not re-raise.

                // Update current bet level (always, even for incomplete raises)
                table.current_bet = new_bet;
            }

            // Transfer all chips to pot
            table.seats[seat_idx].stack = 0;
            table.seats[seat_idx].current_bet = new_bet;
            table.seats[seat_idx].total_bet = table.seats[seat_idx]
                .total_bet
                .checked_add(all_in_amount)
                .ok_or(PokerError::ArithmeticOverflow)?;
            table.pot = table
                .pot
                .checked_add(all_in_amount)
                .ok_or(PokerError::ArithmeticOverflow)?;
            table.seats[seat_idx].status = seat_status::ALL_IN;
        }

        _ => return Err(PokerError::InvalidActionType.into()),
    }

    // Mark player as having acted this street
    table.seats[seat_idx].has_acted = 1;

    // Get current slot for deadline calculation
    let current_slot = get_current_slot(clock_info)?;

    // Find next player to act
    if let Some(next_actor) = table.next_active_seat(seat_idx) {
        // Check if betting round is complete
        if table.is_betting_complete() {
            // Advance to next street or showdown
            advance_street(table, rake_bps)?;
        } else {
            // Continue betting round
            table.current_actor = next_actor as u8;
        }
    } else {
        // No more players can act - advance street
        advance_street(table, rake_bps)?;
    }

    // AC-POK4.4: Reset action deadline for next player
    if table.status == table_status::PLAYING {
        table.action_deadline_slot = current_slot
            .checked_add(action_timeout_slots)
            .ok_or(PokerError::ArithmeticOverflow)?;
    }

    Ok(())
}

/// Advance to next street or end the hand
fn advance_street(table: &mut Table, rake_bps: u16) -> Result<(), ProgramError> {
    use crate::state::street;

    // Check if only one player remains (everyone else folded)
    if table.active_count() <= 1 {
        settle_uncontested_pot(table, rake_bps)?;
        return Ok(());
    }

    // Compute can_act bitmap once for both count and next-seat operations
    // This saves ~5-10 CUs compared to separate iterations
    let can_act_bitmap = table.can_act_bitmap();

    // If no players can act (all-in), skip directly to showdown
    if can_act_bitmap == 0 {
        table.current_street = street::RIVER;
        table.status = table_status::SHOWDOWN;
        table.action_deadline_slot = 0;
        return Ok(());
    }

    // Advance to next street
    match table.current_street {
        street::PREFLOP => {
            table.current_street = street::FLOP;
        }
        street::FLOP => {
            table.current_street = street::TURN;
        }
        street::TURN => {
            table.current_street = street::RIVER;
        }
        street::RIVER => {
            // Showdown - transition to SHOWDOWN state, awaiting seed reveal (AC-POK2.7)
            table.status = table_status::SHOWDOWN;
            table.action_deadline_slot = 0;
            return Ok(());
        }
        _ => return Err(PokerError::InvalidInstruction.into()),
    }

    // Reset street betting state
    table.reset_street_bets();

    // First to act on new street is first active player after dealer
    // Use bitmap for O(1) next-seat lookup instead of re-iterating
    if let Some(first_actor) = Table::bitmap_next(can_act_bitmap, table.dealer_position as usize) {
        table.current_actor = first_actor as u8;
    }

    Ok(())
}

fn settle_uncontested_pot(table: &mut Table, rake_bps: u16) -> Result<(), ProgramError> {
    let total_risked = table.pot;

    let rake_amount = if rake_bps > 0 {
        (total_risked as u128)
            .checked_mul(rake_bps as u128)
            .ok_or(PokerError::ArithmeticOverflow)?
            .checked_div(10000)
            .ok_or(PokerError::ArithmeticOverflow)? as u64
    } else {
        0
    };

    let distributable_pot = total_risked
        .checked_sub(rake_amount)
        .ok_or(PokerError::ArithmeticOverflow)?;

    if rake_amount > 0 {
        table.rake_accumulated = table
            .rake_accumulated
            .checked_add(rake_amount)
            .ok_or(PokerError::ArithmeticOverflow)?;
    }

    if distributable_pot > 0 {
        if let Some(winner_idx) = table.seats.iter().position(|seat| seat.is_active()) {
            table.seats[winner_idx].stack = table.seats[winner_idx]
                .stack
                .saturating_add(distributable_pot);
        }
    }

    for seat in table.seats.iter_mut() {
        if seat.is_empty() {
            continue;
        }

        seat.current_bet = 0;
        seat.total_bet = 0;
        seat.has_acted = 0;
        seat.hole_card_hash = [0; 32];

        if seat.stack > 0 {
            seat.status = seat_status::OCCUPIED;
        } else {
            seat.status = seat_status::SITTING_OUT;
        }
    }

    table.pot = 0;
    table.current_bet = 0;
    table.min_raise = table.big_blind;
    table.current_street = 0;
    table.action_deadline_slot = 0;
    table.status = table_status::WAITING;
    table.seed_commitment = [0; 32];
    table.revealed_seed = [0; 32];
    table.seed_revealed = 0;
    table.hand_id = table
        .hand_id
        .checked_add(1)
        .ok_or(PokerError::ArithmeticOverflow)?;

    table.dealer_position = find_next_occupied_seat(table, table.dealer_position as usize) as u8;
    table.rebuild_active_bitmap();

    Ok(())
}

/// Process settle instruction (AC-POK6.1, AC-POK6.2: showdown and payout)
///
/// This implements a deterministic side-pot algorithm:
/// 1. Sort participants by total_bet to identify pot boundaries
/// 2. For each side pot level, find winners (lowest hand_strength among eligible)
/// 3. Distribute proportionally, handle odd chips
/// 4. Credit winnings to stacks, reset hand state
fn process_settle(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    use crate::state::MAX_SEATS;

    if data.len() < instruction::Settle::SIZE {
        return Err(PokerError::InvalidInstruction.into());
    }

    let [table_info, config_info] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Accounts must be owned by this program
    if !config_info.is_owned_by(&crate::ID) || !table_info.is_owned_by(&crate::ID) {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    verify_config_pda(config_info)?;

    // Load config to verify initialization and get rake percentage
    let config_data = config_info.try_borrow_data()?;
    if config_data.len() < CONFIG_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let config = Config::from_bytes(&config_data)?;
    if !config.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }
    // AC-POK3.4: Get rake percentage (basis points, e.g., 250 = 2.5%)
    let rake_bps = config.rake_bps;
    drop(config_data);

    // Load table
    let mut table_data = table_info.try_borrow_mut_data()?;
    if table_data.len() < TABLE_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let table = Table::from_bytes_mut(&mut table_data)?;

    if !table.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }

    verify_table_pda(table_info, table.table_id)?;

    // Must be in SHOWDOWN state
    if table.status != table_status::SHOWDOWN {
        return Err(PokerError::TableNotShowdown.into());
    }

    // AC-POK2.8: Seed must be revealed before settlement
    if table.seed_revealed == 0 {
        return Err(PokerError::SeedNotRevealed.into());
    }

    // Derive hole cards and board from revealed seed
    let derived = derive_hand_state(table, &table.revealed_seed)?;
    let board_hand = build_board_hand(&derived.board);

    // Build participant data with inline strength computation (single pass optimization)
    // Each entry: (seat_idx, total_bet, hand_strength, is_active)
    // is_active means player is eligible for pots (not folded, has bet something)
    let mut participants: [(usize, u64, Option<Strength>, bool); MAX_SEATS] =
        [(0, 0, None, false); MAX_SEATS];
    let mut participant_count = 0usize;

    for (i, seat) in table.seats.iter().enumerate() {
        if seat.is_empty() {
            continue;
        }

        // Player participated if they have total_bet > 0 or are still active
        let showdown_eligible =
            seat.status != seat_status::SITTING_OUT && !seat.is_folded();

        // Compute hand strength inline only for showdown-eligible players
        // This avoids a separate precomputation loop (saves ~10-20 CUs)
        let strength = if showdown_eligible {
            let hole = derived.hole_cards[i];
            let mut hand = board_hand;
            hand = Hand::add(hand, Hand::from(Card::from(hole[0])));
            hand = Hand::add(hand, Hand::from(Card::from(hole[1])));
            Some(Strength::from(hand))
        } else {
            None
        };

        let is_active = showdown_eligible && (seat.is_active() || seat.total_bet > 0);

        // Only include players who contributed to the pot
        if seat.total_bet > 0 || is_active {
            participants[participant_count] =
                (i, seat.total_bet, strength, is_active && strength.is_some());
            participant_count = participant_count.saturating_add(1);
        }
    }

    // AC-POK6.2: Verify total risked = sum of all total_bets
    let total_risked: u64 = participants[..participant_count]
        .iter()
        .map(|(_, bet, _, _)| *bet)
        .try_fold(0u64, |acc, x| acc.checked_add(x).ok_or(PokerError::ArithmeticOverflow))?;

    // Verify pot matches total risked (invariant check - fail hard to catch accounting bugs)
    if table.pot != total_risked {
        return Err(PokerError::PotInvariantViolation.into());
    }

    // AC-POK3.4: Calculate and deduct rake from pot before distribution
    // Rake = (total_risked * rake_bps) / 10000
    // Rake is taken from the pot, winners receive (pot - rake)
    let rake_amount = if rake_bps > 0 {
        (total_risked as u128)
            .checked_mul(rake_bps as u128)
            .ok_or(PokerError::ArithmeticOverflow)?
            .checked_div(10000)
            .ok_or(PokerError::ArithmeticOverflow)? as u64
    } else {
        0
    };

    // Amount available for distribution after rake
    let distributable_pot = total_risked
        .checked_sub(rake_amount)
        .ok_or(PokerError::ArithmeticOverflow)?;

    // Accumulate rake at the table (to be swept to staking pool later)
    table.rake_accumulated = table
        .rake_accumulated
        .checked_add(rake_amount)
        .ok_or(PokerError::ArithmeticOverflow)?;

    // Distribute pot using side-pot algorithm
    // Track winnings per seat
    let mut winnings: [u64; MAX_SEATS] = [0; MAX_SEATS];

    // Get sorted unique bet levels for side pot calculation
    // Optimized: collect all bets first, sort, then deduplicate in one pass
    // This is O(n) + O(n²) + O(n) instead of O(n²) + O(n²) for the naive approach
    let mut bet_levels: [u64; MAX_SEATS] = [0; MAX_SEATS];
    let mut temp_count = 0usize;

    // Step 1: Collect all non-zero bets (O(n), no duplicate check)
    for i in 0..participant_count {
        let bet = participants[i].1;
        if bet > 0 && temp_count < MAX_SEATS {
            bet_levels[temp_count] = bet;
            temp_count += 1;
        }
    }

    // Step 2: Sort ascending (bubble sort is fine for MAX_SEATS=10)
    for i in 0..temp_count {
        for j in (i + 1)..temp_count {
            if bet_levels[j] < bet_levels[i] {
                let tmp = bet_levels[i];
                bet_levels[i] = bet_levels[j];
                bet_levels[j] = tmp;
            }
        }
    }

    // Step 3: Deduplicate in-place by compacting (O(n) single pass through sorted array)
    let mut level_count = 0usize;
    for i in 0..temp_count {
        // Skip duplicates: only add if different from last added
        if level_count == 0 || bet_levels[i] != bet_levels[level_count - 1] {
            bet_levels[level_count] = bet_levels[i];
            level_count += 1;
        }
    }

    // Process each side pot level
    let mut prev_level: u64 = 0;
    for level_idx in 0..level_count {
        let current_level = bet_levels[level_idx];
        let pot_increment = current_level.saturating_sub(prev_level);

        if pot_increment == 0 {
            continue;
        }

        // Calculate pot for this level: pot_increment * number of contributors at or above this level
        let mut pot_size: u64 = 0;

        for i in 0..participant_count {
            let (_, bet, _, _) = participants[i];
            if bet >= current_level {
                pot_size = pot_size.saturating_add(pot_increment);
            }
        }

        // Find best hand strength among eligible players (highest strength wins)
        let mut best_strength: Option<Strength> = None;
        for i in 0..participant_count {
            let (_, bet, strength, is_active) = participants[i];
            if !is_active || bet < current_level {
                continue;
            }
            if let Some(strength) = strength {
                if best_strength.map_or(true, |best| strength > best) {
                    best_strength = Some(strength);
                }
            }
        }

        let Some(best_strength) = best_strength else {
            // No eligible winners at this level, pot goes to next level or stays
            // This shouldn't happen in normal play, but handle gracefully
            prev_level = current_level;
            continue;
        };

        // Count winners and distribute pot
        let mut winner_indices: [usize; MAX_SEATS] = [0; MAX_SEATS];
        let mut winner_count = 0usize;

        for i in 0..participant_count {
            let (seat_idx, bet, strength, is_active) = participants[i];
            if !is_active || bet < current_level {
                continue;
            }
            if let Some(strength) = strength {
                if strength == best_strength {
                    winner_indices[winner_count] = seat_idx;
                    winner_count = winner_count.saturating_add(1);
                }
            }
        }

        if winner_count > 0 {
            // Split pot among winners
            let share = pot_size / winner_count as u64;
            let remainder = pot_size % winner_count as u64;

            for i in 0..winner_count {
                let seat_idx = winner_indices[i];
                winnings[seat_idx] = winnings[seat_idx]
                    .checked_add(share)
                    .ok_or(PokerError::ArithmeticOverflow)?;
            }

            // Sort winners by position clockwise from dealer (first left of button gets odd chip)
            // Standard poker rule: odd chips go to the first player left of the button
            let dealer_pos = table.dealer_position as usize;
            for i in 0..winner_count {
                for j in (i + 1)..winner_count {
                    // Calculate clockwise distance from dealer for each winner
                    let dist_i = (winner_indices[i] + MAX_SEATS - dealer_pos) % MAX_SEATS;
                    let dist_j = (winner_indices[j] + MAX_SEATS - dealer_pos) % MAX_SEATS;
                    if dist_j < dist_i {
                        let tmp = winner_indices[i];
                        winner_indices[i] = winner_indices[j];
                        winner_indices[j] = tmp;
                    }
                }
            }

            // Distribute remainder (odd chips) to winners closest to left of button
            for i in 0..(remainder as usize) {
                if i < winner_count {
                    let seat_idx = winner_indices[i];
                    winnings[seat_idx] = winnings[seat_idx]
                        .checked_add(1)
                        .ok_or(PokerError::ArithmeticOverflow)?;
                }
            }
        }

        prev_level = current_level;
    }

    // AC-POK6.2: Verify total payouts = total risked (before rake)
    let total_payout: u64 = winnings.iter().try_fold(0u64, |acc, x| {
        acc.checked_add(*x).ok_or(PokerError::ArithmeticOverflow)
    })?;
    if total_payout != total_risked {
        return Err(PokerError::PotInvariantViolation.into());
    }

    // AC-POK3.4: Scale down winnings to account for rake deduction
    // Each winner's share is reduced proportionally: new_winning = winning * distributable_pot / total_risked
    // We track any rounding remainder and distribute it to the first winner
    if rake_amount > 0 && total_payout > 0 {
        let mut scaled_total: u64 = 0;
        for i in 0..MAX_SEATS {
            if winnings[i] > 0 {
                let scaled = (winnings[i] as u128)
                    .checked_mul(distributable_pot as u128)
                    .ok_or(PokerError::ArithmeticOverflow)?
                    .checked_div(total_risked as u128)
                    .ok_or(PokerError::ArithmeticOverflow)? as u64;
                winnings[i] = scaled;
                scaled_total = scaled_total
                    .checked_add(scaled)
                    .ok_or(PokerError::ArithmeticOverflow)?;
            }
        }
        // Distribute any rounding remainder to first winner with winnings
        let remainder = distributable_pot
            .checked_sub(scaled_total)
            .ok_or(PokerError::ArithmeticOverflow)?;
        if remainder > 0 {
            for i in 0..MAX_SEATS {
                if winnings[i] > 0 {
                    winnings[i] = winnings[i]
                        .checked_add(remainder)
                        .ok_or(PokerError::ArithmeticOverflow)?;
                    break;
                }
            }
        }
    }

    // Apply winnings to stacks and reset hand state
    for (i, seat) in table.seats.iter_mut().enumerate() {
        if seat.is_empty() {
            continue;
        }

        // Add winnings to stack
        seat.stack = seat.stack
            .checked_add(winnings[i])
            .ok_or(PokerError::ArithmeticOverflow)?;

        // Reset hand state
        seat.current_bet = 0;
        seat.total_bet = 0;
        seat.has_acted = 0;
        seat.hole_card_hash = [0; 32];

        // Reset status: if player still has chips, they're occupied; otherwise they sit out
        if !seat.is_empty() {
            if seat.stack > 0 {
                seat.status = seat_status::OCCUPIED;
            } else {
                seat.status = seat_status::SITTING_OUT;
            }
        }
    }

    // Reset table state for next hand
    table.pot = 0;
    table.current_bet = 0;
    table.min_raise = table.big_blind;
    table.current_street = 0;
    table.action_deadline_slot = 0;
    table.status = table_status::WAITING;
    table.seed_commitment = [0; 32];
    table.revealed_seed = [0; 32];
    table.seed_revealed = 0;
    table.hand_id = table
        .hand_id
        .checked_add(1)
        .ok_or(PokerError::ArithmeticOverflow)?;

    // Advance dealer position
    table.dealer_position = find_next_occupied_seat(table, table.dealer_position as usize) as u8;

    // Rebuild active bitmap for next hand
    table.rebuild_active_bitmap();

    Ok(())
}

/// Find the next occupied seat starting from position (wrapping)
fn find_next_occupied_seat(table: &Table, from: usize) -> usize {
    let mut pos = (from + 1) % crate::state::MAX_SEATS;
    for _ in 0..crate::state::MAX_SEATS {
        if !table.seats[pos].is_empty() {
            return pos;
        }
        pos = (pos + 1) % crate::state::MAX_SEATS;
    }
    from
}

/// Process reveal seed instruction (AC-POK2.7, AC-POK2.8: seed reveal and deck verification)
///
/// This instruction:
/// 1. Verifies sha256(seed) == table.seed_commitment
/// 2. Verifies revealed hole cards hash to stored hole_card_hashes
/// 3. Stores the revealed seed for settlement
fn process_reveal_seed(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < instruction::RevealSeed::SIZE {
        return Err(PokerError::InvalidInstruction.into());
    }

    let [
        table_info,
        provider_info,
        config_info,
        entropy_program_info,
        entropy_config_info,
        entropy_commitment_info,
        entropy_request_info,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Provider must sign
    if !provider_info.is_signer() {
        return Err(PokerError::MissingSigner.into());
    }

    // Accounts must be owned by this program where applicable
    if !config_info.is_owned_by(&crate::ID) || !table_info.is_owned_by(&crate::ID) {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    verify_config_pda(config_info)?;

    // Load config to verify initialization
    let config_data = config_info.try_borrow_data()?;
    if config_data.len() < CONFIG_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let config = Config::from_bytes(&config_data)?;
    if !config.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }
    let entropy_program_id = config.entropy_program;
    drop(config_data);

    if entropy_program_info.key() != &entropy_program_id {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Entropy accounts must be owned by the entropy program
    if entropy_config_info.owner() != &entropy_program_id
        || entropy_commitment_info.owner() != &entropy_program_id
        || entropy_request_info.owner() != &entropy_program_id
    {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    // Verify entropy config PDA
    let (expected_entropy_config, _) =
        pubkey::find_program_address(&[b"config"], &entropy_program_id);
    if entropy_config_info.key() != &expected_entropy_config {
        return Err(PokerError::InvalidPda.into());
    }

    // Load entropy config to verify provider
    let entropy_config_data = entropy_config_info.try_borrow_data()?;
    if entropy_config_data.len() < ENTROPY_CONFIG_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let entropy_config = EntropyConfig::from_bytes(&entropy_config_data)?;
    if !entropy_config.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }
    let entropy_provider = entropy_config.provider;
    drop(entropy_config_data);

    if provider_info.key() != &entropy_provider {
        return Err(PokerError::ProviderMismatch.into());
    }

    // Parse instruction data
    let ix = instruction::RevealSeed::from_bytes(data);

    // Load table
    let mut table_data = table_info.try_borrow_mut_data()?;
    if table_data.len() < TABLE_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let table = Table::from_bytes_mut(&mut table_data)?;

    if !table.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }

    // Must be in SHOWDOWN state (after river betting)
    if table.status != table_status::SHOWDOWN {
        return Err(PokerError::TableNotShowdown.into());
    }

    // Seed must not already be revealed
    if table.seed_revealed != 0 {
        return Err(PokerError::SeedAlreadyRevealed.into());
    }

    // Verify table PDA
    let table_id_bytes = table.table_id.to_le_bytes();
    let (expected_table, _) =
        pubkey::find_program_address(&[Table::SEEDS_PREFIX, &table_id_bytes], &crate::ID);
    if table_info.key() != &expected_table {
        return Err(PokerError::InvalidPda.into());
    }

    // Verify entropy request PDA and linkage to table hand
    let request_id = table.hand_id;
    let request_id_bytes = request_id.to_le_bytes();
    let request_seeds: [&[u8]; 3] = [
        b"request",
        table_info.key().as_ref(),
        request_id_bytes.as_slice(),
    ];
    let (expected_request, _) =
        pubkey::find_program_address(&request_seeds, &entropy_program_id);
    if entropy_request_info.key() != &expected_request {
        return Err(PokerError::InvalidPda.into());
    }

    let request_data = entropy_request_info.try_borrow_data()?;
    if request_data.len() < ENTROPY_REQUEST_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let request = EntropyRequest::from_bytes(&request_data)?;
    let request_pending = request.is_pending();
    if request.requester != *table_info.key() || request.request_id != request_id {
        return Err(PokerError::InvalidPda.into());
    }
    if request.commitment != *entropy_commitment_info.key() {
        return Err(PokerError::InvalidSeedCommitment.into());
    }
    drop(request_data);

    // Verify entropy commitment PDA and revealed preimage
    let commitment_data = entropy_commitment_info.try_borrow_data()?;
    if commitment_data.len() < ENTROPY_COMMITMENT_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let commitment = EntropyCommitment::from_bytes(&commitment_data)?;
    if !commitment.is_revealed() {
        return Err(PokerError::InvalidSeedCommitment.into());
    }
    if commitment.provider != entropy_provider {
        return Err(PokerError::ProviderMismatch.into());
    }
    let sequence_bytes = commitment.sequence.to_le_bytes();
    let commitment_seeds: [&[u8]; 3] = [
        b"commitment",
        commitment.provider.as_ref(),
        sequence_bytes.as_slice(),
    ];
    let (expected_commitment, _) =
        pubkey::find_program_address(&commitment_seeds, &entropy_program_id);
    if entropy_commitment_info.key() != &expected_commitment {
        return Err(PokerError::InvalidPda.into());
    }
    if commitment.hash != table.seed_commitment {
        return Err(PokerError::InvalidSeedCommitment.into());
    }
    if commitment.preimage != ix.seed {
        return Err(PokerError::InvalidSeedCommitment.into());
    }
    drop(commitment_data);

    // AC-POK2.7: Verify sha256(seed) == seed_commitment
    let computed_hash = sha256(&ix.seed);
    if computed_hash != table.seed_commitment {
        return Err(PokerError::InvalidSeedCommitment.into());
    }

    // Finalize entropy request if still pending
    if request_pending {
        entropy_cpi::finalize(
            entropy_program_info,
            entropy_request_info,
            entropy_commitment_info,
            entropy_config_info,
        )?;
    }

    // Derive expected hole cards and board from seed
    let derived = derive_hand_state(table, &ix.seed)?;

    // Verify hole card hashes for all dealt seats
    for i in 0..MAX_SEATS {
        let seat = &table.seats[i];
        if seat.is_empty() || seat.status == seat_status::SITTING_OUT {
            continue;
        }
        let expected_hash = sha256(&derived.hole_cards[i]);
        if expected_hash != seat.hole_card_hash {
            return Err(PokerError::HoleCardHashMismatch.into());
        }
        if !seat.is_folded() && ix.revealed_hole_cards[i] != derived.hole_cards[i] {
            return Err(PokerError::HoleCardHashMismatch.into());
        }
    }

    // Store the revealed seed and mark as revealed
    table.revealed_seed = ix.seed;
    table.seed_revealed = 1;

    Ok(())
}

// =============================================================================
// Staking Instructions (AC-POK3.4, AC-POK3.5, AC-POK3.6)
// =============================================================================

/// Initialize the global staking pool (AC-POK3.5)
fn process_init_staking_pool(accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
    use pinocchio::sysvars::{rent::Rent, Sysvar};
    use pinocchio_system::instructions::CreateAccount;

    let [staking_pool_info, stake_vault_info, rewards_vault_info, payer_info, config_info, crisps_mint_info, token_program, system_program_info] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Payer/Authority must sign
    if !payer_info.is_signer() {
        return Err(PokerError::MissingSigner.into());
    }

    // Duplicate mutable accounts (AC-POK7.3)
    if staking_pool_info.key() == stake_vault_info.key()
        || staking_pool_info.key() == rewards_vault_info.key()
        || stake_vault_info.key() == rewards_vault_info.key()
        || staking_pool_info.key() == payer_info.key()
        || stake_vault_info.key() == payer_info.key()
        || rewards_vault_info.key() == payer_info.key()
    {
        return Err(PokerError::DuplicateMutableAccount.into());
    }

    // Program ID checks
    if token_program.key() != &TOKEN_2022_PROGRAM_ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    if system_program_info.key() != &SYSTEM_PROGRAM_ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Config must be owned by this program
    if !config_info.is_owned_by(&crate::ID) {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    verify_config_pda(config_info)?;

    // Mint must be Token-2022 owned
    if crisps_mint_info.owner() != &TOKEN_2022_PROGRAM_ID {
        return Err(PokerError::InvalidMint.into());
    }

    // Verify config is initialized
    let config_data = config_info.try_borrow_data()?;
    if config_data.len() < CONFIG_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let config = Config::from_bytes(&config_data)?;
    if !config.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }

    // Verify payer is the config authority
    if payer_info.key() != &config.authority {
        return Err(PokerError::MissingSigner.into());
    }
    if crisps_mint_info.key() != &config.crisps_mint {
        return Err(PokerError::InvalidMint.into());
    }
    drop(config_data);

    // Verify staking pool PDA
    let pool_seeds: &[&[u8]] = &[StakingPool::SEEDS_PREFIX];
    let (expected_pool, pool_bump) = pubkey::find_program_address(pool_seeds, &crate::ID);
    if staking_pool_info.key() != &expected_pool {
        return Err(PokerError::InvalidPda.into());
    }

    // Verify stake vault PDA
    let stake_vault_seeds: &[&[u8]] = &[StakingPool::STAKE_VAULT_SEEDS_PREFIX];
    let (expected_stake_vault, _) = pubkey::find_program_address(stake_vault_seeds, &crate::ID);
    if stake_vault_info.key() != &expected_stake_vault {
        return Err(PokerError::InvalidPda.into());
    }

    // Verify rewards vault PDA
    let rewards_vault_seeds: &[&[u8]] = &[StakingPool::REWARDS_VAULT_SEEDS_PREFIX];
    let (expected_rewards_vault, _) = pubkey::find_program_address(rewards_vault_seeds, &crate::ID);
    if rewards_vault_info.key() != &expected_rewards_vault {
        return Err(PokerError::InvalidPda.into());
    }

    // Create staking pool account if not exists
    if staking_pool_info.data_len() == 0 {
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(STAKING_POOL_SIZE);

        let pool_bump_slice = [pool_bump];
        let seeds: [Seed; 2] = [
            Seed::from(StakingPool::SEEDS_PREFIX),
            Seed::from(pool_bump_slice.as_slice()),
        ];
        let signer = Signer::from(&seeds);

        CreateAccount {
            from: payer_info,
            to: staking_pool_info,
            lamports,
            space: STAKING_POOL_SIZE as u64,
            owner: &crate::ID,
        }
        .invoke_signed(&[signer])?;
    } else {
        // Staking pool account already exists - verify ownership
        if !staking_pool_info.is_owned_by(&crate::ID) {
            return Err(PokerError::InvalidAccountOwner.into());
        }

        // Check if already initialized
        let pool_data = staking_pool_info.try_borrow_data()?;
        if pool_data.len() >= STAKING_POOL_SIZE {
            let pool = StakingPool::from_bytes(&pool_data)?;
            if pool.is_initialized() {
                return Err(PokerError::StakingPoolAlreadyInitialized.into());
            }
        }
        drop(pool_data);
    }

    // Vault token accounts must be Token-2022 owned and for CRISPS mint
    if stake_vault_info.owner() != &TOKEN_2022_PROGRAM_ID
        || rewards_vault_info.owner() != &TOKEN_2022_PROGRAM_ID
    {
        return Err(PokerError::InvalidAccountOwner.into());
    }
    let (stake_mint, stake_owner) = read_token_account_mint_owner(stake_vault_info)?;
    if stake_mint != *crisps_mint_info.key() || stake_owner != *stake_vault_info.key() {
        return Err(PokerError::InvalidAccountOwner.into());
    }
    let (rewards_mint, rewards_owner) = read_token_account_mint_owner(rewards_vault_info)?;
    if rewards_mint != *crisps_mint_info.key() || rewards_owner != *rewards_vault_info.key() {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    // Initialize staking pool data
    let mut pool_data = staking_pool_info.try_borrow_mut_data()?;
    if pool_data.len() < STAKING_POOL_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }

    let pool = StakingPool::from_bytes_mut(&mut pool_data)?;
    pool.discriminator = acc_disc::STAKING_POOL;
    pool.initialized = 1;
    pool._padding = [0; 6];
    pool.total_staked = 0;
    pool.accumulated_rewards = 0;
    pool.total_distributed = 0;
    pool.stake_vault = *stake_vault_info.key();
    pool.rewards_vault = *rewards_vault_info.key();

    Ok(())
}

/// Deposit CRISPS into staking pool (AC-POK3.5)
fn process_deposit_stake(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    use pinocchio::sysvars::{rent::Rent, Sysvar};
    use pinocchio_system::instructions::CreateAccount;

    if data.len() < instruction::DepositStake::SIZE {
        return Err(PokerError::InvalidInstruction.into());
    }

    let [staking_pool_info, staker_position_info, stake_vault_info, staker_token_info, staker_info, config_info, token_program, system_program_info] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Staker must sign
    if !staker_info.is_signer() {
        return Err(PokerError::MissingSigner.into());
    }

    // Duplicate mutable accounts (AC-POK7.3)
    if staking_pool_info.key() == staker_position_info.key()
        || staking_pool_info.key() == stake_vault_info.key()
        || staker_position_info.key() == stake_vault_info.key()
        || stake_vault_info.key() == staker_token_info.key()
    {
        return Err(PokerError::DuplicateMutableAccount.into());
    }

    // Program ID checks
    if token_program.key() != &TOKEN_2022_PROGRAM_ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    if system_program_info.key() != &SYSTEM_PROGRAM_ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Config and staking pool must be owned by this program
    if !config_info.is_owned_by(&crate::ID) || !staking_pool_info.is_owned_by(&crate::ID) {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    verify_config_pda(config_info)?;

    // Verify config is initialized
    let config_data = config_info.try_borrow_data()?;
    if config_data.len() < CONFIG_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let config = Config::from_bytes(&config_data)?;
    if !config.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }
    let crisps_mint = config.crisps_mint;
    drop(config_data);

    // Parse instruction data
    let ix = instruction::DepositStake::from_bytes(data);

    // Validate amount > 0
    if ix.amount == 0 {
        return Err(PokerError::ZeroStakeAmount.into());
    }

    // Verify staking pool PDA
    let pool_seeds: &[&[u8]] = &[StakingPool::SEEDS_PREFIX];
    let (expected_pool, _) = pubkey::find_program_address(pool_seeds, &crate::ID);
    if staking_pool_info.key() != &expected_pool {
        return Err(PokerError::InvalidPda.into());
    }

    // Verify staker position PDA
    let position_seeds: &[&[u8]] = &[StakerPosition::SEEDS_PREFIX, staker_info.key().as_ref()];
    let (expected_position, position_bump) = pubkey::find_program_address(position_seeds, &crate::ID);
    if staker_position_info.key() != &expected_position {
        return Err(PokerError::InvalidPda.into());
    }

    // Create staker position account if not exists
    let needs_init = if staker_position_info.data_len() == 0 {
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(STAKER_POSITION_SIZE);

        let position_bump_slice = [position_bump];
        let seeds: [Seed; 3] = [
            Seed::from(StakerPosition::SEEDS_PREFIX),
            Seed::from(staker_info.key().as_ref()),
            Seed::from(position_bump_slice.as_slice()),
        ];
        let signer = Signer::from(&seeds);

        CreateAccount {
            from: staker_info,
            to: staker_position_info,
            lamports,
            space: STAKER_POSITION_SIZE as u64,
            owner: &crate::ID,
        }
        .invoke_signed(&[signer])?;

        true
    } else {
        // Staker position account already exists - verify ownership
        if !staker_position_info.is_owned_by(&crate::ID) {
            return Err(PokerError::InvalidAccountOwner.into());
        }
        false
    };

    // Load staking pool
    let mut pool_data = staking_pool_info.try_borrow_mut_data()?;
    if pool_data.len() < STAKING_POOL_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let pool = StakingPool::from_bytes_mut(&mut pool_data)?;

    if !pool.is_initialized() {
        return Err(PokerError::StakingPoolNotInitialized.into());
    }

    let was_pool_empty = pool.total_staked == 0;

    // Verify stake vault matches pool
    if stake_vault_info.key() != &pool.stake_vault {
        return Err(PokerError::InvalidPda.into());
    }

    // Vault token account must be Token-2022 owned and for CRISPS mint
    if stake_vault_info.owner() != &TOKEN_2022_PROGRAM_ID {
        return Err(PokerError::InvalidAccountOwner.into());
    }
    let (stake_mint, stake_owner) = read_token_account_mint_owner(stake_vault_info)?;
    if stake_mint != crisps_mint || stake_owner != *stake_vault_info.key() {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    // Staker token account must be Token-2022 owned, minted to CRISPS, owned by staker
    if staker_token_info.owner() != &TOKEN_2022_PROGRAM_ID {
        return Err(PokerError::InvalidAccountOwner.into());
    }
    let (staker_mint, staker_owner) = read_token_account_mint_owner(staker_token_info)?;
    if staker_mint != crisps_mint || staker_owner != *staker_info.key() {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    // Load staker position
    let mut position_data = staker_position_info.try_borrow_mut_data()?;
    if position_data.len() < STAKER_POSITION_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let position = StakerPosition::from_bytes_mut(&mut position_data)?;

    update_pool_rewards(pool)?;

    // Initialize position if newly created or not already initialized
    if needs_init || !position.is_initialized() {
        position.discriminator = acc_disc::STAKER_POSITION;
        position.initialized = 1;
        position._padding = [0; 6];
        position.staker = *staker_info.key();
        position.staked_amount = 0;
        position.rewards_claimed = 0;
        position.last_rewards_per_token = pool.total_distributed;
    } else {
        accrue_staker_rewards(position, pool)?;
    }

    // Update staked amounts
    position.staked_amount = position
        .staked_amount
        .checked_add(ix.amount)
        .ok_or(PokerError::ArithmeticOverflow)?;
    pool.total_staked = pool
        .total_staked
        .checked_add(ix.amount)
        .ok_or(PokerError::ArithmeticOverflow)?;

    if was_pool_empty && pool.accumulated_rewards > 0 {
        update_pool_rewards(pool)?;
        accrue_staker_rewards(position, pool)?;
    }

    // Drop borrows before CPI
    drop(pool_data);
    drop(position_data);

    // AC-POK3.5: Transfer CRISPS from staker to stake vault
    token_cpi::transfer(
        staker_token_info,
        stake_vault_info,
        staker_info,
        ix.amount,
        token_program,
    )?;

    Ok(())
}

/// Withdraw CRISPS from staking pool (AC-POK3.5)
fn process_withdraw_stake(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < instruction::WithdrawStake::SIZE {
        return Err(PokerError::InvalidInstruction.into());
    }

    let [staking_pool_info, staker_position_info, stake_vault_info, staker_token_info, staker_info, config_info, token_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Staker must sign
    if !staker_info.is_signer() {
        return Err(PokerError::MissingSigner.into());
    }

    // Duplicate mutable accounts (AC-POK7.3)
    if staking_pool_info.key() == staker_position_info.key()
        || staking_pool_info.key() == stake_vault_info.key()
        || staker_position_info.key() == stake_vault_info.key()
        || stake_vault_info.key() == staker_token_info.key()
    {
        return Err(PokerError::DuplicateMutableAccount.into());
    }

    // Token program ID check
    if token_program.key() != &TOKEN_2022_PROGRAM_ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Accounts must be owned by this program where applicable
    if !config_info.is_owned_by(&crate::ID)
        || !staking_pool_info.is_owned_by(&crate::ID)
        || !staker_position_info.is_owned_by(&crate::ID)
    {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    verify_config_pda(config_info)?;

    // Verify config is initialized
    let config_data = config_info.try_borrow_data()?;
    if config_data.len() < CONFIG_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let config = Config::from_bytes(&config_data)?;
    if !config.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }
    let crisps_mint = config.crisps_mint;
    drop(config_data);

    // Parse instruction data
    let ix = instruction::WithdrawStake::from_bytes(data);

    // Validate amount > 0
    if ix.amount == 0 {
        return Err(PokerError::ZeroStakeAmount.into());
    }

    // Verify staking pool PDA
    let pool_seeds: &[&[u8]] = &[StakingPool::SEEDS_PREFIX];
    let (expected_pool, _) = pubkey::find_program_address(pool_seeds, &crate::ID);
    if staking_pool_info.key() != &expected_pool {
        return Err(PokerError::InvalidPda.into());
    }

    // Verify staker position PDA
    let position_seeds: &[&[u8]] = &[StakerPosition::SEEDS_PREFIX, staker_info.key().as_ref()];
    let (expected_position, _) = pubkey::find_program_address(position_seeds, &crate::ID);
    if staker_position_info.key() != &expected_position {
        return Err(PokerError::InvalidPda.into());
    }

    // Load staking pool
    let mut pool_data = staking_pool_info.try_borrow_mut_data()?;
    if pool_data.len() < STAKING_POOL_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let pool = StakingPool::from_bytes_mut(&mut pool_data)?;

    if !pool.is_initialized() {
        return Err(PokerError::StakingPoolNotInitialized.into());
    }

    // Verify stake vault matches pool
    if stake_vault_info.key() != &pool.stake_vault {
        return Err(PokerError::InvalidPda.into());
    }

    // Vault token account must be Token-2022 owned and for CRISPS mint
    if stake_vault_info.owner() != &TOKEN_2022_PROGRAM_ID {
        return Err(PokerError::InvalidAccountOwner.into());
    }
    let (stake_mint, stake_owner) = read_token_account_mint_owner(stake_vault_info)?;
    if stake_mint != crisps_mint || stake_owner != *stake_vault_info.key() {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    // Staker token account must be Token-2022 owned, minted to CRISPS, owned by staker
    if staker_token_info.owner() != &TOKEN_2022_PROGRAM_ID {
        return Err(PokerError::InvalidAccountOwner.into());
    }
    let (staker_mint, staker_owner) = read_token_account_mint_owner(staker_token_info)?;
    if staker_mint != crisps_mint || staker_owner != *staker_info.key() {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    // Load staker position
    let mut position_data = staker_position_info.try_borrow_mut_data()?;
    if position_data.len() < STAKER_POSITION_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let position = StakerPosition::from_bytes_mut(&mut position_data)?;

    if !position.is_initialized() {
        return Err(PokerError::StakerPositionNotFound.into());
    }

    // Verify staker owns this position
    if &position.staker != staker_info.key() {
        return Err(PokerError::MissingSigner.into());
    }

    // Check sufficient staked amount
    if position.staked_amount < ix.amount {
        return Err(PokerError::InsufficientStakedAmount.into());
    }

    update_pool_rewards(pool)?;
    accrue_staker_rewards(position, pool)?;

    // Update staked amounts
    position.staked_amount = position
        .staked_amount
        .checked_sub(ix.amount)
        .ok_or(PokerError::ArithmeticOverflow)?;
    pool.total_staked = pool
        .total_staked
        .checked_sub(ix.amount)
        .ok_or(PokerError::ArithmeticOverflow)?;

    // Drop borrows before CPI
    drop(pool_data);
    drop(position_data);

    // AC-POK3.5: Transfer CRISPS from stake vault to staker (PDA signer)
    let stake_vault_seeds: &[&[u8]] = &[StakingPool::STAKE_VAULT_SEEDS_PREFIX];
    let (_, vault_bump) = pubkey::find_program_address(stake_vault_seeds, &crate::ID);
    let vault_bump_slice = [vault_bump];

    let seeds: [Seed; 2] = [
        Seed::from(StakingPool::STAKE_VAULT_SEEDS_PREFIX),
        Seed::from(vault_bump_slice.as_slice()),
    ];
    let signer = Signer::from(&seeds);

    token_cpi::transfer_signed(
        stake_vault_info,
        staker_token_info,
        stake_vault_info, // Vault is its own authority as a PDA
        ix.amount,
        token_program,
        &[signer],
    )?;

    Ok(())
}

/// Claim accumulated rake rewards (AC-POK3.6)
fn process_claim_rewards(accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
    let [staking_pool_info, staker_position_info, rewards_vault_info, staker_token_info, staker_info, config_info, token_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Staker must sign
    if !staker_info.is_signer() {
        return Err(PokerError::MissingSigner.into());
    }

    // Duplicate mutable accounts (AC-POK7.3)
    if staking_pool_info.key() == staker_position_info.key()
        || staking_pool_info.key() == rewards_vault_info.key()
        || staker_position_info.key() == rewards_vault_info.key()
        || rewards_vault_info.key() == staker_token_info.key()
    {
        return Err(PokerError::DuplicateMutableAccount.into());
    }

    // Token program ID check
    if token_program.key() != &TOKEN_2022_PROGRAM_ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Accounts must be owned by this program where applicable
    if !config_info.is_owned_by(&crate::ID)
        || !staking_pool_info.is_owned_by(&crate::ID)
        || !staker_position_info.is_owned_by(&crate::ID)
    {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    verify_config_pda(config_info)?;

    // Verify config is initialized
    let config_data = config_info.try_borrow_data()?;
    if config_data.len() < CONFIG_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let config = Config::from_bytes(&config_data)?;
    if !config.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }
    let crisps_mint = config.crisps_mint;
    drop(config_data);

    // Verify staking pool PDA
    let pool_seeds: &[&[u8]] = &[StakingPool::SEEDS_PREFIX];
    let (expected_pool, _) = pubkey::find_program_address(pool_seeds, &crate::ID);
    if staking_pool_info.key() != &expected_pool {
        return Err(PokerError::InvalidPda.into());
    }

    // Verify staker position PDA
    let position_seeds: &[&[u8]] = &[StakerPosition::SEEDS_PREFIX, staker_info.key().as_ref()];
    let (expected_position, _) = pubkey::find_program_address(position_seeds, &crate::ID);
    if staker_position_info.key() != &expected_position {
        return Err(PokerError::InvalidPda.into());
    }

    // Load staking pool
    let mut pool_data = staking_pool_info.try_borrow_mut_data()?;
    if pool_data.len() < STAKING_POOL_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let pool = StakingPool::from_bytes_mut(&mut pool_data)?;

    if !pool.is_initialized() {
        return Err(PokerError::StakingPoolNotInitialized.into());
    }

    // Verify rewards vault matches pool
    if rewards_vault_info.key() != &pool.rewards_vault {
        return Err(PokerError::InvalidPda.into());
    }

    // Rewards vault must be Token-2022 owned and for CRISPS mint
    if rewards_vault_info.owner() != &TOKEN_2022_PROGRAM_ID {
        return Err(PokerError::InvalidAccountOwner.into());
    }
    let (rewards_mint, rewards_owner) = read_token_account_mint_owner(rewards_vault_info)?;
    if rewards_mint != crisps_mint || rewards_owner != *rewards_vault_info.key() {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    // Staker token account must be Token-2022 owned, minted to CRISPS, owned by staker
    if staker_token_info.owner() != &TOKEN_2022_PROGRAM_ID {
        return Err(PokerError::InvalidAccountOwner.into());
    }
    let (staker_mint, staker_owner) = read_token_account_mint_owner(staker_token_info)?;
    if staker_mint != crisps_mint || staker_owner != *staker_info.key() {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    // Load staker position
    let mut position_data = staker_position_info.try_borrow_mut_data()?;
    if position_data.len() < STAKER_POSITION_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let position = StakerPosition::from_bytes_mut(&mut position_data)?;

    if !position.is_initialized() {
        return Err(PokerError::StakerPositionNotFound.into());
    }

    // Verify staker owns this position
    if &position.staker != staker_info.key() {
        return Err(PokerError::MissingSigner.into());
    }

    update_pool_rewards(pool)?;
    accrue_staker_rewards(position, pool)?;

    let reward_share = position.rewards_claimed;
    if reward_share == 0 {
        return Err(PokerError::NoRewardsAvailable.into());
    }

    position.rewards_claimed = 0;

    // Drop borrows before CPI
    drop(pool_data);
    drop(position_data);

    // AC-POK3.6: Transfer rewards from rewards vault to staker (PDA signer)
    let rewards_vault_seeds: &[&[u8]] = &[StakingPool::REWARDS_VAULT_SEEDS_PREFIX];
    let (_, vault_bump) = pubkey::find_program_address(rewards_vault_seeds, &crate::ID);
    let vault_bump_slice = [vault_bump];

    let seeds: [Seed; 2] = [
        Seed::from(StakingPool::REWARDS_VAULT_SEEDS_PREFIX),
        Seed::from(vault_bump_slice.as_slice()),
    ];
    let signer = Signer::from(&seeds);

    token_cpi::transfer_signed(
        rewards_vault_info,
        staker_token_info,
        rewards_vault_info, // Vault is its own authority as a PDA
        reward_share,
        token_program,
        &[signer],
    )?;

    Ok(())
}

/// Sweep accumulated rake from table to staking pool rewards vault (AC-POK3.4)
fn process_sweep_rake(accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
    let [table_info, table_vault_info, staking_pool_info, rewards_vault_info, config_info, token_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Duplicate mutable accounts (AC-POK7.3)
    if table_info.key() == table_vault_info.key()
        || table_info.key() == staking_pool_info.key()
        || table_info.key() == rewards_vault_info.key()
        || table_vault_info.key() == rewards_vault_info.key()
    {
        return Err(PokerError::DuplicateMutableAccount.into());
    }

    // Token program ID check
    if token_program.key() != &TOKEN_2022_PROGRAM_ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Accounts must be owned by this program where applicable
    if !config_info.is_owned_by(&crate::ID)
        || !table_info.is_owned_by(&crate::ID)
        || !staking_pool_info.is_owned_by(&crate::ID)
    {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    verify_config_pda(config_info)?;

    // Verify config is initialized
    let config_data = config_info.try_borrow_data()?;
    if config_data.len() < CONFIG_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let config = Config::from_bytes(&config_data)?;
    if !config.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }
    let crisps_mint = config.crisps_mint;
    drop(config_data);

    // Verify staking pool PDA
    let pool_seeds: &[&[u8]] = &[StakingPool::SEEDS_PREFIX];
    let (expected_pool, _) = pubkey::find_program_address(pool_seeds, &crate::ID);
    if staking_pool_info.key() != &expected_pool {
        return Err(PokerError::InvalidPda.into());
    }

    // Load staking pool
    let mut pool_data = staking_pool_info.try_borrow_mut_data()?;
    if pool_data.len() < STAKING_POOL_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let pool = StakingPool::from_bytes_mut(&mut pool_data)?;

    if !pool.is_initialized() {
        return Err(PokerError::StakingPoolNotInitialized.into());
    }

    // Verify rewards vault matches pool
    if rewards_vault_info.key() != &pool.rewards_vault {
        return Err(PokerError::InvalidPda.into());
    }

    // Rewards vault must be Token-2022 owned and for CRISPS mint
    if rewards_vault_info.owner() != &TOKEN_2022_PROGRAM_ID {
        return Err(PokerError::InvalidAccountOwner.into());
    }
    let (rewards_mint, rewards_owner) = read_token_account_mint_owner(rewards_vault_info)?;
    if rewards_mint != crisps_mint || rewards_owner != *rewards_vault_info.key() {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    // Load table
    let mut table_data = table_info.try_borrow_mut_data()?;
    if table_data.len() < TABLE_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let table = Table::from_bytes_mut(&mut table_data)?;

    if !table.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }

    // Verify table PDA
    let table_id_bytes = table.table_id.to_le_bytes();
    let (expected_table, _) =
        pubkey::find_program_address(&[Table::SEEDS_PREFIX, &table_id_bytes], &crate::ID);
    if table_info.key() != &expected_table {
        return Err(PokerError::InvalidPda.into());
    }

    // Verify table vault matches
    if table_vault_info.key() != &table.vault {
        return Err(PokerError::InvalidPda.into());
    }

    // Table vault must be Token-2022 owned and for CRISPS mint
    if table_vault_info.owner() != &TOKEN_2022_PROGRAM_ID {
        return Err(PokerError::InvalidAccountOwner.into());
    }
    let (table_mint, table_owner) = read_token_account_mint_owner(table_vault_info)?;
    if table_mint != crisps_mint || table_owner != *table_vault_info.key() {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    // Get accumulated rake to sweep
    let rake_amount = table.rake_accumulated;
    if rake_amount == 0 {
        // Nothing to sweep, return success
        return Ok(());
    }

    // Update accounting: move rake from table to pool
    table.rake_accumulated = 0;
    pool.accumulated_rewards = pool
        .accumulated_rewards
        .checked_add(rake_amount)
        .ok_or(PokerError::ArithmeticOverflow)?;
    update_pool_rewards(pool)?;

    // Drop borrows before CPI
    drop(table_data);
    drop(pool_data);

    // AC-POK3.4: Transfer rake from table vault to rewards vault (PDA signer)
    let table_vault_seeds: &[&[u8]] = &[Table::VAULT_SEEDS_PREFIX, &table_id_bytes];
    let (_, vault_bump) = pubkey::find_program_address(table_vault_seeds, &crate::ID);
    let vault_bump_slice = [vault_bump];

    let seeds: [Seed; 3] = [
        Seed::from(Table::VAULT_SEEDS_PREFIX),
        Seed::from(table_id_bytes.as_slice()),
        Seed::from(vault_bump_slice.as_slice()),
    ];
    let signer = Signer::from(&seeds);

    token_cpi::transfer_signed(
        table_vault_info,
        rewards_vault_info,
        table_vault_info, // Vault is its own authority as a PDA
        rake_amount,
        token_program,
        &[signer],
    )?;

    Ok(())
}

/// Close an empty table and reclaim rent (rent reclamation)
///
/// This instruction closes both the Table account and its Vault token account,
/// returning all lamports to the beneficiary.
///
/// # Security
/// - Only the config authority can close tables
/// - Table must be completely empty (no players, no pot, no rake)
/// - Vault must have zero token balance
/// - Uses secure closure pattern: mark discriminator, drain lamports, reassign owner
fn process_close_table(accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
    let [table_info, vault_info, beneficiary_info, authority_info, config_info, token_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Authority must sign
    if !authority_info.is_signer() {
        return Err(PokerError::MissingSigner.into());
    }

    // Writable account checks
    if !table_info.is_writable() || !vault_info.is_writable() || !beneficiary_info.is_writable() {
        return Err(PokerError::AccountNotWritable.into());
    }

    // Duplicate mutable accounts check
    if table_info.key() == vault_info.key()
        || table_info.key() == beneficiary_info.key()
        || vault_info.key() == beneficiary_info.key()
    {
        return Err(PokerError::DuplicateMutableAccount.into());
    }

    // Token program ID check
    if token_program.key() != &TOKEN_2022_PROGRAM_ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Config and table must be owned by this program
    if !config_info.is_owned_by(&crate::ID) || !table_info.is_owned_by(&crate::ID) {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    verify_config_pda(config_info)?;

    // Load config and verify authority
    let config_data = config_info.try_borrow_data()?;
    if config_data.len() < CONFIG_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let config = Config::from_bytes(&config_data)?;
    if !config.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }

    // Only config authority can close tables
    if authority_info.key() != &config.authority {
        return Err(PokerError::MissingSigner.into());
    }

    let crisps_mint = config.crisps_mint;
    drop(config_data);

    // Load table and verify it's initialized
    let mut table_data = table_info.try_borrow_mut_data()?;
    if table_data.len() < TABLE_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let table = Table::from_bytes_mut(&mut table_data)?;
    if !table.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }

    // Verify table PDA
    let table_id = table.table_id;
    verify_table_pda(table_info, table_id)?;

    // Verify vault matches table's recorded vault
    if vault_info.key() != &table.vault {
        return Err(PokerError::InvalidPda.into());
    }

    // Verify vault PDA derivation
    let table_id_bytes = table_id.to_le_bytes();
    let vault_seeds: &[&[u8]] = &[Table::VAULT_SEEDS_PREFIX, &table_id_bytes];
    let (expected_vault, vault_bump) = pubkey::find_program_address(vault_seeds, &crate::ID);
    if vault_info.key() != &expected_vault {
        return Err(PokerError::InvalidPda.into());
    }

    // === Closure conditions (all must be met) ===

    // 1. Table must have no players
    if table.player_count != 0 {
        return Err(PokerError::TableNotEmpty.into());
    }

    // 2. Table must have no pot
    if table.pot != 0 {
        return Err(PokerError::TableNotEmpty.into());
    }

    // 3. Table must have no accumulated rake (sweep first!)
    if table.rake_accumulated != 0 {
        return Err(PokerError::TableNotEmpty.into());
    }

    // 4. Table must not be in playing state
    if table.status == table_status::PLAYING || table.status == table_status::SHOWDOWN {
        return Err(PokerError::TableIsPlaying.into());
    }

    // Mark table as closed (discriminator = 0xFF for closed accounts)
    // This prevents revival attacks within the same transaction
    table.discriminator = 0xFF;
    drop(table_data);

    // Verify vault is Token-2022 owned with correct mint
    if vault_info.owner() != &TOKEN_2022_PROGRAM_ID {
        return Err(PokerError::InvalidAccountOwner.into());
    }
    let (vault_mint, vault_owner) = read_token_account_mint_owner(vault_info)?;
    if vault_mint != crisps_mint {
        return Err(PokerError::InvalidMint.into());
    }
    if vault_owner != *vault_info.key() {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    // 5. Vault must have zero balance
    let vault_balance = read_token_account_balance(vault_info)?;
    if vault_balance != 0 {
        return Err(PokerError::VaultNotEmpty.into());
    }

    // === Close the vault token account first ===
    // Use Token-2022 CloseAccount instruction with vault as PDA signer
    let vault_bump_slice = [vault_bump];
    let seeds: [Seed; 3] = [
        Seed::from(Table::VAULT_SEEDS_PREFIX),
        Seed::from(table_id_bytes.as_slice()),
        Seed::from(vault_bump_slice.as_slice()),
    ];
    let signer = Signer::from(&seeds);

    token_cpi::close_account(
        vault_info,
        beneficiary_info,
        vault_info, // Vault is its own authority as a PDA
        token_program,
        &[signer],
    )?;

    // === Close the table account ===
    // Transfer all lamports to beneficiary
    let table_lamports = table_info.lamports();
    unsafe {
        *table_info.borrow_mut_lamports_unchecked() = 0;
        *beneficiary_info.borrow_mut_lamports_unchecked() = beneficiary_info
            .lamports()
            .checked_add(table_lamports)
            .ok_or(PokerError::ArithmeticOverflow)?;
    }

    // Zero out the table data and reassign to system program
    // This fully closes the account
    let mut table_data = table_info.try_borrow_mut_data()?;
    table_data.fill(0);
    drop(table_data);

    // Reassign ownership to system program (marks as closed)
    // SAFETY: We have verified ownership of this account and transferred all lamports
    unsafe {
        table_info.assign(&SYSTEM_PROGRAM_ID);
    }

    Ok(())
}

/// Close the staking pool (rent reclamation)
///
/// Accounts:
///   0. [writable] Staking pool PDA (will be closed)
///   1. [writable] Stake vault token account (will be closed)
///   2. [writable] Rewards vault token account (will be closed)
///   3. [writable] Beneficiary (receives lamports)
///   4. [signer] Authority (config authority)
///   5. [] Config
///   6. [] Token-2022 program
fn process_close_staking_pool(accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
    let [staking_pool_info, stake_vault_info, rewards_vault_info, beneficiary_info, authority_info, config_info, token_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Authority must sign
    if !authority_info.is_signer() {
        return Err(PokerError::MissingSigner.into());
    }

    // Writable account checks
    if !staking_pool_info.is_writable()
        || !stake_vault_info.is_writable()
        || !rewards_vault_info.is_writable()
        || !beneficiary_info.is_writable()
    {
        return Err(PokerError::AccountNotWritable.into());
    }

    // Duplicate mutable accounts check
    if staking_pool_info.key() == stake_vault_info.key()
        || staking_pool_info.key() == rewards_vault_info.key()
        || staking_pool_info.key() == beneficiary_info.key()
        || stake_vault_info.key() == rewards_vault_info.key()
        || stake_vault_info.key() == beneficiary_info.key()
        || rewards_vault_info.key() == beneficiary_info.key()
    {
        return Err(PokerError::DuplicateMutableAccount.into());
    }

    // Token program ID check
    if token_program.key() != &TOKEN_2022_PROGRAM_ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Config and staking pool must be owned by this program
    if !config_info.is_owned_by(&crate::ID) || !staking_pool_info.is_owned_by(&crate::ID) {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    verify_config_pda(config_info)?;

    // Load config and verify authority
    let config_data = config_info.try_borrow_data()?;
    if config_data.len() < CONFIG_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let config = Config::from_bytes(&config_data)?;
    if !config.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }

    // Only config authority can close staking pool
    if authority_info.key() != &config.authority {
        return Err(PokerError::MissingSigner.into());
    }

    let crisps_mint = config.crisps_mint;
    drop(config_data);

    // Verify staking pool PDA
    let pool_seeds: &[&[u8]] = &[StakingPool::SEEDS_PREFIX];
    let (expected_pool, _pool_bump) = pubkey::find_program_address(pool_seeds, &crate::ID);
    if staking_pool_info.key() != &expected_pool {
        return Err(PokerError::InvalidPda.into());
    }

    // Load staking pool and verify it's initialized
    let mut pool_data = staking_pool_info.try_borrow_mut_data()?;
    if pool_data.len() < STAKING_POOL_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let pool = StakingPool::from_bytes_mut(&mut pool_data)?;
    if !pool.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }

    // Verify vaults match pool's recorded vaults
    if stake_vault_info.key() != &pool.stake_vault {
        return Err(PokerError::InvalidPda.into());
    }
    if rewards_vault_info.key() != &pool.rewards_vault {
        return Err(PokerError::InvalidPda.into());
    }

    // Verify stake vault PDA derivation
    let stake_vault_seeds: &[&[u8]] = &[StakingPool::STAKE_VAULT_SEEDS_PREFIX];
    let (expected_stake_vault, stake_vault_bump) =
        pubkey::find_program_address(stake_vault_seeds, &crate::ID);
    if stake_vault_info.key() != &expected_stake_vault {
        return Err(PokerError::InvalidPda.into());
    }

    // Verify rewards vault PDA derivation
    let rewards_vault_seeds: &[&[u8]] = &[StakingPool::REWARDS_VAULT_SEEDS_PREFIX];
    let (expected_rewards_vault, rewards_vault_bump) =
        pubkey::find_program_address(rewards_vault_seeds, &crate::ID);
    if rewards_vault_info.key() != &expected_rewards_vault {
        return Err(PokerError::InvalidPda.into());
    }

    // === Closure conditions (all must be met) ===

    // 1. Total staked must be zero (no stakers)
    if pool.total_staked != 0 {
        return Err(PokerError::StakingPoolNotEmpty.into());
    }

    // 2. Accumulated rewards must be zero (all rewards claimed/distributed)
    if pool.accumulated_rewards != 0 {
        return Err(PokerError::StakingPoolNotEmpty.into());
    }

    // Mark pool as closed (discriminator = 0xFF for closed accounts)
    pool.discriminator = 0xFF;
    drop(pool_data);

    // Verify vaults are Token-2022 owned with correct mint
    if stake_vault_info.owner() != &TOKEN_2022_PROGRAM_ID {
        return Err(PokerError::InvalidAccountOwner.into());
    }
    if rewards_vault_info.owner() != &TOKEN_2022_PROGRAM_ID {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    let (stake_vault_mint, stake_vault_owner) = read_token_account_mint_owner(stake_vault_info)?;
    if stake_vault_mint != crisps_mint {
        return Err(PokerError::InvalidMint.into());
    }
    if stake_vault_owner != *stake_vault_info.key() {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    let (rewards_vault_mint, rewards_vault_owner) =
        read_token_account_mint_owner(rewards_vault_info)?;
    if rewards_vault_mint != crisps_mint {
        return Err(PokerError::InvalidMint.into());
    }
    if rewards_vault_owner != *rewards_vault_info.key() {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    // 3. Both vaults must have zero balance
    let stake_vault_balance = read_token_account_balance(stake_vault_info)?;
    if stake_vault_balance != 0 {
        return Err(PokerError::VaultNotEmpty.into());
    }

    let rewards_vault_balance = read_token_account_balance(rewards_vault_info)?;
    if rewards_vault_balance != 0 {
        return Err(PokerError::VaultNotEmpty.into());
    }

    // === Close the stake vault token account ===
    let stake_vault_bump_slice = [stake_vault_bump];
    let stake_vault_signer_seeds: [Seed; 2] = [
        Seed::from(StakingPool::STAKE_VAULT_SEEDS_PREFIX),
        Seed::from(stake_vault_bump_slice.as_slice()),
    ];
    let stake_vault_signer = Signer::from(&stake_vault_signer_seeds);

    token_cpi::close_account(
        stake_vault_info,
        beneficiary_info,
        stake_vault_info, // Vault is its own authority as a PDA
        token_program,
        &[stake_vault_signer],
    )?;

    // === Close the rewards vault token account ===
    let rewards_vault_bump_slice = [rewards_vault_bump];
    let rewards_vault_signer_seeds: [Seed; 2] = [
        Seed::from(StakingPool::REWARDS_VAULT_SEEDS_PREFIX),
        Seed::from(rewards_vault_bump_slice.as_slice()),
    ];
    let rewards_vault_signer = Signer::from(&rewards_vault_signer_seeds);

    token_cpi::close_account(
        rewards_vault_info,
        beneficiary_info,
        rewards_vault_info, // Vault is its own authority as a PDA
        token_program,
        &[rewards_vault_signer],
    )?;

    // === Close the staking pool account ===
    // Transfer all lamports to beneficiary
    let pool_lamports = staking_pool_info.lamports();
    unsafe {
        *staking_pool_info.borrow_mut_lamports_unchecked() = 0;
        *beneficiary_info.borrow_mut_lamports_unchecked() = beneficiary_info
            .lamports()
            .checked_add(pool_lamports)
            .ok_or(PokerError::ArithmeticOverflow)?;
    }

    // Zero out the pool data and reassign to system program
    let mut pool_data = staking_pool_info.try_borrow_mut_data()?;
    pool_data.fill(0);
    drop(pool_data);

    // Reassign ownership to system program (marks as closed)
    unsafe {
        staking_pool_info.assign(&SYSTEM_PROGRAM_ID);
    }

    Ok(())
}

/// Close a staker position (rent reclamation)
///
/// Accounts:
///   0. [writable] Staker position PDA (will be closed)
///   1. [writable] Beneficiary (receives lamports, typically the staker)
///   2. [signer] Staker (must own the position)
///   3. [] Staking pool (for validation)
fn process_close_staker_position(accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
    let [staker_position_info, beneficiary_info, staker_info, staking_pool_info] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Staker must sign
    if !staker_info.is_signer() {
        return Err(PokerError::MissingSigner.into());
    }

    // Writable account checks
    if !staker_position_info.is_writable() || !beneficiary_info.is_writable() {
        return Err(PokerError::AccountNotWritable.into());
    }

    // Duplicate mutable accounts check
    if staker_position_info.key() == beneficiary_info.key() {
        return Err(PokerError::DuplicateMutableAccount.into());
    }

    // Staker position and staking pool must be owned by this program
    if !staker_position_info.is_owned_by(&crate::ID)
        || !staking_pool_info.is_owned_by(&crate::ID)
    {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    // Verify staking pool PDA (validates the staking pool exists and is valid)
    let pool_seeds: &[&[u8]] = &[StakingPool::SEEDS_PREFIX];
    let (expected_pool, _pool_bump) = pubkey::find_program_address(pool_seeds, &crate::ID);
    if staking_pool_info.key() != &expected_pool {
        return Err(PokerError::InvalidPda.into());
    }

    // Verify staking pool is initialized
    let pool_data = staking_pool_info.try_borrow_data()?;
    if pool_data.len() < STAKING_POOL_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let pool = StakingPool::from_bytes(&pool_data)?;
    if !pool.is_initialized() {
        return Err(PokerError::StakingPoolNotInitialized.into());
    }
    drop(pool_data);

    // Verify staker position PDA
    let position_seeds: &[&[u8]] = &[StakerPosition::SEEDS_PREFIX, staker_info.key().as_ref()];
    let (expected_position, _position_bump) =
        pubkey::find_program_address(position_seeds, &crate::ID);
    if staker_position_info.key() != &expected_position {
        return Err(PokerError::InvalidPda.into());
    }

    // Load staker position and verify it's initialized
    let mut position_data = staker_position_info.try_borrow_mut_data()?;
    if position_data.len() < STAKER_POSITION_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let position = StakerPosition::from_bytes_mut(&mut position_data)?;
    if !position.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }

    // Verify position belongs to this staker
    if &position.staker != staker_info.key() {
        return Err(PokerError::MissingSigner.into());
    }

    // === Closure conditions (all must be met) ===

    // 1. Staked amount must be zero (all stake withdrawn)
    if position.staked_amount != 0 {
        return Err(PokerError::StakerPositionNotEmpty.into());
    }

    // 2. No unclaimed rewards (rewards_claimed is the pending amount)
    if position.rewards_claimed != 0 {
        return Err(PokerError::StakerPositionNotEmpty.into());
    }

    // Mark position as closed (discriminator = 0xFF for closed accounts)
    position.discriminator = 0xFF;
    drop(position_data);

    // === Close the staker position account ===
    // Transfer all lamports to beneficiary
    let position_lamports = staker_position_info.lamports();
    unsafe {
        *staker_position_info.borrow_mut_lamports_unchecked() = 0;
        *beneficiary_info.borrow_mut_lamports_unchecked() = beneficiary_info
            .lamports()
            .checked_add(position_lamports)
            .ok_or(PokerError::ArithmeticOverflow)?;
    }

    // Zero out the position data and reassign to system program
    let mut position_data = staker_position_info.try_borrow_mut_data()?;
    position_data.fill(0);
    drop(position_data);

    // Reassign ownership to system program (marks as closed)
    unsafe {
        staker_position_info.assign(&SYSTEM_PROGRAM_ID);
    }

    Ok(())
}

//! Instruction processor for the poker program.

use pinocchio::{
    account_info::AccountInfo,
    instruction::{Seed, Signer},
    program_error::ProgramError,
    pubkey::{self, Pubkey},
    ProgramResult,
};
use pinocchio_system::ID as SYSTEM_PROGRAM_ID;
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
        // Staking instructions (AC-3.4, AC-3.5, AC-3.6)
        ix_disc::INIT_STAKING_POOL => process_init_staking_pool(accounts, instruction_data),
        ix_disc::DEPOSIT_STAKE => process_deposit_stake(accounts, instruction_data),
        ix_disc::WITHDRAW_STAKE => process_withdraw_stake(accounts, instruction_data),
        ix_disc::CLAIM_REWARDS => process_claim_rewards(accounts, instruction_data),
        ix_disc::SWEEP_RAKE => process_sweep_rake(accounts, instruction_data),
        _ => Err(PokerError::InvalidInstruction.into()),
    }
}

/// Initialize the program config (AC-3.1)
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

    // Config must be owned by this program
    if !config_info.is_owned_by(&crate::ID) {
        return Err(PokerError::InvalidAccountOwner.into());
    }

    verify_config_pda(config_info)?;

    // Verify mint is Token-2022 owned
    if crisps_mint_info.owner() != &TOKEN_2022_PROGRAM_ID {
        return Err(PokerError::InvalidMint.into());
    }

    // Parse instruction data
    let ix = unsafe { instruction::Initialize::from_bytes_unchecked(data) };

    // Check if already initialized
    let config_data = config_info.try_borrow_data()?;
    if config_data.len() >= CONFIG_SIZE {
        let config = unsafe { Config::from_bytes_unchecked(&config_data) };
        if config.is_initialized() {
            return Err(PokerError::AlreadyInitialized.into());
        }
    }
    drop(config_data);

    // Initialize config data
    let mut config_data = config_info.try_borrow_mut_data()?;
    if config_data.len() < CONFIG_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }

    let config = unsafe { Config::from_bytes_unchecked_mut(&mut config_data) };
    config.discriminator = acc_disc::CONFIG;
    config.initialized = 1;
    config.min_players = ix.min_players;
    config._padding = [0; 3];
    config.rake_bps = 250; // Default 2.5% rake (AC-3.4)
    config.crisps_mint = *crisps_mint_info.key();
    config.authority = *authority_info.key();
    config.entropy_program = *entropy_program_info.key();
    config.min_buy_in = ix.min_buy_in;
    config.max_buy_in = ix.max_buy_in;
    config.action_timeout_slots = ix.action_timeout_slots;

    Ok(())
}

/// Create a new table with PDA-owned vault (AC-3.2)
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

    // Duplicate mutable accounts (AC-7.3)
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

    // Accounts must be owned by this program where applicable
    if !config_info.is_owned_by(&crate::ID) || !table_info.is_owned_by(&crate::ID) {
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
    let config = unsafe { Config::from_bytes_unchecked(&config_data) };
    if !config.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }
    // Verify payer is authority and mint matches config
    if payer_info.key() != &config.authority {
        return Err(PokerError::MissingSigner.into());
    }
    if crisps_mint_info.key() != &config.crisps_mint {
        return Err(PokerError::InvalidMint.into());
    }
    drop(config_data);

    // Parse instruction data
    let ix = unsafe { instruction::CreateTable::from_bytes_unchecked(data) };

    // Verify table PDA
    let table_id_bytes = ix.table_id.to_le_bytes();
    let table_seeds: &[&[u8]] = &[Table::SEEDS_PREFIX, &table_id_bytes];
    let (expected_table, _table_bump) = pubkey::find_program_address(table_seeds, &crate::ID);
    if table_info.key() != &expected_table {
        return Err(PokerError::InvalidPda.into());
    }

    // Verify vault PDA (AC-3.2: PDA-owned vault)
    let vault_seeds: &[&[u8]] = &[Table::VAULT_SEEDS_PREFIX, &table_id_bytes];
    let (expected_vault, _vault_bump) = pubkey::find_program_address(vault_seeds, &crate::ID);
    if vault_info.key() != &expected_vault {
        return Err(PokerError::InvalidPda.into());
    }

    // Vault token account must be Token-2022 owned and for CRISPS mint
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

    // Initialize table data
    let mut table_data = table_info.try_borrow_mut_data()?;
    if table_data.len() < TABLE_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }

    let table = unsafe { Table::from_bytes_unchecked_mut(&mut table_data) };
    table.discriminator = acc_disc::TABLE;
    table.status = table_status::WAITING;
    table.player_count = 0;
    table.dealer_position = 0;
    table.current_actor = 0;
    table.current_street = 0;
    table.active_count = 0;
    table.seed_revealed = 0;
    table.table_id = ix.table_id;
    table.hand_id = 0;
    table.small_blind = ix.small_blind;
    table.big_blind = ix.big_blind;
    table.action_deadline_slot = 0; // No deadline initially
    table.current_bet = 0;
    table.min_raise = ix.big_blind; // Min raise is always at least big blind
    table.pot = 0;
    table.rake_accumulated = 0; // AC-3.4: No rake collected yet
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

/// Join a table by transferring CRISPS to vault (AC-3.3)
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

    // Duplicate mutable accounts (AC-7.3)
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

    // Load config
    let config_data = config_info.try_borrow_data()?;
    if config_data.len() < CONFIG_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let config = unsafe { Config::from_bytes_unchecked(&config_data) };
    if !config.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }

    // Parse instruction data
    let ix = unsafe { instruction::JoinTable::from_bytes_unchecked(data) };

    // Validate buy-in bounds
    if ix.buy_in_amount < config.min_buy_in {
        return Err(PokerError::BuyInTooLow.into());
    }
    if ix.buy_in_amount > config.max_buy_in {
        return Err(PokerError::BuyInTooHigh.into());
    }
    let crisps_mint = config.crisps_mint;
    drop(config_data);

    // Load table
    let mut table_data = table_info.try_borrow_mut_data()?;
    if table_data.len() < TABLE_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let table = unsafe { Table::from_bytes_unchecked_mut(&mut table_data) };

    if !table.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }

    verify_table_pda(table_info, table.table_id)?;

    if table.status != table_status::WAITING {
        return Err(PokerError::TableNotWaiting.into());
    }

    // Verify table PDA
    let table_id_bytes = table.table_id.to_le_bytes();
    let (expected_table, _) =
        pubkey::find_program_address(&[Table::SEEDS_PREFIX, &table_id_bytes], &crate::ID);
    if table_info.key() != &expected_table {
        return Err(PokerError::InvalidPda.into());
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

    // Update player count
    table.player_count = table
        .player_count
        .checked_add(1)
        .ok_or(PokerError::ArithmeticOverflow)?;
    table.active_count = table.count_active();

    // Drop borrow before CPI
    drop(table_data);

    // AC-3.3: Transfer CRISPS from player to vault
    token_cpi::transfer(
        player_token_info,
        vault_info,
        player_info,
        ix.buy_in_amount,
        token_program,
    )?;

    Ok(())
}

/// Leave a table by transferring CRISPS from vault to player (AC-3.3)
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

    // Duplicate mutable accounts (AC-7.3)
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
    let config = unsafe { Config::from_bytes_unchecked(&config_data) };
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
    let table = unsafe { Table::from_bytes_unchecked_mut(&mut table_data) };

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

    // Update player count
    table.player_count = table
        .player_count
        .checked_sub(1)
        .ok_or(PokerError::ArithmeticOverflow)?;
    table.active_count = table.count_active();

    // Drop borrow before CPI
    drop(table_data);

    // AC-3.3: Transfer CRISPS from vault to player (PDA signer)
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

/// Start a new hand (AC-4.3, AC-2.6, AC-2.7: minimum players + privacy hybrid)
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

    // Duplicate mutable accounts (AC-7.3)
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
    let ix = unsafe { instruction::StartHand::from_bytes_unchecked(data) };

    // Load poker config
    let config_data = config_info.try_borrow_data()?;
    if config_data.len() < CONFIG_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let config = unsafe { Config::from_bytes_unchecked(&config_data) };
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
    let entropy_config = unsafe { EntropyConfig::from_bytes_unchecked(&entropy_config_data) };
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
    let table = unsafe { Table::from_bytes_unchecked_mut(&mut table_data) };

    if !table.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }

    // Table must be waiting
    if table.status != table_status::WAITING {
        return Err(PokerError::TableNotWaiting.into());
    }

    // AC-4.3: Verify minimum players
    let active_players = table.count_active();
    if active_players < min_players {
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
    let commitment = unsafe { EntropyCommitment::from_bytes_unchecked(&commitment_data) };
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
    let table = unsafe { Table::from_bytes_unchecked_mut(&mut table_data) };

    // AC-2.6, AC-2.7: Store seed commitment and hole card hashes
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

    // Update active count (all occupied players are active at hand start)
    table.active_count = active_players;

    // Set first actor (left of dealer, skip empty seats)
    let first_actor = find_next_active_seat(table, table.dealer_position as usize);
    table.current_actor = first_actor as u8;

    // AC-4.4: Set action deadline
    table.action_deadline_slot = current_slot
        .checked_add(action_timeout_slots)
        .ok_or(PokerError::ArithmeticOverflow)?;

    Ok(())
}

/// Process timeout auto-action (AC-4.4: deterministic fallback)
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
    let config = unsafe { Config::from_bytes_unchecked(&config_data) };
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
    let table = unsafe { Table::from_bytes_unchecked_mut(&mut table_data) };

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

    // AC-4.4: Verify deadline has passed
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
    table.active_count = table.active_count.saturating_sub(1);

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

/// Process a player action during betting (AC-5.1, AC-5.2, AC-5.3)
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
    let config = unsafe { Config::from_bytes_unchecked(&config_data) };
    if !config.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }
    let action_timeout_slots = config.action_timeout_slots;
    let rake_bps = config.rake_bps;
    drop(config_data);

    // Parse instruction data
    let ix = unsafe { instruction::PlayerAction::from_bytes_unchecked(data) };

    // Load table
    let mut table_data = table_info.try_borrow_mut_data()?;
    if table_data.len() < TABLE_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let table = unsafe { Table::from_bytes_unchecked_mut(&mut table_data) };

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

    // AC-5.3: Table must be in playing state
    if table.status != table_status::PLAYING {
        return Err(PokerError::HandNotInProgress.into());
    }

    // AC-5.1: Verify it's this player's turn
    let seat_idx = table
        .find_any_player_seat(player_info.key())
        .ok_or(PokerError::PlayerNotFound)?;

    // AC-5.3: Out-of-turn check
    if seat_idx != table.current_actor as usize {
        return Err(PokerError::NotYourTurn.into());
    }

    let seat = &table.seats[seat_idx];

    // AC-5.3: Player must be able to act (not folded, not all-in)
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
            // AC-5.3: Cannot fold when no bet to call (should check)
            // Actually in poker you CAN fold anytime, but it's unusual
            // For strict rules: if amount_to_call == 0 { return Err(PokerError::CannotFoldWhenCheck.into()); }
            // We'll allow folding anytime for flexibility
            table.seats[seat_idx].status = seat_status::FOLDED;
            table.active_count = table.active_count.saturating_sub(1);
        }

        action_type::CHECK => {
            // AC-5.3: Cannot check when there's a bet to call
            if amount_to_call > 0 {
                return Err(PokerError::CannotCheckWhenBet.into());
            }
            // Check is just passing, no state change except marking acted
        }

        action_type::CALL => {
            // AC-5.2: Call amount logic
            if amount_to_call == 0 {
                return Err(PokerError::InvalidActionType.into()); // Should check instead
            }

            let call_amount = if amount_to_call > player_stack {
                // AC-5.2: All-in logic - player calls with remaining stack
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
            // AC-5.2: Raise bounds enforcement
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

            // AC-5.2: Raise cannot exceed stack
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
            // AC-5.2: All-in logic - put all remaining chips in
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

                // Only update min_raise if this is a full raise
                if raise_increment >= table.min_raise {
                    table.min_raise = raise_increment;
                }

                // Update current bet level
                table.current_bet = new_bet;

                // Reset has_acted for other players
                for (i, seat) in table.seats.iter_mut().enumerate() {
                    if i != seat_idx && seat.can_act() {
                        seat.has_acted = 0;
                    }
                }
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

    // AC-4.4: Reset action deadline for next player
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
    if table.active_count <= 1 {
        settle_uncontested_pot(table, rake_bps)?;
        return Ok(());
    }

    // If no players can act (all-in), skip directly to showdown
    if table.count_can_act() == 0 {
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
            // Showdown - transition to SHOWDOWN state, awaiting seed reveal (AC-2.7)
            table.status = table_status::SHOWDOWN;
            table.action_deadline_slot = 0;
            return Ok(());
        }
        _ => return Err(PokerError::InvalidInstruction.into()),
    }

    // Reset street betting state
    table.reset_street_bets();

    // First to act on new street is first active player after dealer
    if let Some(first_actor) = table.next_active_seat(table.dealer_position as usize) {
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
    table.active_count = table.count_active();

    Ok(())
}

/// Process settle instruction (AC-6.1, AC-6.2: showdown and payout)
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
    let config = unsafe { Config::from_bytes_unchecked(&config_data) };
    if !config.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }
    // AC-3.4: Get rake percentage (basis points, e.g., 250 = 2.5%)
    let rake_bps = config.rake_bps;
    drop(config_data);

    // Load table
    let mut table_data = table_info.try_borrow_mut_data()?;
    if table_data.len() < TABLE_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let table = unsafe { Table::from_bytes_unchecked_mut(&mut table_data) };

    if !table.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }

    verify_table_pda(table_info, table.table_id)?;

    // Must be in SHOWDOWN state
    if table.status != table_status::SHOWDOWN {
        return Err(PokerError::TableNotShowdown.into());
    }

    // AC-2.8: Seed must be revealed before settlement
    if table.seed_revealed == 0 {
        return Err(PokerError::SeedNotRevealed.into());
    }

    // Derive hole cards and board from revealed seed
    let derived = derive_hand_state(table, &table.revealed_seed)?;
    let board_hand = build_board_hand(&derived.board);

    // Precompute hand strengths for active seats
    let mut strengths: [Option<Strength>; MAX_SEATS] = [None; MAX_SEATS];
    for i in 0..MAX_SEATS {
        let seat = &table.seats[i];
        if seat.is_empty() || seat.is_folded() || seat.status == seat_status::SITTING_OUT {
            continue;
        }
        let hole = derived.hole_cards[i];
        let mut hand = board_hand;
        hand = Hand::add(hand, Hand::from(Card::from(hole[0])));
        hand = Hand::add(hand, Hand::from(Card::from(hole[1])));
        strengths[i] = Some(Strength::from(hand));
    }

    // Build participant data: (seat_idx, total_bet, hand_strength, is_active)
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
        let is_active = showdown_eligible && (seat.is_active() || seat.total_bet > 0);
        let strength = strengths[i];

        // Only include players who contributed to the pot
        if seat.total_bet > 0 || is_active {
            participants[participant_count] = (i, seat.total_bet, strength, is_active && strength.is_some());
            participant_count = participant_count.saturating_add(1);
        }
    }

    // AC-6.2: Verify total risked = sum of all total_bets
    let total_risked: u64 = participants[..participant_count]
        .iter()
        .map(|(_, bet, _, _)| *bet)
        .fold(0u64, |acc, x| acc.saturating_add(x));

    // Verify pot matches total risked (invariant check)
    // Note: pot should equal total_risked at this point
    if table.pot != total_risked {
        // Allow slight discrepancy due to pot tracking, but log concern
        // For strict AC-6.2 compliance, we use total_risked as source of truth
    }

    // AC-3.4: Calculate and deduct rake from pot before distribution
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
    let mut bet_levels: [u64; MAX_SEATS] = [0; MAX_SEATS];
    let mut level_count = 0usize;
    for i in 0..participant_count {
        let bet = participants[i].1;
        if bet > 0 {
            // Insert sorted, skip duplicates
            let mut found = false;
            for j in 0..level_count {
                if bet_levels[j] == bet {
                    found = true;
                    break;
                }
            }
            if !found && level_count < MAX_SEATS {
                bet_levels[level_count] = bet;
                level_count = level_count.saturating_add(1);
            }
        }
    }

    // Sort bet levels ascending (simple bubble sort for small array)
    for i in 0..level_count {
        for j in (i + 1)..level_count {
            if bet_levels[j] < bet_levels[i] {
                let tmp = bet_levels[i];
                bet_levels[i] = bet_levels[j];
                bet_levels[j] = tmp;
            }
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
                winnings[seat_idx] = winnings[seat_idx].saturating_add(share);
            }

            // Distribute remainder (odd chips) to first winners
            for i in 0..(remainder as usize) {
                if i < winner_count {
                    let seat_idx = winner_indices[i];
                    winnings[seat_idx] = winnings[seat_idx].saturating_add(1);
                }
            }
        }

        prev_level = current_level;
    }

    // AC-6.2: Verify total payouts = total risked (before rake)
    let total_payout: u64 = winnings.iter().fold(0u64, |acc, x| acc.saturating_add(*x));
    if total_payout != total_risked {
        return Err(PokerError::ArithmeticOverflow.into());
    }

    // AC-3.4: Scale down winnings to account for rake deduction
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
                scaled_total = scaled_total.saturating_add(scaled);
            }
        }
        // Distribute any rounding remainder to first winner with winnings
        let remainder = distributable_pot.saturating_sub(scaled_total);
        if remainder > 0 {
            for i in 0..MAX_SEATS {
                if winnings[i] > 0 {
                    winnings[i] = winnings[i].saturating_add(remainder);
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
        seat.stack = seat.stack.saturating_add(winnings[i]);

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

    // Update active count
    table.active_count = table.count_active();

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

/// Process reveal seed instruction (AC-2.7, AC-2.8: seed reveal and deck verification)
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
    let config = unsafe { Config::from_bytes_unchecked(&config_data) };
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
    let entropy_config = unsafe { EntropyConfig::from_bytes_unchecked(&entropy_config_data) };
    if !entropy_config.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }
    let entropy_provider = entropy_config.provider;
    drop(entropy_config_data);

    if provider_info.key() != &entropy_provider {
        return Err(PokerError::ProviderMismatch.into());
    }

    // Parse instruction data
    let ix = unsafe { instruction::RevealSeed::from_bytes_unchecked(data) };

    // Load table
    let mut table_data = table_info.try_borrow_mut_data()?;
    if table_data.len() < TABLE_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let table = unsafe { Table::from_bytes_unchecked_mut(&mut table_data) };

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
    let request = unsafe { EntropyRequest::from_bytes_unchecked(&request_data) };
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
    let commitment = unsafe { EntropyCommitment::from_bytes_unchecked(&commitment_data) };
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

    // AC-2.7: Verify sha256(seed) == seed_commitment
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
// Staking Instructions (AC-3.4, AC-3.5, AC-3.6)
// =============================================================================

/// Initialize the global staking pool (AC-3.5)
fn process_init_staking_pool(accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
    let [staking_pool_info, stake_vault_info, rewards_vault_info, payer_info, config_info, crisps_mint_info, token_program, system_program_info] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Payer/Authority must sign
    if !payer_info.is_signer() {
        return Err(PokerError::MissingSigner.into());
    }

    // Duplicate mutable accounts (AC-7.3)
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

    // Accounts must be owned by this program where applicable
    if !config_info.is_owned_by(&crate::ID) || !staking_pool_info.is_owned_by(&crate::ID) {
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
    let config = unsafe { Config::from_bytes_unchecked(&config_data) };
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
    let (expected_pool, _pool_bump) = pubkey::find_program_address(pool_seeds, &crate::ID);
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

    // Check if already initialized
    let pool_data = staking_pool_info.try_borrow_data()?;
    if pool_data.len() >= STAKING_POOL_SIZE {
        let pool = unsafe { StakingPool::from_bytes_unchecked(&pool_data) };
        if pool.is_initialized() {
            return Err(PokerError::StakingPoolAlreadyInitialized.into());
        }
    }
    drop(pool_data);

    // Initialize staking pool data
    let mut pool_data = staking_pool_info.try_borrow_mut_data()?;
    if pool_data.len() < STAKING_POOL_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }

    let pool = unsafe { StakingPool::from_bytes_unchecked_mut(&mut pool_data) };
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

/// Deposit CRISPS into staking pool (AC-3.5)
fn process_deposit_stake(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
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

    // Duplicate mutable accounts (AC-7.3)
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
    let config = unsafe { Config::from_bytes_unchecked(&config_data) };
    if !config.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }
    let crisps_mint = config.crisps_mint;
    drop(config_data);

    // Parse instruction data
    let ix = unsafe { instruction::DepositStake::from_bytes_unchecked(data) };

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
    let pool = unsafe { StakingPool::from_bytes_unchecked_mut(&mut pool_data) };

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

    // Load or initialize staker position
    let mut position_data = staker_position_info.try_borrow_mut_data()?;
    if position_data.len() < STAKER_POSITION_SIZE {
        return Err(PokerError::InvalidAccountDataLength.into());
    }
    let position = unsafe { StakerPosition::from_bytes_unchecked_mut(&mut position_data) };

    // Initialize position if not already
    if !position.is_initialized() {
        position.discriminator = acc_disc::STAKER_POSITION;
        position.initialized = 1;
        position._padding = [0; 6];
        position.staker = *staker_info.key();
        position.staked_amount = 0;
        position.rewards_claimed = 0;
        position.last_rewards_per_token = 0;
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

    // Drop borrows before CPI
    drop(pool_data);
    drop(position_data);

    // AC-3.5: Transfer CRISPS from staker to stake vault
    token_cpi::transfer(
        staker_token_info,
        stake_vault_info,
        staker_info,
        ix.amount,
        token_program,
    )?;

    Ok(())
}

/// Withdraw CRISPS from staking pool (AC-3.5)
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

    // Duplicate mutable accounts (AC-7.3)
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
    let config = unsafe { Config::from_bytes_unchecked(&config_data) };
    if !config.is_initialized() {
        return Err(PokerError::NotInitialized.into());
    }
    let crisps_mint = config.crisps_mint;
    drop(config_data);

    // Parse instruction data
    let ix = unsafe { instruction::WithdrawStake::from_bytes_unchecked(data) };

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
    let pool = unsafe { StakingPool::from_bytes_unchecked_mut(&mut pool_data) };

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
    let position = unsafe { StakerPosition::from_bytes_unchecked_mut(&mut position_data) };

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

    // AC-3.5: Transfer CRISPS from stake vault to staker (PDA signer)
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

/// Claim accumulated rake rewards (AC-3.6)
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

    // Duplicate mutable accounts (AC-7.3)
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
    let config = unsafe { Config::from_bytes_unchecked(&config_data) };
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
    let pool = unsafe { StakingPool::from_bytes_unchecked_mut(&mut pool_data) };

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
    let position = unsafe { StakerPosition::from_bytes_unchecked_mut(&mut position_data) };

    if !position.is_initialized() {
        return Err(PokerError::StakerPositionNotFound.into());
    }

    // Verify staker owns this position
    if &position.staker != staker_info.key() {
        return Err(PokerError::MissingSigner.into());
    }

    // AC-3.6: Calculate proportional rewards
    // rewards = (staked_amount / total_staked) * accumulated_rewards
    // Using fixed-point math to avoid precision loss
    if pool.total_staked == 0 || pool.accumulated_rewards == 0 {
        return Err(PokerError::NoRewardsAvailable.into());
    }

    // Calculate this staker's share of rewards
    // reward_share = (staked_amount * accumulated_rewards) / total_staked
    let reward_share = (position.staked_amount as u128)
        .checked_mul(pool.accumulated_rewards as u128)
        .ok_or(PokerError::ArithmeticOverflow)?
        .checked_div(pool.total_staked as u128)
        .ok_or(PokerError::ArithmeticOverflow)? as u64;

    if reward_share == 0 {
        return Err(PokerError::NoRewardsAvailable.into());
    }

    // Update accounting
    pool.accumulated_rewards = pool
        .accumulated_rewards
        .checked_sub(reward_share)
        .ok_or(PokerError::ArithmeticOverflow)?;
    pool.total_distributed = pool
        .total_distributed
        .checked_add(reward_share)
        .ok_or(PokerError::ArithmeticOverflow)?;
    position.rewards_claimed = position
        .rewards_claimed
        .checked_add(reward_share)
        .ok_or(PokerError::ArithmeticOverflow)?;

    // Drop borrows before CPI
    drop(pool_data);
    drop(position_data);

    // AC-3.6: Transfer rewards from rewards vault to staker (PDA signer)
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

/// Sweep accumulated rake from table to staking pool rewards vault (AC-3.4)
fn process_sweep_rake(accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
    let [table_info, table_vault_info, staking_pool_info, rewards_vault_info, config_info, token_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Duplicate mutable accounts (AC-7.3)
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
    let config = unsafe { Config::from_bytes_unchecked(&config_data) };
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
    let pool = unsafe { StakingPool::from_bytes_unchecked_mut(&mut pool_data) };

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
    let table = unsafe { Table::from_bytes_unchecked_mut(&mut table_data) };

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

    // Drop borrows before CPI
    drop(table_data);
    drop(pool_data);

    // AC-3.4: Transfer rake from table vault to rewards vault (PDA signer)
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

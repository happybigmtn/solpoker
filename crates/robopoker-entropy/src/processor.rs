//! Instruction processor for the entropy program.

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::{self, Pubkey},
    sysvars::{clock::Clock, rent::Rent, slot_hashes::{SlotHashes, SLOTHASHES_ID}, Sysvar},
    ProgramResult,
};
use pinocchio_system::instructions::{CreateAccount, Transfer};

use crate::{
    error::EntropyError,
    instruction::{self, discriminator as ix_disc},
    state::{
        self, commitment_status, derive_randomness, discriminator as acc_disc, request_status,
        sha256, Commitment, Config, COMMITMENT_SIZE, CONFIG_SIZE, REQUEST_SIZE,
    },
};

/// Process an instruction
pub fn process(accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    if instruction_data.is_empty() {
        return Err(EntropyError::InvalidInstruction.into());
    }

    match instruction_data[0] {
        ix_disc::INITIALIZE => process_initialize(accounts, instruction_data),
        ix_disc::COMMIT => process_commit(accounts, instruction_data),
        ix_disc::REVEAL => process_reveal(accounts, instruction_data),
        ix_disc::REQUEST => process_request(accounts, instruction_data),
        ix_disc::FINALIZE => process_finalize(accounts, instruction_data),
        ix_disc::SLASH => process_slash(accounts, instruction_data),
        ix_disc::UPDATE_CONFIG => process_update_config(accounts, instruction_data),
        _ => Err(EntropyError::InvalidInstruction.into()),
    }
}

/// Initialize the program config
fn process_initialize(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < instruction::Initialize::SIZE {
        return Err(EntropyError::InvalidInstruction.into());
    }

    let [config_info, authority_info, provider_info, system_program_info] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Authority must sign
    if !authority_info.is_signer() {
        return Err(EntropyError::MissingSigner.into());
    }

    // System program ID check
    if system_program_info.key() != &pinocchio_system::ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Verify config PDA and get bump
    let seeds: &[&[u8]] = &[b"config"];
    let (expected_config, bump) = pubkey::find_program_address(seeds, &crate::ID);
    if config_info.key() != &expected_config {
        return Err(EntropyError::InvalidPda.into());
    }

    // Parse instruction data
    let ix = instruction::Initialize::from_bytes(data);

    // Create config account if it doesn't exist or is empty
    if config_info.data_len() == 0 {
        // Calculate rent-exempt lamports
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(CONFIG_SIZE);

        // Create the account via CPI with PDA signer seeds
        let bump_seed = [bump];
        let signer_seeds = pinocchio::seeds!(b"config", &bump_seed);
        let signer = pinocchio::instruction::Signer::from(&signer_seeds);

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
            return Err(EntropyError::InvalidAccountOwner.into());
        }

        // Check if already initialized
        let config_data = config_info.try_borrow_data()?;
        if config_data.len() >= CONFIG_SIZE {
            let config = Config::from_bytes(&config_data)?;
            if config.is_initialized() {
                return Err(EntropyError::AlreadyInitialized.into());
            }
        }
        drop(config_data);
    }

    // Initialize config data
    let mut config_data = config_info.try_borrow_mut_data()?;
    if config_data.len() < CONFIG_SIZE {
        return Err(EntropyError::InvalidAccountDataLength.into());
    }

    let config = Config::from_bytes_mut(&mut config_data)?;
    config.discriminator = acc_disc::CONFIG;
    config.initialized = 1;
    config._padding = [0; 6];
    config.provider = *provider_info.key();
    config.authority = *authority_info.key();
    config.min_bond = ix.min_bond;
    config.reveal_window_slots = ix.reveal_window_slots;
    config.slash_basis_points = ix.slash_basis_points;

    Ok(())
}

/// Provider posts a new commitment (AC-POK2.1)
fn process_commit(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < instruction::Commit::SIZE {
        return Err(EntropyError::InvalidInstruction.into());
    }

    let [commitment_info, provider_info, config_info, system_program_info] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Provider must sign
    if !provider_info.is_signer() {
        return Err(EntropyError::MissingSigner.into());
    }

    // Commitment account must be writable
    if !commitment_info.is_writable() {
        return Err(EntropyError::AccountNotWritable.into());
    }

    // Duplicate mutable account check (AC-POK7.3)
    if commitment_info.key() == provider_info.key() {
        return Err(EntropyError::DuplicateMutableAccount.into());
    }

    // System program ID check
    if system_program_info.key() != &pinocchio_system::ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Config must be owned by this program
    if !config_info.is_owned_by(&crate::ID) {
        return Err(EntropyError::InvalidAccountOwner.into());
    }

    // Parse instruction data (no borrow needed)
    let ix = instruction::Commit::from_bytes(data);

    // Verify commitment PDA and get bump BEFORE any borrows
    let sequence_bytes = ix.sequence.to_le_bytes();
    let seeds: [&[u8]; 3] = [
        b"commitment",
        provider_info.key().as_ref(),
        sequence_bytes.as_slice(),
    ];
    let (expected_commitment, bump) = pubkey::find_program_address(&seeds, &crate::ID);
    if commitment_info.key() != &expected_commitment {
        return Err(EntropyError::InvalidPda.into());
    }

    // Create commitment account if it doesn't exist (BEFORE any borrows)
    if commitment_info.data_len() == 0 {
        // Calculate rent-exempt lamports
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(COMMITMENT_SIZE);

        // Build PDA signer seeds
        let bump_seed = [bump];
        let provider_key_bytes: [u8; 32] = *provider_info.key();
        let seq_bytes = ix.sequence.to_le_bytes();
        let signer_seeds = pinocchio::seeds!(b"commitment", &provider_key_bytes, seq_bytes.as_slice(), &bump_seed);
        let signer = pinocchio::instruction::Signer::from(&signer_seeds);

        // Use the same pattern as Initialize - pinocchio-system's CreateAccount
        CreateAccount {
            from: provider_info,
            to: commitment_info,
            lamports,
            space: COMMITMENT_SIZE as u64,
            owner: &crate::ID,
        }
        .invoke_signed(&[signer])?;
    } else {
        // Account already exists, check if owned by this program
        if !commitment_info.is_owned_by(&crate::ID) {
            return Err(EntropyError::InvalidAccountOwner.into());
        }

        // Prevent re-initialization of commitment account
        let commitment_check = commitment_info.try_borrow_data()?;
        if commitment_check.len() >= COMMITMENT_SIZE {
            let existing = Commitment::from_bytes(&commitment_check)?;
            if existing.discriminator == acc_disc::COMMITMENT {
                return Err(EntropyError::AlreadyInitialized.into());
            }
        }
        drop(commitment_check);
    }

    // NOW load and verify config (after CPI is done)
    let config_data = config_info.try_borrow_data()?;
    if config_data.len() < CONFIG_SIZE {
        return Err(EntropyError::InvalidAccountDataLength.into());
    }
    let config = Config::from_bytes(&config_data)?;
    if !config.is_initialized() {
        return Err(EntropyError::NotInitialized.into());
    }

    // AC-POK2.5: Verify provider matches config
    if provider_info.key() != &config.provider {
        return Err(EntropyError::ProviderMismatch.into());
    }

    // Check bond amount
    if ix.bond_amount < config.min_bond {
        return Err(EntropyError::InsufficientBond.into());
    }

    drop(config_data);

    // Get current slot
    let clock = Clock::get()?;

    // Initialize commitment account
    let mut commitment_data = commitment_info.try_borrow_mut_data()?;
    if commitment_data.len() < COMMITMENT_SIZE {
        return Err(EntropyError::InvalidAccountDataLength.into());
    }

    let commitment = Commitment::from_bytes_mut(&mut commitment_data)?;
    commitment.discriminator = acc_disc::COMMITMENT;
    commitment.status = commitment_status::PENDING;
    commitment._padding = [0; 6];
    commitment.provider = *provider_info.key();
    commitment.hash = ix.hash;
    commitment.bond_amount = ix.bond_amount;
    commitment.commit_slot = clock.slot;
    commitment.sequence = ix.sequence;
    commitment.preimage = [0; 32];

    // Drop borrow before Transfer CPI (which needs to access account lamports)
    drop(commitment_data);

    // Transfer bond from provider to commitment account
    Transfer {
        from: provider_info,
        to: commitment_info,
        lamports: ix.bond_amount,
    }
    .invoke()?;

    Ok(())
}

/// Provider reveals preimage (AC-POK2.1, AC-POK2.2)
fn process_reveal(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < instruction::Reveal::SIZE {
        return Err(EntropyError::InvalidInstruction.into());
    }

    let [commitment_info, provider_info, config_info] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Provider must sign
    if !provider_info.is_signer() {
        return Err(EntropyError::MissingSigner.into());
    }

    // Commitment account must be writable
    if !commitment_info.is_writable() {
        return Err(EntropyError::AccountNotWritable.into());
    }

    // Accounts must be owned by this program
    if !config_info.is_owned_by(&crate::ID) || !commitment_info.is_owned_by(&crate::ID) {
        return Err(EntropyError::InvalidAccountOwner.into());
    }

    // Verify config PDA
    let seeds: &[&[u8]] = &[b"config"];
    let (expected_config, _) = pubkey::find_program_address(seeds, &crate::ID);
    if config_info.key() != &expected_config {
        return Err(EntropyError::InvalidPda.into());
    }

    // Load config
    let config_data = config_info.try_borrow_data()?;
    if config_data.len() < CONFIG_SIZE {
        return Err(EntropyError::InvalidAccountDataLength.into());
    }
    let config = Config::from_bytes(&config_data)?;
    if !config.is_initialized() {
        return Err(EntropyError::NotInitialized.into());
    }

    // Verify provider
    if provider_info.key() != &config.provider {
        return Err(EntropyError::ProviderMismatch.into());
    }

    drop(config_data);

    // Parse instruction data
    let ix = instruction::Reveal::from_bytes(data);

    // Load commitment
    let mut commitment_data = commitment_info.try_borrow_mut_data()?;
    if commitment_data.len() < COMMITMENT_SIZE {
        return Err(EntropyError::InvalidAccountDataLength.into());
    }

    let commitment = Commitment::from_bytes_mut(&mut commitment_data)?;

    // Verify commitment PDA
    let sequence_bytes = commitment.sequence.to_le_bytes();
    let seeds: [&[u8]; 3] = [
        b"commitment",
        commitment.provider.as_ref(),
        sequence_bytes.as_slice(),
    ];
    let (expected_commitment, _) = pubkey::find_program_address(&seeds, &crate::ID);
    if commitment_info.key() != &expected_commitment {
        return Err(EntropyError::InvalidPda.into());
    }

    // Provider must match commitment
    if provider_info.key() != &commitment.provider {
        return Err(EntropyError::ProviderMismatch.into());
    }

    // Verify commitment is pending
    if !commitment.is_pending() {
        return Err(EntropyError::InvalidCommitment.into());
    }

    // AC-POK2.1: Verify preimage hashes to commitment
    let computed_hash = sha256(&ix.preimage);
    if computed_hash != commitment.hash {
        return Err(EntropyError::InvalidPreimage.into());
    }

    // Store preimage and mark as revealed
    commitment.preimage = ix.preimage;
    commitment.status = commitment_status::REVEALED;

    Ok(())
}

/// Request randomness from a commitment (AC-POK2.4: CPI interface)
fn process_request(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < instruction::Request::SIZE {
        return Err(EntropyError::InvalidInstruction.into());
    }

    let [request_info, requester_info, payer_info, commitment_info, config_info, slothashes_info, system_program_info] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Duplicate mutable account checks (AC-POK7.3)
    if request_info.key() == requester_info.key()
        || request_info.key() == commitment_info.key()
        || request_info.key() == payer_info.key()
    {
        return Err(EntropyError::DuplicateMutableAccount.into());
    }

    // Requester must sign
    if !requester_info.is_signer() {
        return Err(EntropyError::MissingSigner.into());
    }

    // Payer must sign
    if !payer_info.is_signer() {
        return Err(EntropyError::MissingSigner.into());
    }

    // System program ID check
    if system_program_info.key() != &pinocchio_system::ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // SlotHashes sysvar check
    if slothashes_info.key() != &SLOTHASHES_ID {
        return Err(EntropyError::InvalidSlothash.into());
    }

    // Config and commitment must be owned by this program
    if !config_info.is_owned_by(&crate::ID) || !commitment_info.is_owned_by(&crate::ID) {
        return Err(EntropyError::InvalidAccountOwner.into());
    }

    // Request account: must be owned by this program (if re-initializing)
    // or by system program (fresh PDA not yet allocated to program)
    let request_owned_by_program = request_info.is_owned_by(&crate::ID);
    let request_owned_by_system = request_info.is_owned_by(&pinocchio_system::ID);
    if !request_owned_by_program && !request_owned_by_system {
        return Err(EntropyError::InvalidAccountOwner.into());
    }

    // Verify config PDA
    let config_seeds: &[&[u8]] = &[b"config"];
    let (expected_config, _) = pubkey::find_program_address(config_seeds, &crate::ID);
    if config_info.key() != &expected_config {
        return Err(EntropyError::InvalidPda.into());
    }

    // Load config
    let config_data = config_info.try_borrow_data()?;
    if config_data.len() < CONFIG_SIZE {
        return Err(EntropyError::InvalidAccountDataLength.into());
    }
    let config = Config::from_bytes(&config_data)?;
    if !config.is_initialized() {
        return Err(EntropyError::NotInitialized.into());
    }

    // Verify commitment PDA and provider
    let commitment_data = commitment_info.try_borrow_data()?;
    if commitment_data.len() < COMMITMENT_SIZE {
        return Err(EntropyError::InvalidAccountDataLength.into());
    }
    let commitment = Commitment::from_bytes(&commitment_data)?;
    if !commitment.is_pending() {
        return Err(EntropyError::InvalidCommitment.into());
    }
    if &commitment.provider != &config.provider {
        return Err(EntropyError::ProviderMismatch.into());
    }
    let sequence_bytes = commitment.sequence.to_le_bytes();
    let commitment_seeds: [&[u8]; 3] = [
        b"commitment",
        commitment.provider.as_ref(),
        sequence_bytes.as_slice(),
    ];
    let (expected_commitment, _) = pubkey::find_program_address(&commitment_seeds, &crate::ID);
    if commitment_info.key() != &expected_commitment {
        return Err(EntropyError::InvalidPda.into());
    }
    drop(commitment_data);

    // Parse instruction data
    let ix = instruction::Request::from_bytes(data);

    // Verify request PDA
    let request_id_bytes = ix.request_id.to_le_bytes();
    let request_seeds: [&[u8]; 3] = [
        b"request",
        requester_info.key().as_ref(),
        request_id_bytes.as_slice(),
    ];
    let (expected_request, bump) = pubkey::find_program_address(&request_seeds, &crate::ID);
    if request_info.key() != &expected_request {
        return Err(EntropyError::InvalidPda.into());
    }

    // Create request account if it doesn't exist (BEFORE any borrows)
    if request_info.data_len() == 0 {
        // Calculate rent-exempt lamports
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(REQUEST_SIZE);

        // Build PDA signer seeds
        let bump_seed = [bump];
        let requester_key_bytes: [u8; 32] = *requester_info.key();
        let signer_seeds = pinocchio::seeds!(b"request", &requester_key_bytes, request_id_bytes.as_slice(), &bump_seed);
        let signer = pinocchio::instruction::Signer::from(&signer_seeds);

        // Create the account (payer funds it)
        CreateAccount {
            from: payer_info,
            to: request_info,
            lamports,
            space: REQUEST_SIZE as u64,
            owner: &crate::ID,
        }
        .invoke_signed(&[signer])?;
    } else {
        // Account already exists, check if owned by this program
        if !request_info.is_owned_by(&crate::ID) {
            return Err(EntropyError::InvalidAccountOwner.into());
        }

        // Prevent re-initialization of request account
        let request_check = request_info.try_borrow_data()?;
        if request_check.len() >= REQUEST_SIZE {
            let existing = state::Request::from_bytes(&request_check)?;
            if existing.discriminator == acc_disc::REQUEST {
                return Err(EntropyError::AlreadyInitialized.into());
            }
        }
        drop(request_check);
    }

    // Get current slot for deadline calculation
    let clock = Clock::get()?;

    // Get most recent slothash from sysvar (current slot won't have hash yet)
    let (slothash, _hash_slot) = get_recent_slothash(slothashes_info)?;

    // Calculate deadline
    let deadline_slot = clock
        .slot
        .checked_add(config.reveal_window_slots)
        .ok_or(EntropyError::ArithmeticOverflow)?;

    drop(config_data);

    // Initialize request account
    let mut request_data = request_info.try_borrow_mut_data()?;
    if request_data.len() < REQUEST_SIZE {
        return Err(EntropyError::InvalidAccountDataLength.into());
    }

    let request = state::Request::from_bytes_mut(&mut request_data)?;
    request.discriminator = acc_disc::REQUEST;
    request.status = request_status::PENDING;
    request._padding = [0; 6];
    request.requester = *requester_info.key();
    request.commitment = *commitment_info.key();
    request.request_id = ix.request_id;
    request.request_slot = clock.slot;
    request.deadline_slot = deadline_slot;
    request.randomness = [0; 32];
    request.slothash = slothash;

    Ok(())
}

/// Finalize a request with derived randomness (AC-POK2.2)
fn process_finalize(accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
    let [request_info, commitment_info, config_info] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Accounts must be owned by this program
    if !config_info.is_owned_by(&crate::ID)
        || !commitment_info.is_owned_by(&crate::ID)
        || !request_info.is_owned_by(&crate::ID)
    {
        return Err(EntropyError::InvalidAccountOwner.into());
    }

    // Verify config PDA
    let config_seeds: &[&[u8]] = &[b"config"];
    let (expected_config, _) = pubkey::find_program_address(config_seeds, &crate::ID);
    if config_info.key() != &expected_config {
        return Err(EntropyError::InvalidPda.into());
    }

    // Load and verify config
    let config_data = config_info.try_borrow_data()?;
    if config_data.len() < CONFIG_SIZE {
        return Err(EntropyError::InvalidAccountDataLength.into());
    }
    let config = Config::from_bytes(&config_data)?;
    if !config.is_initialized() {
        return Err(EntropyError::NotInitialized.into());
    }
    drop(config_data);

    // Load commitment
    let commitment_data = commitment_info.try_borrow_data()?;
    if commitment_data.len() < COMMITMENT_SIZE {
        return Err(EntropyError::InvalidAccountDataLength.into());
    }
    let commitment = Commitment::from_bytes(&commitment_data)?;

    // Verify commitment PDA
    let sequence_bytes = commitment.sequence.to_le_bytes();
    let commitment_seeds: [&[u8]; 3] = [
        b"commitment",
        commitment.provider.as_ref(),
        sequence_bytes.as_slice(),
    ];
    let (expected_commitment, _) = pubkey::find_program_address(&commitment_seeds, &crate::ID);
    if commitment_info.key() != &expected_commitment {
        return Err(EntropyError::InvalidPda.into());
    }

    // Commitment must be revealed
    if !commitment.is_revealed() {
        return Err(EntropyError::InvalidCommitment.into());
    }

    // Load request
    let mut request_data = request_info.try_borrow_mut_data()?;
    if request_data.len() < REQUEST_SIZE {
        return Err(EntropyError::InvalidAccountDataLength.into());
    }
    let request = state::Request::from_bytes_mut(&mut request_data)?;

    // Verify request PDA
    let request_id_bytes = request.request_id.to_le_bytes();
    let request_seeds: [&[u8]; 3] = [
        b"request",
        request.requester.as_ref(),
        request_id_bytes.as_slice(),
    ];
    let (expected_request, _) = pubkey::find_program_address(&request_seeds, &crate::ID);
    if request_info.key() != &expected_request {
        return Err(EntropyError::InvalidPda.into());
    }

    // Request must be pending
    if !request.is_pending() {
        return Err(EntropyError::RequestAlreadyFinalized.into());
    }

    // Verify request references this commitment
    if &request.commitment != commitment_info.key() {
        return Err(EntropyError::InvalidCommitment.into());
    }

    // AC-POK2.2: Derive randomness from preimage XOR slothash
    let randomness = derive_randomness(&commitment.preimage, &request.slothash);

    // Update request
    request.randomness = randomness;
    request.status = request_status::FINALIZED;

    Ok(())
}

/// Slash provider for missed reveal (AC-POK2.3)
fn process_slash(accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
    let [commitment_info, request_info, provider_info, slasher_info, config_info, _clock_info] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Duplicate mutable account checks (AC-POK7.3)
    if commitment_info.key() == request_info.key()
        || commitment_info.key() == provider_info.key()
        || commitment_info.key() == slasher_info.key()
        || request_info.key() == provider_info.key()
        || request_info.key() == slasher_info.key()
        || provider_info.key() == slasher_info.key()
    {
        return Err(EntropyError::DuplicateMutableAccount.into());
    }

    // Accounts must be owned by this program where applicable
    if !config_info.is_owned_by(&crate::ID)
        || !commitment_info.is_owned_by(&crate::ID)
        || !request_info.is_owned_by(&crate::ID)
    {
        return Err(EntropyError::InvalidAccountOwner.into());
    }

    // Verify config PDA
    let config_seeds: &[&[u8]] = &[b"config"];
    let (expected_config, _) = pubkey::find_program_address(config_seeds, &crate::ID);
    if config_info.key() != &expected_config {
        return Err(EntropyError::InvalidPda.into());
    }

    // Load config
    let config_data = config_info.try_borrow_data()?;
    if config_data.len() < CONFIG_SIZE {
        return Err(EntropyError::InvalidAccountDataLength.into());
    }
    let config = Config::from_bytes(&config_data)?;
    if !config.is_initialized() {
        return Err(EntropyError::NotInitialized.into());
    }
    let config_provider = config.provider;
    let slash_basis_points = config.slash_basis_points;

    // Get current slot
    let clock = Clock::get()?;

    drop(config_data);

    // Load request
    let request_data = request_info.try_borrow_data()?;
    if request_data.len() < REQUEST_SIZE {
        return Err(EntropyError::InvalidAccountDataLength.into());
    }
    let request = state::Request::from_bytes(&request_data)?;
    let request_id = request.request_id;
    let request_requester = request.requester;
    let request_commitment = request.commitment;
    let request_deadline = request.deadline_slot;
    let request_pending = request.is_pending();

    // Verify request PDA
    let request_id_bytes = request_id.to_le_bytes();
    let request_seeds: [&[u8]; 3] = [
        b"request",
        request_requester.as_ref(),
        request_id_bytes.as_slice(),
    ];
    let (expected_request, _) = pubkey::find_program_address(&request_seeds, &crate::ID);
    if request_info.key() != &expected_request {
        return Err(EntropyError::InvalidPda.into());
    }

    if !request_pending {
        return Err(EntropyError::RequestAlreadyFinalized.into());
    }

    let deadline = request_deadline;
    drop(request_data);

    // Load commitment
    let mut commitment_data = commitment_info.try_borrow_mut_data()?;
    if commitment_data.len() < COMMITMENT_SIZE {
        return Err(EntropyError::InvalidAccountDataLength.into());
    }
    let commitment = Commitment::from_bytes_mut(&mut commitment_data)?;

    // Verify commitment PDA
    let sequence_bytes = commitment.sequence.to_le_bytes();
    let commitment_seeds: [&[u8]; 3] = [
        b"commitment",
        commitment.provider.as_ref(),
        sequence_bytes.as_slice(),
    ];
    let (expected_commitment, _) = pubkey::find_program_address(&commitment_seeds, &crate::ID);
    if commitment_info.key() != &expected_commitment {
        return Err(EntropyError::InvalidPda.into());
    }

    // Verify request references this commitment
    if &request_commitment != commitment_info.key() {
        return Err(EntropyError::InvalidCommitment.into());
    }

    // Commitment must be pending (not yet revealed or already slashed)
    if !commitment.is_pending() {
        return Err(EntropyError::InvalidCommitment.into());
    }

    // Verify provider matches
    if provider_info.key() != &commitment.provider {
        return Err(EntropyError::ProviderMismatch.into());
    }

    // Verify provider matches config (single-provider mode)
    if provider_info.key() != &config_provider {
        return Err(EntropyError::ProviderMismatch.into());
    }

    // AC-POK2.3: Check if reveal window has expired (based on request deadline)
    if clock.slot <= deadline {
        return Err(EntropyError::RevealWindowNotExpired.into());
    }

    // Calculate slash amount
    let slash_amount = commitment
        .bond_amount
        .checked_mul(slash_basis_points as u64)
        .ok_or(EntropyError::ArithmeticOverflow)?
        .checked_div(10000)
        .ok_or(EntropyError::ArithmeticOverflow)?;

    let remaining = commitment
        .bond_amount
        .checked_sub(slash_amount)
        .ok_or(EntropyError::ArithmeticOverflow)?;

    drop(commitment_data);

    // Transfer slash amount to slasher
    // Transfer remaining to provider
    // (These would be lamport transfers in production)
    transfer_lamports(commitment_info, slasher_info, slash_amount)?;
    transfer_lamports(commitment_info, provider_info, remaining)?;

    // Mark as slashed
    let mut commitment_data = commitment_info.try_borrow_mut_data()?;
    let commitment = Commitment::from_bytes_mut(&mut commitment_data)?;
    commitment.status = commitment_status::SLASHED;

    Ok(())
}

/// Update config parameters
fn process_update_config(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < instruction::UpdateConfig::SIZE {
        return Err(EntropyError::InvalidInstruction.into());
    }

    let [config_info, authority_info] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Authority must sign
    if !authority_info.is_signer() {
        return Err(EntropyError::MissingSigner.into());
    }

    // Config must be owned by this program
    if !config_info.is_owned_by(&crate::ID) {
        return Err(EntropyError::InvalidAccountOwner.into());
    }

    // Verify config PDA
    let config_seeds: &[&[u8]] = &[b"config"];
    let (expected_config, _) = pubkey::find_program_address(config_seeds, &crate::ID);
    if config_info.key() != &expected_config {
        return Err(EntropyError::InvalidPda.into());
    }

    // Parse instruction data
    let ix = instruction::UpdateConfig::from_bytes(data);

    // Load and verify config
    let mut config_data = config_info.try_borrow_mut_data()?;
    if config_data.len() < CONFIG_SIZE {
        return Err(EntropyError::InvalidAccountDataLength.into());
    }
    let config = Config::from_bytes_mut(&mut config_data)?;

    if !config.is_initialized() {
        return Err(EntropyError::NotInitialized.into());
    }

    // Verify authority
    if authority_info.key() != &config.authority {
        return Err(EntropyError::MissingSigner.into());
    }

    // Update fields if non-zero
    if ix.new_provider != [0; 32] {
        config.provider = Pubkey::from(ix.new_provider);
    }
    if ix.new_min_bond > 0 {
        config.min_bond = ix.new_min_bond;
    }
    if ix.new_reveal_window_slots > 0 {
        config.reveal_window_slots = ix.new_reveal_window_slots;
    }
    if ix.new_slash_basis_points > 0 {
        config.slash_basis_points = ix.new_slash_basis_points;
    }

    Ok(())
}

/// Get the most recent slothash from the SlotHashes sysvar.
///
/// Note: The current slot being processed won't have a hash yet (only parent
/// slots do), so we return the hash of the most recent available slot, which
/// is the first entry in the descending-sorted SlotHashes sysvar.
fn get_recent_slothash(slothashes_info: &AccountInfo) -> Result<([u8; 32], u64), ProgramError> {
    let data = slothashes_info.try_borrow_data()?;
    let slot_hashes = SlotHashes::new(data)?;
    // SlotHashes are sorted in descending order, so first entry is most recent
    let entry = slot_hashes
        .get_entry(0)
        .ok_or(EntropyError::InvalidSlothash)?;
    Ok((entry.hash, entry.slot()))
}

/// Transfer lamports between accounts (safe checked arithmetic)
fn transfer_lamports(
    from: &AccountInfo,
    to: &AccountInfo,
    amount: u64,
) -> ProgramResult {
    let from_lamports = from.lamports();
    let to_lamports = to.lamports();

    // Checked subtraction to prevent underflow
    let new_from_lamports = from_lamports
        .checked_sub(amount)
        .ok_or(ProgramError::InsufficientFunds)?;

    // Checked addition to prevent overflow
    let new_to_lamports = to_lamports
        .checked_add(amount)
        .ok_or(EntropyError::ArithmeticOverflow)?;

    // Safe: we've verified the arithmetic above
    unsafe {
        *from.borrow_mut_lamports_unchecked() = new_from_lamports;
        *to.borrow_mut_lamports_unchecked() = new_to_lamports;
    }

    Ok(())
}

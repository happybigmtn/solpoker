//! Instruction processor for the entropy program.

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::{self, Pubkey},
    sysvars::{clock::Clock, slot_hashes::{SlotHashes, SLOTHASHES_ID}, Sysvar},
    ProgramResult,
};
use pinocchio_system::instructions::Transfer;

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

    // Config must be owned by this program
    if !config_info.is_owned_by(&crate::ID) {
        return Err(EntropyError::InvalidAccountOwner.into());
    }

    // Verify config PDA
    let seeds: &[&[u8]] = &[b"config"];
    let (expected_config, _bump) = pubkey::find_program_address(seeds, &crate::ID);
    if config_info.key() != &expected_config {
        return Err(EntropyError::InvalidPda.into());
    }

    // Parse instruction data
    let ix = unsafe { instruction::Initialize::from_bytes_unchecked(data) };

    // Check if already initialized
    let config_data = config_info.try_borrow_data()?;
    if config_data.len() >= CONFIG_SIZE {
        let config = unsafe { Config::from_bytes_unchecked(&config_data) };
        if config.is_initialized() {
            return Err(EntropyError::AlreadyInitialized.into());
        }
    }
    drop(config_data);

    // Create config account if needed (via system program CPI)
    // For now, assume account is pre-created with sufficient space

    // Initialize config data
    let mut config_data = config_info.try_borrow_mut_data()?;
    if config_data.len() < CONFIG_SIZE {
        return Err(EntropyError::InvalidAccountDataLength.into());
    }

    let config = unsafe { Config::from_bytes_unchecked_mut(&mut config_data) };
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

/// Provider posts a new commitment (AC-2.1)
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

    // Duplicate mutable account check (AC-7.3)
    if commitment_info.key() == provider_info.key() {
        return Err(EntropyError::DuplicateMutableAccount.into());
    }

    // System program ID check
    if system_program_info.key() != &pinocchio_system::ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Accounts must be owned by this program
    if !config_info.is_owned_by(&crate::ID) || !commitment_info.is_owned_by(&crate::ID) {
        return Err(EntropyError::InvalidAccountOwner.into());
    }

    // Load and verify config
    let config_data = config_info.try_borrow_data()?;
    if config_data.len() < CONFIG_SIZE {
        return Err(EntropyError::InvalidAccountDataLength.into());
    }
    let config = unsafe { Config::from_bytes_unchecked(&config_data) };
    if !config.is_initialized() {
        return Err(EntropyError::NotInitialized.into());
    }

    // AC-2.5: Verify provider matches config
    if provider_info.key() != &config.provider {
        return Err(EntropyError::ProviderMismatch.into());
    }

    // Prevent re-initialization of commitment account
    let commitment_check = commitment_info.try_borrow_data()?;
    if commitment_check.len() >= COMMITMENT_SIZE {
        let existing = unsafe { Commitment::from_bytes_unchecked(&commitment_check) };
        if existing.discriminator == acc_disc::COMMITMENT {
            return Err(EntropyError::AlreadyInitialized.into());
        }
    }
    drop(commitment_check);

    // Parse instruction data
    let ix = unsafe { instruction::Commit::from_bytes_unchecked(data) };

    // Verify commitment PDA
    let sequence_bytes = ix.sequence.to_le_bytes();
    let seeds: [&[u8]; 3] = [
        b"commitment",
        provider_info.key().as_ref(),
        sequence_bytes.as_slice(),
    ];
    let (expected_commitment, _bump) = pubkey::find_program_address(&seeds, &crate::ID);
    if commitment_info.key() != &expected_commitment {
        return Err(EntropyError::InvalidPda.into());
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

    let commitment = unsafe { Commitment::from_bytes_unchecked_mut(&mut commitment_data) };
    commitment.discriminator = acc_disc::COMMITMENT;
    commitment.status = commitment_status::PENDING;
    commitment._padding = [0; 6];
    commitment.provider = *provider_info.key();
    commitment.hash = ix.hash;
    commitment.bond_amount = ix.bond_amount;
    commitment.commit_slot = clock.slot;
    commitment.sequence = ix.sequence;
    commitment.preimage = [0; 32];

    // Transfer bond from provider to commitment account
    Transfer {
        from: provider_info,
        to: commitment_info,
        lamports: ix.bond_amount,
    }
    .invoke()?;

    Ok(())
}

/// Provider reveals preimage (AC-2.1, AC-2.2)
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
    let config = unsafe { Config::from_bytes_unchecked(&config_data) };
    if !config.is_initialized() {
        return Err(EntropyError::NotInitialized.into());
    }

    // Verify provider
    if provider_info.key() != &config.provider {
        return Err(EntropyError::ProviderMismatch.into());
    }

    drop(config_data);

    // Parse instruction data
    let ix = unsafe { instruction::Reveal::from_bytes_unchecked(data) };

    // Load commitment
    let mut commitment_data = commitment_info.try_borrow_mut_data()?;
    if commitment_data.len() < COMMITMENT_SIZE {
        return Err(EntropyError::InvalidAccountDataLength.into());
    }

    let commitment = unsafe { Commitment::from_bytes_unchecked_mut(&mut commitment_data) };

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

    // AC-2.1: Verify preimage hashes to commitment
    let computed_hash = sha256(&ix.preimage);
    if computed_hash != commitment.hash {
        return Err(EntropyError::InvalidPreimage.into());
    }

    // Store preimage and mark as revealed
    commitment.preimage = ix.preimage;
    commitment.status = commitment_status::REVEALED;

    Ok(())
}

/// Request randomness from a commitment (AC-2.4: CPI interface)
fn process_request(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < instruction::Request::SIZE {
        return Err(EntropyError::InvalidInstruction.into());
    }

    let [request_info, requester_info, commitment_info, config_info, slothashes_info, system_program_info] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Duplicate mutable account checks (AC-7.3)
    if request_info.key() == requester_info.key() || request_info.key() == commitment_info.key() {
        return Err(EntropyError::DuplicateMutableAccount.into());
    }

    // Requester must sign
    if !requester_info.is_signer() {
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

    // Load config
    let config_data = config_info.try_borrow_data()?;
    if config_data.len() < CONFIG_SIZE {
        return Err(EntropyError::InvalidAccountDataLength.into());
    }
    let config = unsafe { Config::from_bytes_unchecked(&config_data) };
    if !config.is_initialized() {
        return Err(EntropyError::NotInitialized.into());
    }

    // Verify commitment PDA and provider
    let commitment_data = commitment_info.try_borrow_data()?;
    if commitment_data.len() < COMMITMENT_SIZE {
        return Err(EntropyError::InvalidAccountDataLength.into());
    }
    let commitment = unsafe { Commitment::from_bytes_unchecked(&commitment_data) };
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

    // Prevent re-initialization of request account
    let request_check = request_info.try_borrow_data()?;
    if request_check.len() >= REQUEST_SIZE {
        let existing = unsafe { state::Request::from_bytes_unchecked(&request_check) };
        if existing.discriminator == acc_disc::REQUEST {
            return Err(EntropyError::AlreadyInitialized.into());
        }
    }
    drop(request_check);

    // Parse instruction data
    let ix = unsafe { instruction::Request::from_bytes_unchecked(data) };

    // Verify request PDA
    let request_id_bytes = ix.request_id.to_le_bytes();
    let request_seeds: [&[u8]; 3] = [
        b"request",
        requester_info.key().as_ref(),
        request_id_bytes.as_slice(),
    ];
    let (expected_request, _) = pubkey::find_program_address(&request_seeds, &crate::ID);
    if request_info.key() != &expected_request {
        return Err(EntropyError::InvalidPda.into());
    }

    // Get current slot and slothash
    let clock = Clock::get()?;

    // Get slothash from sysvar
    let slothash = get_recent_slothash(slothashes_info, clock.slot)?;

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

    let request = unsafe { state::Request::from_bytes_unchecked_mut(&mut request_data) };
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

/// Finalize a request with derived randomness (AC-2.2)
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
    let config = unsafe { Config::from_bytes_unchecked(&config_data) };
    if !config.is_initialized() {
        return Err(EntropyError::NotInitialized.into());
    }
    drop(config_data);

    // Load commitment
    let commitment_data = commitment_info.try_borrow_data()?;
    if commitment_data.len() < COMMITMENT_SIZE {
        return Err(EntropyError::InvalidAccountDataLength.into());
    }
    let commitment = unsafe { Commitment::from_bytes_unchecked(&commitment_data) };

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
    let request = unsafe { state::Request::from_bytes_unchecked_mut(&mut request_data) };

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

    // AC-2.2: Derive randomness from preimage XOR slothash
    let randomness = derive_randomness(&commitment.preimage, &request.slothash);

    // Update request
    request.randomness = randomness;
    request.status = request_status::FINALIZED;

    Ok(())
}

/// Slash provider for missed reveal (AC-2.3)
fn process_slash(accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
    let [commitment_info, provider_info, slasher_info, config_info, _clock_info] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Duplicate mutable account checks (AC-7.3)
    if commitment_info.key() == provider_info.key()
        || commitment_info.key() == slasher_info.key()
        || provider_info.key() == slasher_info.key()
    {
        return Err(EntropyError::DuplicateMutableAccount.into());
    }

    // Accounts must be owned by this program where applicable
    if !config_info.is_owned_by(&crate::ID) || !commitment_info.is_owned_by(&crate::ID) {
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
    let config = unsafe { Config::from_bytes_unchecked(&config_data) };
    if !config.is_initialized() {
        return Err(EntropyError::NotInitialized.into());
    }
    let config_provider = config.provider;
    let reveal_window_slots = config.reveal_window_slots;
    let slash_basis_points = config.slash_basis_points;

    // Get current slot
    let clock = Clock::get()?;

    drop(config_data);

    // Load commitment
    let mut commitment_data = commitment_info.try_borrow_mut_data()?;
    if commitment_data.len() < COMMITMENT_SIZE {
        return Err(EntropyError::InvalidAccountDataLength.into());
    }
    let commitment = unsafe { Commitment::from_bytes_unchecked_mut(&mut commitment_data) };

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

    // AC-2.3: Check if reveal window has expired
    // We use commit_slot + a reasonable reveal window for this check
    // In production, this would be based on the request's deadline
    let deadline = commitment
        .commit_slot
        .checked_add(reveal_window_slots)
        .ok_or(EntropyError::ArithmeticOverflow)?;

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
    let commitment = unsafe { Commitment::from_bytes_unchecked_mut(&mut commitment_data) };
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
    let ix = unsafe { instruction::UpdateConfig::from_bytes_unchecked(data) };

    // Load and verify config
    let mut config_data = config_info.try_borrow_mut_data()?;
    if config_data.len() < CONFIG_SIZE {
        return Err(EntropyError::InvalidAccountDataLength.into());
    }
    let config = unsafe { Config::from_bytes_unchecked_mut(&mut config_data) };

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

/// Get recent slothash from the SlotHashes sysvar
fn get_recent_slothash(slothashes_info: &AccountInfo, slot: u64) -> Result<[u8; 32], ProgramError> {
    let data = slothashes_info.try_borrow_data()?;
    let slot_hashes = SlotHashes::new(data)?;
    slot_hashes
        .get_hash(slot)
        .copied()
        .ok_or(EntropyError::InvalidSlothash.into())
}

/// Transfer lamports between accounts
fn transfer_lamports(
    from: &AccountInfo,
    to: &AccountInfo,
    amount: u64,
) -> ProgramResult {
    // Use unsafe lamport manipulation for PDA-owned accounts
    // In production, this would use proper checked math
    let from_lamports = from.lamports();
    let to_lamports = to.lamports();

    if from_lamports < amount {
        return Err(ProgramError::InsufficientFunds);
    }

    unsafe {
        *from.borrow_mut_lamports_unchecked() = from_lamports - amount;
        *to.borrow_mut_lamports_unchecked() = to_lamports + amount;
    }

    Ok(())
}

//! Mollusk tests for the entropy program.
//!
//! These tests verify:
//! 1. Commit -> Reveal -> Randomness derivation flow (AC-POK2.1, AC-POK2.2)
//! 2. Missed reveal -> Slash mechanism (AC-POK2.3)

use mollusk_svm::{
    file,
    program::{create_program_account_pair_loader_v3, keyed_account_for_system_program, loader_keys},
    Mollusk,
};
use sha2::{Sha256, Digest};
use solana_account::Account;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use std::{path::PathBuf, sync::Once};

use robopoker_entropy::{
    instruction::discriminator as ix_disc,
    state::{
        commitment_status, discriminator as acc_disc, request_status,
        CONFIG_SIZE, COMMITMENT_SIZE, REQUEST_SIZE,
    },
};

/// Compute SHA256 hash using the same algorithm as the Solana syscall
fn sha256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}

/// System program ID
const SYSTEM_PROGRAM_ID: Address = solana_address::address!("11111111111111111111111111111111");

/// Build instruction data for Commit
fn build_commit_ix(hash: [u8; 32], sequence: u64, bond_amount: u64) -> Vec<u8> {
    let mut data = vec![ix_disc::COMMIT, 0, 0, 0, 0, 0, 0, 0]; // discriminator + padding
    data.extend_from_slice(&hash);
    data.extend_from_slice(&sequence.to_le_bytes());
    data.extend_from_slice(&bond_amount.to_le_bytes());
    data
}

/// Build instruction data for Reveal
fn build_reveal_ix(preimage: [u8; 32]) -> Vec<u8> {
    let mut data = vec![ix_disc::REVEAL, 0, 0, 0, 0, 0, 0, 0]; // discriminator + padding
    data.extend_from_slice(&preimage);
    data
}

/// Build instruction data for Finalize
fn build_finalize_ix() -> Vec<u8> {
    vec![ix_disc::FINALIZE]
}

/// Build instruction data for Slash
fn build_slash_ix() -> Vec<u8> {
    vec![ix_disc::SLASH]
}

/// Create an initialized config account data
fn create_config_data(provider: &Address, authority: &Address, min_bond: u64, reveal_window: u64, slash_bp: u64) -> Vec<u8> {
    let mut data = vec![0u8; CONFIG_SIZE];
    data[0] = acc_disc::CONFIG;
    data[1] = 1; // initialized
    // padding [2..8]
    data[8..40].copy_from_slice(provider.as_ref());
    data[40..72].copy_from_slice(authority.as_ref());
    data[72..80].copy_from_slice(&min_bond.to_le_bytes());
    data[80..88].copy_from_slice(&reveal_window.to_le_bytes());
    data[88..96].copy_from_slice(&slash_bp.to_le_bytes());
    data
}

/// Create commitment account data (empty, ready to be initialized)
fn create_empty_commitment_data() -> Vec<u8> {
    vec![0u8; COMMITMENT_SIZE]
}

/// Create a pending commitment account data
fn create_pending_commitment_data(
    provider: &Address,
    hash: [u8; 32],
    bond_amount: u64,
    commit_slot: u64,
    sequence: u64,
) -> Vec<u8> {
    let mut data = vec![0u8; COMMITMENT_SIZE];
    data[0] = acc_disc::COMMITMENT;
    data[1] = commitment_status::PENDING;
    // padding [2..8]
    data[8..40].copy_from_slice(provider.as_ref());
    data[40..72].copy_from_slice(&hash);
    data[72..80].copy_from_slice(&bond_amount.to_le_bytes());
    data[80..88].copy_from_slice(&commit_slot.to_le_bytes());
    data[88..96].copy_from_slice(&sequence.to_le_bytes());
    // preimage [96..128] remains zeros
    data
}

/// Create a revealed commitment account data
fn create_revealed_commitment_data(
    provider: &Address,
    hash: [u8; 32],
    preimage: [u8; 32],
    bond_amount: u64,
    commit_slot: u64,
    sequence: u64,
) -> Vec<u8> {
    let mut data = vec![0u8; COMMITMENT_SIZE];
    data[0] = acc_disc::COMMITMENT;
    data[1] = commitment_status::REVEALED;
    // padding [2..8]
    data[8..40].copy_from_slice(provider.as_ref());
    data[40..72].copy_from_slice(&hash);
    data[72..80].copy_from_slice(&bond_amount.to_le_bytes());
    data[80..88].copy_from_slice(&commit_slot.to_le_bytes());
    data[88..96].copy_from_slice(&sequence.to_le_bytes());
    data[96..128].copy_from_slice(&preimage);
    data
}

/// Create a pending request account data
fn create_pending_request_data(
    requester: &Address,
    commitment: &Address,
    request_id: u64,
    request_slot: u64,
    deadline_slot: u64,
    slothash: [u8; 32],
) -> Vec<u8> {
    let mut data = vec![0u8; REQUEST_SIZE];
    data[0] = acc_disc::REQUEST;
    data[1] = request_status::PENDING;
    // padding [2..8]
    data[8..40].copy_from_slice(requester.as_ref());
    data[40..72].copy_from_slice(commitment.as_ref());
    data[72..80].copy_from_slice(&request_id.to_le_bytes());
    data[80..88].copy_from_slice(&request_slot.to_le_bytes());
    data[88..96].copy_from_slice(&deadline_slot.to_le_bytes());
    // randomness [96..128] remains zeros
    data[128..160].copy_from_slice(&slothash);
    data
}

/// Generate a unique address for testing
fn new_unique_address() -> Address {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut bytes = [0u8; 32];
    bytes[..8].copy_from_slice(&n.to_le_bytes());
    // Make it look like a valid non-PDA address
    bytes[31] = 0;
    Address::from(bytes)
}

fn derive_config_pda(program_id: &Address) -> Address {
    Address::find_program_address(&[b"config"], program_id).0
}

fn derive_commitment_pda(program_id: &Address, provider: &Address, sequence: u64) -> Address {
    let sequence_bytes = sequence.to_le_bytes();
    Address::find_program_address(&[b"commitment", provider.as_ref(), &sequence_bytes], program_id).0
}

fn derive_request_pda(program_id: &Address, requester: &Address, request_id: u64) -> Address {
    let request_id_bytes = request_id.to_le_bytes();
    Address::find_program_address(&[b"request", requester.as_ref(), &request_id_bytes], program_id).0
}

fn new_mollusk(program_id: &Address) -> Mollusk {
    ensure_sbf_out_dir();
    Mollusk::new(program_id, "robopoker_entropy")
}

fn program_accounts(program_id: &Address) -> Vec<(Address, Account)> {
    ensure_sbf_out_dir();
    let elf = file::load_program_elf("robopoker_entropy");
    let (program_account, programdata_account) =
        create_program_account_pair_loader_v3(program_id, &elf);
    let programdata_address =
        Address::find_program_address(&[program_id.as_ref()], &loader_keys::LOADER_V3).0;
    vec![(*program_id, program_account), (programdata_address, programdata_account)]
}

fn ensure_sbf_out_dir() {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        if std::env::var("SBF_OUT_DIR").is_ok() {
            return;
        }
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let out_dir = manifest_dir.join("..").join("..").join("target").join("deploy");
        if out_dir.is_dir() {
            std::env::set_var("SBF_OUT_DIR", out_dir);
        }
    });
}

/// Test: Commit -> Reveal -> Randomness derivation
///
/// This test verifies the complete happy path:
/// 1. Provider commits a hash of a preimage
/// 2. Provider reveals the preimage
/// 3. Randomness is derived from preimage XOR slothash
#[test]
fn test_commit_reveal_randomness_derivation() {
    // Set up test keys
    let program_id = Address::from(robopoker_entropy::ID);
    let provider = new_unique_address();
    let authority = new_unique_address();
    let requester = new_unique_address();

    // Test parameters
    let preimage: [u8; 32] = [
        0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
        0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
        0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
        0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20,
    ];
    let hash = sha256(&preimage);
    let bond_amount = 1_000_000u64;
    let sequence = 1u64;
    let request_id = 1u64;
    let min_bond = 500_000u64;
    let reveal_window = 100u64;
    let slash_bp = 5000u64; // 50%

    let config_key = derive_config_pda(&program_id);
    let commitment_key = derive_commitment_pda(&program_id, &provider, sequence);
    let request_key = derive_request_pda(&program_id, &requester, request_id);

    // Create mollusk instance
    let mollusk = new_mollusk(&program_id);

    // ===== Test 1: Commit instruction =====
    // Provider submits commitment hash with bond

    let config_data = create_config_data(&provider, &authority, min_bond, reveal_window, slash_bp);
    let commitment_data = create_empty_commitment_data();

    let commit_ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta { pubkey: commitment_key, is_signer: false, is_writable: true },
            AccountMeta { pubkey: provider, is_signer: true, is_writable: true },
            AccountMeta { pubkey: config_key, is_signer: false, is_writable: false },
            AccountMeta { pubkey: SYSTEM_PROGRAM_ID, is_signer: false, is_writable: false },
        ],
        data: build_commit_ix(hash, sequence, bond_amount),
    };

    let (system_program_key, system_program_account) = keyed_account_for_system_program();
    let mut commit_accounts = program_accounts(&program_id);
    commit_accounts.extend(vec![
        (commitment_key, Account {
            lamports: 1_000_000_000,
            data: commitment_data,
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        }),
        (provider, Account {
            lamports: 10_000_000_000,
            data: vec![],
            owner: SYSTEM_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        }),
        (config_key, Account {
            lamports: 1_000_000,
            data: config_data.clone(),
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        }),
        (system_program_key, system_program_account),
    ]);

    let result = mollusk.process_instruction(&commit_ix, &commit_accounts);
    assert!(result.program_result.is_ok(), "Commit should succeed: {:?}", result.program_result);

    // Verify commitment was created with pending status
    let commitment_account = result.get_account(&commitment_key).unwrap();
    assert_eq!(commitment_account.data[0], acc_disc::COMMITMENT);
    assert_eq!(commitment_account.data[1], commitment_status::PENDING);

    // ===== Test 2: Reveal instruction =====
    // Provider reveals preimage

    let pending_commitment_data = create_pending_commitment_data(&provider, hash, bond_amount, 100, sequence);

    let reveal_ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta { pubkey: commitment_key, is_signer: false, is_writable: true },
            AccountMeta { pubkey: provider, is_signer: true, is_writable: false },
            AccountMeta { pubkey: config_key, is_signer: false, is_writable: false },
        ],
        data: build_reveal_ix(preimage),
    };

    let mut reveal_accounts = program_accounts(&program_id);
    reveal_accounts.extend(vec![
        (commitment_key, Account {
            lamports: 1_000_000_000,
            data: pending_commitment_data,
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        }),
        (provider, Account {
            lamports: 10_000_000_000,
            data: vec![],
            owner: SYSTEM_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        }),
        (config_key, Account {
            lamports: 1_000_000,
            data: config_data.clone(),
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        }),
    ]);

    let result = mollusk.process_instruction(&reveal_ix, &reveal_accounts);
    assert!(result.program_result.is_ok(), "Reveal should succeed: {:?}", result.program_result);

    // Verify commitment is now revealed
    let commitment_account = result.get_account(&commitment_key).unwrap();
    assert_eq!(commitment_account.data[0], acc_disc::COMMITMENT);
    assert_eq!(commitment_account.data[1], commitment_status::REVEALED);

    // Verify preimage is stored
    let stored_preimage: [u8; 32] = commitment_account.data[96..128].try_into().unwrap();
    assert_eq!(stored_preimage, preimage);

    // ===== Test 3: Finalize instruction =====
    // After commitment is revealed, finalize request to get randomness

    let slothash: [u8; 32] = [0xAA; 32]; // Test slothash
    let request_data = create_pending_request_data(&requester, &commitment_key, request_id, 50, 150, slothash);
    let revealed_commitment_data = create_revealed_commitment_data(&provider, hash, preimage, bond_amount, 100, sequence);

    let finalize_ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta { pubkey: request_key, is_signer: false, is_writable: true },
            AccountMeta { pubkey: commitment_key, is_signer: false, is_writable: false },
            AccountMeta { pubkey: config_key, is_signer: false, is_writable: false },
        ],
        data: build_finalize_ix(),
    };

    let mut finalize_accounts = program_accounts(&program_id);
    finalize_accounts.extend(vec![
        (request_key, Account {
            lamports: 1_000_000,
            data: request_data,
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        }),
        (commitment_key, Account {
            lamports: 1_000_000_000,
            data: revealed_commitment_data,
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        }),
        (config_key, Account {
            lamports: 1_000_000,
            data: config_data,
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        }),
    ]);

    let result = mollusk.process_instruction(&finalize_ix, &finalize_accounts);
    assert!(result.program_result.is_ok(), "Finalize should succeed: {:?}", result.program_result);

    // Verify request is finalized with correct randomness
    let request_account = result.get_account(&request_key).unwrap();
    assert_eq!(request_account.data[0], acc_disc::REQUEST);
    assert_eq!(request_account.data[1], request_status::FINALIZED);

    // Verify randomness is preimage XOR slothash
    let stored_randomness: [u8; 32] = request_account.data[96..128].try_into().unwrap();
    let expected_randomness: [u8; 32] = core::array::from_fn(|i| preimage[i] ^ slothash[i]);
    assert_eq!(stored_randomness, expected_randomness, "Randomness should be preimage XOR slothash");
}

/// Test: Missed reveal -> Slash
///
/// This test verifies that:
/// 1. If provider fails to reveal within the window
/// 2. Anyone can slash the provider
/// 3. Bond is forfeited according to slash_basis_points
#[test]
fn test_missed_reveal_slash() {
    // Set up test keys
    let program_id = Address::from(robopoker_entropy::ID);
    let provider = new_unique_address();
    let authority = new_unique_address();
    let slasher = new_unique_address();
    let requester = new_unique_address();
    let clock_key = new_unique_address();

    // Test parameters
    let preimage: [u8; 32] = [0x42; 32];
    let hash = sha256(&preimage);
    let bond_amount = 1_000_000u64;
    let sequence = 1u64;
    let min_bond = 500_000u64;
    let reveal_window = 100u64;
    let slash_bp = 5000u64; // 50%
    let commit_slot = 100u64;
    let request_id = 42u64;
    let request_slot = commit_slot + 1;
    let deadline_slot = request_slot + reveal_window;

    let config_key = derive_config_pda(&program_id);
    let commitment_key = derive_commitment_pda(&program_id, &provider, sequence);
    let request_key = derive_request_pda(&program_id, &requester, request_id);

    // Expected slash calculation: 50% of 1_000_000 = 500_000
    let expected_slash = (bond_amount * slash_bp) / 10000;
    let expected_remaining = bond_amount - expected_slash;

    // Create mollusk instance
    let mut mollusk = new_mollusk(&program_id);

    // Warp to slot past deadline (request_slot + reveal_window + 1)
    mollusk.warp_to_slot(deadline_slot + 10);

    // Create account data
    let config_data = create_config_data(&provider, &authority, min_bond, reveal_window, slash_bp);
    let pending_commitment_data = create_pending_commitment_data(&provider, hash, bond_amount, commit_slot, sequence);
    let pending_request_data = create_pending_request_data(
        &requester,
        &commitment_key,
        request_id,
        request_slot,
        deadline_slot,
        [0u8; 32],
    );

    // Initial lamport balances
    let initial_commitment_lamports = bond_amount + 1_000_000; // bond + rent
    let initial_provider_lamports = 5_000_000u64;
    let initial_slasher_lamports = 1_000_000u64;

    let slash_ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta { pubkey: commitment_key, is_signer: false, is_writable: true },
            AccountMeta { pubkey: request_key, is_signer: false, is_writable: false },
            AccountMeta { pubkey: provider, is_signer: false, is_writable: true },
            AccountMeta { pubkey: slasher, is_signer: false, is_writable: true },
            AccountMeta { pubkey: config_key, is_signer: false, is_writable: false },
            AccountMeta { pubkey: clock_key, is_signer: false, is_writable: false },
        ],
        data: build_slash_ix(),
    };

    let mut slash_accounts = program_accounts(&program_id);
    slash_accounts.extend(vec![
        (commitment_key, Account {
            lamports: initial_commitment_lamports,
            data: pending_commitment_data,
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        }),
        (request_key, Account {
            lamports: 1_000_000,
            data: pending_request_data,
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        }),
        (provider, Account {
            lamports: initial_provider_lamports,
            data: vec![],
            owner: SYSTEM_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        }),
        (slasher, Account {
            lamports: initial_slasher_lamports,
            data: vec![],
            owner: SYSTEM_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        }),
        (config_key, Account {
            lamports: 1_000_000,
            data: config_data,
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        }),
        (clock_key, Account {
            lamports: 1,
            data: vec![],
            owner: SYSTEM_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        }),
    ]);

    let result = mollusk.process_instruction(&slash_ix, &slash_accounts);
    assert!(result.program_result.is_ok(), "Slash should succeed: {:?}", result.program_result);

    // Verify commitment is now slashed
    let commitment_account = result.get_account(&commitment_key).unwrap();
    assert_eq!(commitment_account.data[0], acc_disc::COMMITMENT);
    assert_eq!(commitment_account.data[1], commitment_status::SLASHED);

    // Verify lamport transfers
    let slasher_account = result.get_account(&slasher).unwrap();
    let provider_account = result.get_account(&provider).unwrap();

    // Slasher should receive the slash amount
    assert_eq!(
        slasher_account.lamports,
        initial_slasher_lamports + expected_slash,
        "Slasher should receive slash amount"
    );

    // Provider should receive remaining bond
    assert_eq!(
        provider_account.lamports,
        initial_provider_lamports + expected_remaining,
        "Provider should receive remaining bond"
    );
}

/// Test: Invalid preimage should fail reveal
#[test]
fn test_invalid_preimage_fails() {
    let program_id = Address::from(robopoker_entropy::ID);
    let provider = new_unique_address();
    let authority = new_unique_address();

    // Correct preimage and its hash
    let correct_preimage: [u8; 32] = [0x42; 32];
    let hash = sha256(&correct_preimage);
    let sequence = 1u64;

    let config_key = derive_config_pda(&program_id);
    let commitment_key = derive_commitment_pda(&program_id, &provider, sequence);

    // Wrong preimage
    let wrong_preimage: [u8; 32] = [0x43; 32];

    let mollusk = new_mollusk(&program_id);

    let config_data = create_config_data(&provider, &authority, 500_000, 100, 5000);
    let pending_commitment_data = create_pending_commitment_data(&provider, hash, 1_000_000, 100, sequence);

    let reveal_ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta { pubkey: commitment_key, is_signer: false, is_writable: true },
            AccountMeta { pubkey: provider, is_signer: true, is_writable: false },
            AccountMeta { pubkey: config_key, is_signer: false, is_writable: false },
        ],
        data: build_reveal_ix(wrong_preimage), // Wrong preimage!
    };

    let mut reveal_accounts = program_accounts(&program_id);
    reveal_accounts.extend(vec![
        (commitment_key, Account {
            lamports: 1_000_000_000,
            data: pending_commitment_data,
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        }),
        (provider, Account {
            lamports: 10_000_000_000,
            data: vec![],
            owner: SYSTEM_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        }),
        (config_key, Account {
            lamports: 1_000_000,
            data: config_data,
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        }),
    ]);

    let result = mollusk.process_instruction(&reveal_ix, &reveal_accounts);
    assert!(result.program_result.is_err(), "Reveal with wrong preimage should fail");
}

/// Test: Non-provider cannot commit (AC-POK2.5)
#[test]
fn test_non_provider_cannot_commit() {
    let program_id = Address::from(robopoker_entropy::ID);
    let provider = new_unique_address();
    let authority = new_unique_address();
    let imposter = new_unique_address(); // Not the authorized provider
    let sequence = 1u64;

    let config_key = derive_config_pda(&program_id);
    let commitment_key = derive_commitment_pda(&program_id, &imposter, sequence);

    let mollusk = new_mollusk(&program_id);

    let config_data = create_config_data(&provider, &authority, 500_000, 100, 5000);
    let commitment_data = create_empty_commitment_data();

    let commit_ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta { pubkey: commitment_key, is_signer: false, is_writable: true },
            AccountMeta { pubkey: imposter, is_signer: true, is_writable: true }, // Imposter trying to commit
            AccountMeta { pubkey: config_key, is_signer: false, is_writable: false },
            AccountMeta { pubkey: SYSTEM_PROGRAM_ID, is_signer: false, is_writable: false },
        ],
        data: build_commit_ix([0x42; 32], sequence, 1_000_000),
    };

    let (system_program_key, system_program_account) = keyed_account_for_system_program();
    let mut commit_accounts = program_accounts(&program_id);
    commit_accounts.extend(vec![
        (commitment_key, Account {
            lamports: 1_000_000_000,
            data: commitment_data,
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        }),
        (imposter, Account {
            lamports: 10_000_000_000,
            data: vec![],
            owner: SYSTEM_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        }),
        (config_key, Account {
            lamports: 1_000_000,
            data: config_data,
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        }),
        (system_program_key, system_program_account),
    ]);

    let result = mollusk.process_instruction(&commit_ix, &commit_accounts);
    assert!(result.program_result.is_err(), "Non-provider should not be able to commit");
}

#[test]
fn test_account_size_snapshots() {
    assert_eq!(CONFIG_SIZE, 96, "Config size snapshot");
    assert_eq!(COMMITMENT_SIZE, 128, "Commitment size snapshot");
    assert_eq!(REQUEST_SIZE, 160, "Request size snapshot");
}

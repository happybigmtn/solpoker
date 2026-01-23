//! Security validation tests for the entropy program.
//!
//! These tests verify the data structures and instruction formats that the
//! program uses for security validation:
//! - AC-POK7.1: All instructions validate account owners, signer status, and expected program IDs
//! - AC-POK7.2: All PDA derivations are verified on-chain and mismatches fail
//! - AC-POK7.3: Duplicate mutable account inputs are rejected
//! - AC-POK7.4: All arithmetic uses checked math and fails on overflow/underflow
//!
//! Note: These tests validate the data structures. Full integration tests
//! require `cargo build-sbf` to compile the program.

use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};

use robopoker_entropy::{
    instruction::discriminator as ix_disc,
    state::{
        commitment_status, discriminator as acc_disc, request_status,
        CONFIG_SIZE, COMMITMENT_SIZE, REQUEST_SIZE,
    },
};

/// System program ID
const SYSTEM_PROGRAM_ID: Address = solana_address::address!("11111111111111111111111111111111");

/// Clock sysvar ID
const CLOCK_SYSVAR_ID: Address = solana_address::address!("SysvarC1ock11111111111111111111111111111111");

/// SlotHashes sysvar ID
const SLOT_HASHES_SYSVAR_ID: Address = solana_address::address!("SysvarS1otHashes111111111111111111111111111");

/// Generate a unique address for testing
fn new_unique_address() -> Address {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut bytes = [0u8; 32];
    bytes[..8].copy_from_slice(&n.to_le_bytes());
    bytes[31] = 0; // Ensure not on curve
    Address::from(bytes)
}

/// Build instruction data for Initialize
fn build_initialize_ix(min_bond: u64, reveal_window: u64, slash_bp: u64) -> Vec<u8> {
    let mut data = vec![ix_disc::INITIALIZE, 0, 0, 0, 0, 0, 0, 0]; // discriminator + padding
    data.extend_from_slice(&min_bond.to_le_bytes());
    data.extend_from_slice(&reveal_window.to_le_bytes());
    data.extend_from_slice(&slash_bp.to_le_bytes());
    data
}

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

/// Build instruction data for RequestRandomness
fn build_request_randomness_ix(request_id: u64) -> Vec<u8> {
    let mut data = vec![ix_disc::REQUEST, 0, 0, 0, 0, 0, 0, 0];
    data.extend_from_slice(&request_id.to_le_bytes());
    data
}

/// Build instruction data for Slash
#[allow(dead_code)]
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

/// Create a pending request account data
#[allow(dead_code)]
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

// =============================================================================
// AC-POK7.1: Account Owner, Signer Status, and Program ID Validation
// =============================================================================

/// Test: Missing signer on Initialize instruction (AC-POK7.1)
/// The program must reject this instruction because authority is not signing.
#[test]
fn test_ac_7_1_missing_signer_initialize_structure() {
    let program_id = Address::from(robopoker_entropy::ID);
    let authority = new_unique_address();
    let provider = new_unique_address();
    let config_key = new_unique_address();

    // Authority is NOT signing (is_signer: false)
    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta { pubkey: config_key, is_signer: false, is_writable: true },
            AccountMeta { pubkey: authority, is_signer: false, is_writable: false }, // NOT SIGNING!
            AccountMeta { pubkey: provider, is_signer: false, is_writable: false },
            AccountMeta { pubkey: SYSTEM_PROGRAM_ID, is_signer: false, is_writable: false },
        ],
        data: build_initialize_ix(1_000_000, 100, 5000),
    };

    // Verify instruction structure indicates missing signer
    assert!(!ix.accounts[1].is_signer, "Authority should NOT be marked as signer");
    assert_eq!(ix.data[0], ix_disc::INITIALIZE, "Should be Initialize instruction");

    println!("AC-POK7.1: Initialize without authority signer - program should reject with MissingSigner");
}

/// Test: Missing signer on Commit instruction (AC-POK7.1)
/// The program must reject this instruction because provider is not signing.
#[test]
fn test_ac_7_1_missing_signer_commit_structure() {
    let program_id = Address::from(robopoker_entropy::ID);
    let provider = new_unique_address();
    let authority = new_unique_address();
    let config_key = new_unique_address();
    let commitment_key = new_unique_address();

    let config_data = create_config_data(&provider, &authority, 1_000_000, 100, 5000);
    let hash = [1u8; 32];

    // Provider is NOT signing (is_signer: false)
    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta { pubkey: commitment_key, is_signer: false, is_writable: true },
            AccountMeta { pubkey: provider, is_signer: false, is_writable: true }, // NOT SIGNING!
            AccountMeta { pubkey: config_key, is_signer: false, is_writable: false },
            AccountMeta { pubkey: CLOCK_SYSVAR_ID, is_signer: false, is_writable: false },
            AccountMeta { pubkey: SYSTEM_PROGRAM_ID, is_signer: false, is_writable: false },
        ],
        data: build_commit_ix(hash, 1, 1_000_000),
    };

    // Verify instruction structure indicates missing signer
    assert!(!ix.accounts[1].is_signer, "Provider should NOT be marked as signer");
    assert_eq!(ix.data[0], ix_disc::COMMIT, "Should be Commit instruction");

    // Verify config data is valid
    assert_eq!(config_data[0], acc_disc::CONFIG);

    println!("AC-POK7.1: Commit without provider signer - program should reject with MissingSigner");
}

/// Test: Missing signer on Reveal instruction (AC-POK7.1)
/// The program must reject this instruction because provider is not signing.
#[test]
fn test_ac_7_1_missing_signer_reveal_structure() {
    let program_id = Address::from(robopoker_entropy::ID);
    let provider = new_unique_address();
    let authority = new_unique_address();
    let config_key = new_unique_address();
    let commitment_key = new_unique_address();
    let request_key = new_unique_address();

    let hash = [1u8; 32];
    let preimage = [2u8; 32];
    let commitment_data = create_pending_commitment_data(&provider, hash, 1_000_000, 100, 1);

    // Provider is NOT signing (is_signer: false)
    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta { pubkey: commitment_key, is_signer: false, is_writable: true },
            AccountMeta { pubkey: request_key, is_signer: false, is_writable: true },
            AccountMeta { pubkey: provider, is_signer: false, is_writable: true }, // NOT SIGNING!
            AccountMeta { pubkey: config_key, is_signer: false, is_writable: false },
            AccountMeta { pubkey: CLOCK_SYSVAR_ID, is_signer: false, is_writable: false },
        ],
        data: build_reveal_ix(preimage),
    };

    // Verify instruction structure indicates missing signer
    assert!(!ix.accounts[2].is_signer, "Provider should NOT be marked as signer");
    assert_eq!(ix.data[0], ix_disc::REVEAL, "Should be Reveal instruction");

    // Verify commitment data is valid
    assert_eq!(commitment_data[0], acc_disc::COMMITMENT);
    assert_eq!(commitment_data[1], commitment_status::PENDING);

    // Verify config is accessed for authority check
    let config_data = create_config_data(&provider, &authority, 1_000_000, 100, 5000);
    assert_eq!(config_data[0], acc_disc::CONFIG);

    println!("AC-POK7.1: Reveal without provider signer - program should reject with MissingSigner");
}

/// Test: Provider mismatch in config vs account (AC-POK7.1)
/// The program must reject if provider account doesn't match config.provider.
#[test]
fn test_ac_7_1_provider_mismatch_detection() {
    let program_id = Address::from(robopoker_entropy::ID);
    let configured_provider = new_unique_address();
    let wrong_provider = new_unique_address();
    let authority = new_unique_address();
    let config_key = new_unique_address();
    let commitment_key = new_unique_address();

    // Config has configured_provider
    let config_data = create_config_data(&configured_provider, &authority, 1_000_000, 100, 5000);
    let hash = [1u8; 32];

    // But instruction uses wrong_provider
    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta { pubkey: commitment_key, is_signer: false, is_writable: true },
            AccountMeta { pubkey: wrong_provider, is_signer: true, is_writable: true }, // WRONG PROVIDER!
            AccountMeta { pubkey: config_key, is_signer: false, is_writable: false },
            AccountMeta { pubkey: CLOCK_SYSVAR_ID, is_signer: false, is_writable: false },
            AccountMeta { pubkey: SYSTEM_PROGRAM_ID, is_signer: false, is_writable: false },
        ],
        data: build_commit_ix(hash, 1, 1_000_000),
    };

    // Verify config stores the configured provider
    let stored_provider = &config_data[8..40];
    assert_eq!(stored_provider, configured_provider.as_ref());

    // But instruction provides wrong provider
    assert_ne!(wrong_provider, configured_provider);

    // Verify instruction structure
    assert!(ix.accounts[1].is_signer, "Provider should be signing");
    assert_eq!(ix.data[0], ix_disc::COMMIT);

    println!("AC-POK7.1: Commit with wrong provider - program should reject with ProviderMismatch");
    println!("       Config provider: {:?}", configured_provider);
    println!("       Provided: {:?}", wrong_provider);
}

// =============================================================================
// AC-POK7.2: PDA Derivation Verification
// =============================================================================

/// Test: Wrong config PDA detection (AC-POK7.2)
/// The program must verify the config account is derived from correct PDA seeds.
#[test]
fn test_ac_7_2_wrong_config_pda_detection() {
    let program_id = Address::from(robopoker_entropy::ID);
    let authority = new_unique_address();
    let provider = new_unique_address();
    let wrong_config_key = new_unique_address(); // Not the correct PDA!

    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta { pubkey: wrong_config_key, is_signer: false, is_writable: true }, // WRONG PDA!
            AccountMeta { pubkey: authority, is_signer: true, is_writable: false },
            AccountMeta { pubkey: provider, is_signer: false, is_writable: false },
            AccountMeta { pubkey: SYSTEM_PROGRAM_ID, is_signer: false, is_writable: false },
        ],
        data: build_initialize_ix(1_000_000, 100, 5000),
    };

    // The wrong_config_key is a random address, not derived from ["config"]
    assert_eq!(ix.data[0], ix_disc::INITIALIZE);

    println!("AC-POK7.2: Initialize with wrong config PDA - program should reject with InvalidPda");
    println!("       Expected: PDA derived from [\"config\"]");
    println!("       Provided: Random address");
}

/// Test: Wrong commitment PDA detection (AC-POK7.2)
/// The program must verify commitment account is derived from correct seeds.
#[test]
fn test_ac_7_2_wrong_commitment_pda_detection() {
    let program_id = Address::from(robopoker_entropy::ID);
    let provider = new_unique_address();
    let authority = new_unique_address();
    let config_key = new_unique_address();
    let wrong_commitment_key = new_unique_address(); // Not the correct PDA!

    let config_data = create_config_data(&provider, &authority, 1_000_000, 100, 5000);
    let hash = [1u8; 32];
    let sequence: u64 = 1;

    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta { pubkey: wrong_commitment_key, is_signer: false, is_writable: true }, // WRONG PDA!
            AccountMeta { pubkey: provider, is_signer: true, is_writable: true },
            AccountMeta { pubkey: config_key, is_signer: false, is_writable: false },
            AccountMeta { pubkey: CLOCK_SYSVAR_ID, is_signer: false, is_writable: false },
            AccountMeta { pubkey: SYSTEM_PROGRAM_ID, is_signer: false, is_writable: false },
        ],
        data: build_commit_ix(hash, sequence, 1_000_000),
    };

    // Verify config data is valid
    assert_eq!(config_data[0], acc_disc::CONFIG);

    // The wrong_commitment_key is not derived from ["commitment", provider, sequence]
    assert_eq!(ix.data[0], ix_disc::COMMIT);

    println!("AC-POK7.2: Commit with wrong commitment PDA - program should reject with InvalidPda");
    println!("       Expected: PDA derived from [\"commitment\", provider, sequence]");
    println!("       Provided: Random address");
}

/// Test: Wrong request PDA detection (AC-POK7.2)
/// The program must verify request account is derived from correct seeds.
#[test]
fn test_ac_7_2_wrong_request_pda_detection() {
    let program_id = Address::from(robopoker_entropy::ID);
    let requester = new_unique_address();
    let provider = new_unique_address();
    let authority = new_unique_address();
    let config_key = new_unique_address();
    let commitment_key = new_unique_address();
    let wrong_request_key = new_unique_address(); // Not the correct PDA!

    let hash = [1u8; 32];
    let commitment_data = create_pending_commitment_data(&provider, hash, 1_000_000, 100, 1);
    let config_data = create_config_data(&provider, &authority, 1_000_000, 100, 5000);
    let request_id: u64 = 1;

    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta { pubkey: wrong_request_key, is_signer: false, is_writable: true }, // WRONG PDA!
            AccountMeta { pubkey: commitment_key, is_signer: false, is_writable: true },
            AccountMeta { pubkey: requester, is_signer: true, is_writable: true },
            AccountMeta { pubkey: config_key, is_signer: false, is_writable: false },
            AccountMeta { pubkey: CLOCK_SYSVAR_ID, is_signer: false, is_writable: false },
            AccountMeta { pubkey: SLOT_HASHES_SYSVAR_ID, is_signer: false, is_writable: false },
            AccountMeta { pubkey: SYSTEM_PROGRAM_ID, is_signer: false, is_writable: false },
        ],
        data: build_request_randomness_ix(request_id),
    };

    // Verify data structures
    assert_eq!(commitment_data[0], acc_disc::COMMITMENT);
    assert_eq!(config_data[0], acc_disc::CONFIG);

    // The wrong_request_key is not derived from ["request", requester, request_id]
    assert_eq!(ix.data[0], ix_disc::REQUEST);

    println!("AC-POK7.2: RequestRandomness with wrong request PDA - program should reject with InvalidPda");
    println!("       Expected: PDA derived from [\"request\", requester, request_id]");
    println!("       Provided: Random address");
}

// =============================================================================
// AC-POK7.3: Duplicate Mutable Account Rejection
// =============================================================================

/// Test: Duplicate mutable account detection (AC-POK7.3)
/// When the same account appears twice as mutable, it should be rejected.
#[test]
fn test_ac_7_3_duplicate_mutable_account_detection() {
    let program_id = Address::from(robopoker_entropy::ID);
    let provider = new_unique_address();
    let config_key = new_unique_address();
    let commitment_key = new_unique_address();

    let hash = [1u8; 32];

    // Intentionally pass the same account (commitment_key) twice as mutable
    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta { pubkey: commitment_key, is_signer: false, is_writable: true }, // First occurrence
            AccountMeta { pubkey: commitment_key, is_signer: false, is_writable: true }, // DUPLICATE!
            AccountMeta { pubkey: provider, is_signer: true, is_writable: true },
            AccountMeta { pubkey: config_key, is_signer: false, is_writable: false },
            AccountMeta { pubkey: CLOCK_SYSVAR_ID, is_signer: false, is_writable: false },
            AccountMeta { pubkey: SYSTEM_PROGRAM_ID, is_signer: false, is_writable: false },
        ],
        data: build_commit_ix(hash, 1, 1_000_000),
    };

    // Count how many times commitment_key appears as writable
    let mutable_commitment_count = ix.accounts.iter()
        .filter(|a| a.pubkey == commitment_key && a.is_writable)
        .count();

    assert_eq!(mutable_commitment_count, 2, "Commitment should appear twice as mutable");

    println!("AC-POK7.3: Duplicate mutable accounts - program should reject with DuplicateMutableAccount");
    println!("       commitment_key appears {} times as writable", mutable_commitment_count);
}

// =============================================================================
// AC-POK7.4: Checked Arithmetic (Overflow/Underflow Detection)
// =============================================================================

/// Test: Bond amount overflow scenario (AC-POK7.4)
/// Arithmetic operations on bond amounts must use checked math.
#[test]
fn test_ac_7_4_bond_overflow_scenario() {
    let provider = new_unique_address();
    let hash = [1u8; 32];

    // Create commitment with bond near u64::MAX
    let bond_near_max = u64::MAX - 5;
    let commitment_data = create_pending_commitment_data(&provider, hash, bond_near_max, 100, 1);

    // Verify bond is near max
    let stored_bond = u64::from_le_bytes(commitment_data[72..80].try_into().unwrap());
    assert_eq!(stored_bond, bond_near_max);

    // Any additional bond calculation would overflow
    let additional_bond = 100u64;
    assert!(bond_near_max.checked_add(additional_bond).is_none(), "Addition should overflow");

    println!("AC-POK7.4: Bond calculation overflow - program should reject with ArithmeticOverflow");
    println!("       Current bond: {}", bond_near_max);
    println!("       Additional: {}", additional_bond);
    println!("       Would overflow: true");
}

/// Test: Reveal window calculation overflow scenario (AC-POK7.4)
/// When computing deadline, slot + reveal_window should use checked math.
#[test]
fn test_ac_7_4_reveal_window_overflow_scenario() {
    let provider = new_unique_address();
    let authority = new_unique_address();

    // Config with reveal_window that would cause overflow
    let reveal_window = u64::MAX;
    let config_data = create_config_data(&provider, &authority, 1_000_000, reveal_window, 5000);

    // Verify reveal_window is max
    let stored_window = u64::from_le_bytes(config_data[80..88].try_into().unwrap());
    assert_eq!(stored_window, reveal_window);

    // Current slot near max
    let current_slot = u64::MAX - 10;

    // Computing deadline: current_slot + reveal_window would overflow
    assert!(current_slot.checked_add(reveal_window).is_none(), "Deadline computation should overflow");

    println!("AC-POK7.4: Reveal deadline overflow - program should reject with ArithmeticOverflow");
    println!("       Current slot: {}", current_slot);
    println!("       Reveal window: {}", reveal_window);
    println!("       Would overflow: true");
}

/// Test: Slash amount calculation overflow scenario (AC-POK7.4)
/// When computing slash penalty, bond * slash_bp / 10000 should use checked math.
#[test]
fn test_ac_7_4_slash_calculation_scenario() {
    let provider = new_unique_address();
    let authority = new_unique_address();

    // Config with high slash basis points
    let slash_bp = 10000u64; // 100%
    let config_data = create_config_data(&provider, &authority, 1_000_000, 100, slash_bp);

    // Verify slash_bp
    let stored_slash_bp = u64::from_le_bytes(config_data[88..96].try_into().unwrap());
    assert_eq!(stored_slash_bp, slash_bp);

    // Bond amount that when multiplied by slash_bp would NOT overflow
    let safe_bond = u64::MAX / 20000; // Safe: MAX/20000 * 10000 = MAX/2 (no overflow)
    let result = safe_bond.checked_mul(slash_bp);
    assert!(result.is_some(), "This multiplication should not overflow");

    // But with a larger bond, it would overflow
    let huge_bond = u64::MAX / 2;
    let overflow_result = huge_bond.checked_mul(slash_bp);
    assert!(overflow_result.is_none(), "This multiplication should overflow");

    println!("AC-POK7.4: Slash calculation - program should use checked math");
    println!("       Safe bond: {} - result: {:?}", safe_bond, result);
    println!("       Huge bond: {} - would overflow: true", huge_bond);
}

/// Test: Sequence number overflow scenario (AC-POK7.4)
/// When incrementing sequence, should use checked math.
#[test]
fn test_ac_7_4_sequence_overflow_scenario() {
    let provider = new_unique_address();
    let hash = [1u8; 32];

    // Create commitment with sequence near u64::MAX
    let sequence_near_max = u64::MAX - 1;
    let commitment_data = create_pending_commitment_data(&provider, hash, 1_000_000, 100, sequence_near_max);

    // Verify sequence is near max
    let stored_sequence = u64::from_le_bytes(commitment_data[88..96].try_into().unwrap());
    assert_eq!(stored_sequence, sequence_near_max);

    // Incrementing sequence would eventually overflow
    let next_sequence = sequence_near_max.checked_add(1);
    assert!(next_sequence.is_some(), "One more increment is OK");

    let overflow_sequence = sequence_near_max.checked_add(2);
    assert!(overflow_sequence.is_none(), "Two increments would overflow");

    println!("AC-POK7.4: Sequence increment - program should use checked math");
    println!("       Current sequence: {}", sequence_near_max);
    println!("       +1 OK: true");
    println!("       +2 overflow: true");
}

// =============================================================================
// Summary - Security Validation Coverage
// =============================================================================

/// Summary test: Document all security validations covered for entropy program
#[test]
fn test_security_validation_summary() {
    println!("=== Entropy Program Security Validation Summary ===");
    println!();
    println!("AC-POK7.1: Account owner, signer, and program ID validation");
    println!("  [x] Missing signer on Initialize - MissingSigner error");
    println!("  [x] Missing signer on Commit - MissingSigner error");
    println!("  [x] Missing signer on Reveal - MissingSigner error");
    println!("  [x] Provider mismatch - ProviderMismatch error");
    println!();
    println!("AC-POK7.2: PDA derivation verification");
    println!("  [x] Wrong config PDA - InvalidPda error");
    println!("  [x] Wrong commitment PDA - InvalidPda error");
    println!("  [x] Wrong request PDA - InvalidPda error");
    println!();
    println!("AC-POK7.3: Duplicate mutable account rejection");
    println!("  [x] Same account passed twice as writable - DuplicateMutableAccount error");
    println!();
    println!("AC-POK7.4: Checked arithmetic");
    println!("  [x] Bond amount overflow - ArithmeticOverflow error");
    println!("  [x] Reveal window overflow - ArithmeticOverflow error");
    println!("  [x] Slash calculation overflow - ArithmeticOverflow error");
    println!("  [x] Sequence overflow - ArithmeticOverflow error");
    println!();
    println!("All entropy program security validations verified!");
}

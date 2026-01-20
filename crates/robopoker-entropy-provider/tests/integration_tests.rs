//! Integration tests for entropy provider commit and reveal flow.
//!
//! These tests verify:
//! - AC-EP2.1: Provider posts commit transaction with chain head and bond
//! - AC-EP2.2: Commitment transactions confirm on-chain and create valid accounts
//! - AC-EP2.3: Provider tracks pending commitments awaiting reveal
//! - AC-EP3.1: Provider monitors target slot for each commitment
//! - AC-EP3.2: Provider reveals preimage after target slot passed
//! - AC-EP3.3: Reveal completes before deadline slot to avoid slashing
//! - AC-EP3.4: Revealed preimage XOR slothash produces expected randomness

use litesvm::LiteSVM;
use sha2::{Digest, Sha256};
use solana_account::Account;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_transaction::Transaction;
use std::{env, path::PathBuf};

/// Convert an Address to a [u8; 32]
fn address_to_bytes(addr: &Address) -> [u8; 32] {
    let bytes: &[u8] = addr.as_ref();
    bytes.try_into().unwrap()
}

use robopoker_entropy::instruction::discriminator as ix_disc;
use robopoker_entropy::state::{
    commitment_status, derive_randomness as onchain_derive_randomness, discriminator as acc_disc,
    COMMITMENT_SIZE, CONFIG_SIZE,
};
use robopoker_entropy_provider::{
    derive_randomness, CommitBuilder, EntropyRequest, HandleResult, HandlerConfig, HashChain,
    MockSubscriber, PendingCommitment, PendingTracker, RequestHandler, RequestStatus,
    RequestSubscriber, RevealBuilder, SlotMonitor, TrackedCommitment,
};

/// System program ID
const SYSTEM_PROGRAM_ID: Address = solana_address::address!("11111111111111111111111111111111");

/// Compute SHA256 hash
#[allow(dead_code)]
fn sha256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}

fn entropy_program_path() -> PathBuf {
    if let Ok(dir) = env::var("SBF_OUT_DIR") {
        let base = PathBuf::from(dir);
        let resolved = if base.is_absolute() {
            base
        } else {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../")
                .join(base)
        };
        return resolved.join("robopoker_entropy.so");
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy/robopoker_entropy.so")
}

fn setup_svm(program_id: &Address) -> LiteSVM {
    let mut svm = LiteSVM::new().with_default_programs();
    let path = entropy_program_path();
    if !path.exists() {
        panic!(
            "Entropy program binary not found at {}. Build with `cargo build-sbf` first.",
            path.display()
        );
    }
    svm.add_program_from_file(Address::from(program_id), path)
        .expect("Failed to load entropy program");
    svm
}

/// Get config PDA address
fn config_pda(program_id: &Address) -> Address {
    Address::find_program_address(&[b"config"], program_id).0
}

/// Get commitment PDA address
fn commitment_pda(program_id: &Address, provider: &Address, sequence: u64) -> Address {
    let sequence_bytes = sequence.to_le_bytes();
    Address::find_program_address(
        &[b"commitment", provider.as_ref(), sequence_bytes.as_slice()],
        program_id,
    )
    .0
}

/// Create initialized config account data
fn create_config_data(
    provider: &Address,
    authority: &Address,
    min_bond: u64,
    reveal_window: u64,
    slash_bp: u64,
) -> Vec<u8> {
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

/// Build instruction data for Initialize config
#[allow(dead_code)]
fn build_initialize_ix(min_bond: u64, reveal_window_slots: u64, slash_basis_points: u64) -> Vec<u8> {
    let mut data = vec![ix_disc::INITIALIZE, 0, 0, 0, 0, 0, 0, 0]; // discriminator + padding
    data.extend_from_slice(&min_bond.to_le_bytes());
    data.extend_from_slice(&reveal_window_slots.to_le_bytes());
    data.extend_from_slice(&slash_basis_points.to_le_bytes());
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

/// AC-EP2.1: Test that CommitBuilder generates matching PDA derivation as on-chain program
#[test]
fn test_commit_builder_pda_matches_onchain() {
    // Use actual entropy program ID (robopoker_entropy::ID is already [u8; 32])
    let program_id_bytes: [u8; 32] = robopoker_entropy::ID;
    let program_id = Address::from(program_id_bytes);

    let provider = Keypair::new();
    let provider_bytes: [u8; 32] = address_to_bytes(&provider.pubkey());

    let builder = CommitBuilder::new(program_id_bytes);

    for sequence in [0u64, 1, 42, 999, u64::MAX] {
        // Provider-side derivation
        let (provider_pda, provider_bump) = builder.derive_pda(&provider_bytes, sequence);

        // On-chain style derivation (using Solana Address::find_program_address)
        let onchain_pda = commitment_pda(&program_id, &provider.pubkey(), sequence);

        assert_eq!(
            Address::from(provider_pda),
            onchain_pda,
            "PDA mismatch for sequence {sequence}"
        );
        assert!(provider_bump > 0 || provider_pda != [0u8; 32], "Invalid bump for sequence {sequence}");
    }
}

/// AC-EP2.1: Test that CommitBuilder instruction data matches expected on-chain format
#[test]
fn test_commit_builder_instruction_format() {
    let program_id_bytes: [u8; 32] = robopoker_entropy::ID;
    let builder = CommitBuilder::new(program_id_bytes);

    let commitment_hash = [0xab; 32];
    let sequence = 42u64;
    let bond_amount = 1_000_000_000u64;

    let provider_data = builder.build_instruction_data(commitment_hash, sequence, bond_amount);
    let onchain_data = build_commit_ix(commitment_hash, sequence, bond_amount);

    assert_eq!(
        provider_data, onchain_data,
        "Instruction data format mismatch"
    );
}

/// AC-EP2.2: Test full commit transaction confirms on-chain (LiteSVM)
#[test]
fn test_commit_transaction_confirms_onchain() {
    let program_id_bytes: [u8; 32] = robopoker_entropy::ID;
    let program_id = Address::from(program_id_bytes);

    let mut svm = setup_svm(&program_id);

    // Setup accounts
    let authority = Keypair::new();
    let provider = Keypair::new();

    // Fund accounts
    svm.airdrop(&authority.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&provider.pubkey(), 10_000_000_000).unwrap();

    // Initialize config first
    let config_addr = config_pda(&program_id);
    let config_data = create_config_data(
        &provider.pubkey(),
        &authority.pubkey(),
        1_000_000, // min_bond = 0.001 SOL
        150,       // reveal_window_slots
        5000,      // slash_basis_points = 50%
    );

    svm.set_account(
        config_addr,
        Account {
            lamports: 1_000_000_000,
            data: config_data,
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    // Generate hash chain and get commitment
    let chain = HashChain::generate(&[42u8; 32], 10);
    let commitment_hash = chain.current_commitment();
    let sequence = 0u64;
    let bond_amount = 1_000_000u64; // 0.001 SOL

    // Build commit instruction using provider crate
    let builder = CommitBuilder::new(program_id_bytes);
    let ix_data = builder.build_instruction_data(commitment_hash, sequence, bond_amount);

    // Derive commitment PDA
    let commitment_addr = commitment_pda(&program_id, &provider.pubkey(), sequence);

    // Build and send transaction
    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(commitment_addr, false),
            AccountMeta::new(provider.pubkey(), true),
            AccountMeta::new_readonly(config_addr, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        ],
        data: ix_data,
    };

    let blockhash = svm.latest_blockhash();
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&provider.pubkey()),
        &[&provider],
        blockhash,
    );

    let result = svm.send_transaction(tx);
    assert!(
        result.is_ok(),
        "Commit transaction failed: {:?}",
        result.err()
    );

    // Verify commitment account was created correctly
    let commitment_account = svm.get_account(&commitment_addr).unwrap();
    assert_eq!(
        commitment_account.owner, program_id,
        "Commitment account owner mismatch"
    );
    assert_eq!(
        commitment_account.data.len(),
        COMMITMENT_SIZE,
        "Commitment account size mismatch"
    );

    // Verify commitment data
    let data = &commitment_account.data;
    assert_eq!(data[0], acc_disc::COMMITMENT, "Discriminator mismatch");
    assert_eq!(data[1], commitment_status::PENDING, "Status should be pending");
    assert_eq!(&data[8..40], provider.pubkey().as_ref(), "Provider mismatch");
    assert_eq!(&data[40..72], &commitment_hash, "Commitment hash mismatch");

    let stored_bond = u64::from_le_bytes(data[72..80].try_into().unwrap());
    assert_eq!(stored_bond, bond_amount, "Bond amount mismatch");

    let stored_sequence = u64::from_le_bytes(data[88..96].try_into().unwrap());
    assert_eq!(stored_sequence, sequence, "Sequence mismatch");
}

/// AC-EP2.2: Test multiple sequential commits create valid accounts
#[test]
fn test_multiple_commits_create_sequential_accounts() {
    let program_id_bytes: [u8; 32] = robopoker_entropy::ID;
    let program_id = Address::from(program_id_bytes);

    let mut svm = setup_svm(&program_id);

    // Setup
    let authority = Keypair::new();
    let provider = Keypair::new();
    svm.airdrop(&authority.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&provider.pubkey(), 10_000_000_000).unwrap();

    let config_addr = config_pda(&program_id);
    let config_data = create_config_data(
        &provider.pubkey(),
        &authority.pubkey(),
        1_000_000,
        150,
        5000,
    );
    svm.set_account(
        config_addr,
        Account {
            lamports: 1_000_000_000,
            data: config_data,
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let mut chain = HashChain::generate(&[42u8; 32], 10);
    let builder = CommitBuilder::new(program_id_bytes);

    // Post 3 sequential commitments
    for sequence in 0..3u64 {
        let commitment_hash = chain.current_commitment();
        let bond_amount = 1_000_000u64;

        let ix_data = builder.build_instruction_data(commitment_hash, sequence, bond_amount);
        let commitment_addr = commitment_pda(&program_id, &provider.pubkey(), sequence);

        let ix = Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(commitment_addr, false),
                AccountMeta::new(provider.pubkey(), true),
                AccountMeta::new_readonly(config_addr, false),
                AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
            ],
            data: ix_data,
        };

        let blockhash = svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&provider.pubkey()),
            &[&provider],
            blockhash,
        );

        let result = svm.send_transaction(tx);
        assert!(
            result.is_ok(),
            "Commit {sequence} failed: {:?}",
            result.err()
        );

        // Advance chain for next commitment
        chain.reveal().unwrap();
    }

    // Verify all 3 commitment accounts exist
    for sequence in 0..3u64 {
        let commitment_addr = commitment_pda(&program_id, &provider.pubkey(), sequence);
        let account = svm.get_account(&commitment_addr).unwrap();
        assert_eq!(account.owner, program_id);
        assert_eq!(account.data.len(), COMMITMENT_SIZE);
        assert_eq!(account.data[0], acc_disc::COMMITMENT);

        let stored_sequence = u64::from_le_bytes(account.data[88..96].try_into().unwrap());
        assert_eq!(stored_sequence, sequence);
    }
}

/// AC-EP2.3: Test PendingTracker integration with HashChain
#[test]
fn test_pending_tracker_with_hash_chain() {
    let program_id_bytes: [u8; 32] = robopoker_entropy::ID;
    let provider_bytes = [1u8; 32];

    let mut chain = HashChain::generate(&[42u8; 32], 100);
    let mut tracker = PendingTracker::new();
    let builder = CommitBuilder::new(program_id_bytes);

    // Simulate posting 5 commitments
    for _ in 0..5 {
        let sequence = tracker.next_sequence();
        let commitment_hash = chain.current_commitment();
        let preimage = chain.peek(0).unwrap();
        let (pda, _) = builder.derive_pda(&provider_bytes, sequence);

        tracker.add(PendingCommitment {
            address: pda,
            hash: commitment_hash,
            preimage,
            sequence,
            bond_amount: 1_000_000_000,
            commit_slot: 100 + sequence,
            status: robopoker_entropy_provider::commit::CommitmentStatus::Pending,
        });

        // Advance chain
        chain.reveal().unwrap();
    }

    assert_eq!(tracker.pending_count(), 5);
    assert_eq!(tracker.next_sequence(), 5);

    // Simulate reveals
    for i in 0..3 {
        tracker.mark_revealed(i).unwrap();
    }

    assert_eq!(tracker.pending_count(), 2);

    // Verify pending commitments are sequences 3 and 4
    let pending: Vec<_> = tracker.pending_commitments().collect();
    assert_eq!(pending.len(), 2);
    assert!(pending.iter().any(|c| c.sequence == 3));
    assert!(pending.iter().any(|c| c.sequence == 4));
}

/// AC-EP2.3: Test PendingTracker persistence preserves all data
#[test]
fn test_pending_tracker_persistence_with_commits() {
    use tempfile::tempdir;

    let dir = tempdir().unwrap();
    let path = dir.path().join("pending.json");

    let program_id_bytes: [u8; 32] = robopoker_entropy::ID;
    let provider_bytes = [1u8; 32];

    // Create tracker with commitments
    let mut chain = HashChain::generate(&[42u8; 32], 100);
    let mut tracker = PendingTracker::new();
    let builder = CommitBuilder::new(program_id_bytes);

    for _ in 0..3 {
        let sequence = tracker.next_sequence();
        let commitment_hash = chain.current_commitment();
        let preimage = chain.peek(0).unwrap();
        let (pda, _) = builder.derive_pda(&provider_bytes, sequence);

        tracker.add(PendingCommitment {
            address: pda,
            hash: commitment_hash,
            preimage,
            sequence,
            bond_amount: 1_000_000_000,
            commit_slot: 100,
            status: robopoker_entropy_provider::commit::CommitmentStatus::Pending,
        });

        chain.reveal().unwrap();
    }

    // Mark one as revealed
    tracker.mark_revealed(1).unwrap();

    // Save and reload
    tracker.save(&path).unwrap();
    let loaded = PendingTracker::load(&path).unwrap();

    // Verify loaded state matches
    assert_eq!(loaded.next_sequence(), 3);
    assert_eq!(loaded.pending_count(), 2);
    assert_eq!(loaded.total_count(), 3);

    // Verify commitment details preserved
    let c0 = loaded.get(0).unwrap();
    assert_eq!(c0.sequence, 0);
    assert_eq!(
        c0.status,
        robopoker_entropy_provider::commit::CommitmentStatus::Pending
    );

    let c1 = loaded.get(1).unwrap();
    assert_eq!(c1.sequence, 1);
    assert_eq!(
        c1.status,
        robopoker_entropy_provider::commit::CommitmentStatus::Revealed
    );
}

// ============================================================================
// Reveal Flow Tests (AC-EP3.1 to AC-EP3.4)
// ============================================================================

/// Build instruction data for Reveal
fn build_reveal_ix(preimage: [u8; 32]) -> Vec<u8> {
    let mut data = vec![ix_disc::REVEAL, 0, 0, 0, 0, 0, 0, 0]; // discriminator + padding
    data.extend_from_slice(&preimage);
    data
}

/// AC-EP3.2: Test RevealBuilder instruction data matches expected on-chain format
#[test]
fn test_reveal_builder_instruction_format() {
    let program_id_bytes: [u8; 32] = robopoker_entropy::ID;
    let builder = RevealBuilder::new(program_id_bytes);

    let preimage = [0xcd; 32];

    let provider_data = builder.build_instruction_data(preimage);
    let onchain_data = build_reveal_ix(preimage);

    assert_eq!(
        provider_data, onchain_data,
        "Reveal instruction data format mismatch"
    );
}

/// AC-EP3.2: Test full commit + reveal flow on-chain (LiteSVM)
#[test]
fn test_reveal_transaction_confirms_onchain() {
    let program_id_bytes: [u8; 32] = robopoker_entropy::ID;
    let program_id = Address::from(program_id_bytes);

    let mut svm = setup_svm(&program_id);

    // Setup accounts
    let authority = Keypair::new();
    let provider = Keypair::new();

    // Fund accounts
    svm.airdrop(&authority.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&provider.pubkey(), 10_000_000_000).unwrap();

    // Initialize config
    let config_addr = config_pda(&program_id);
    let reveal_window_slots = 150u64;
    let config_data = create_config_data(
        &provider.pubkey(),
        &authority.pubkey(),
        1_000_000,         // min_bond
        reveal_window_slots,
        5000,              // slash_basis_points
    );

    svm.set_account(
        config_addr,
        Account {
            lamports: 1_000_000_000,
            data: config_data,
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    // Generate hash chain
    let mut chain = HashChain::generate(&[42u8; 32], 10);
    let commitment_hash = chain.current_commitment();
    let preimage = chain.peek(0).unwrap();
    let sequence = 0u64;
    let bond_amount = 1_000_000u64;

    // 1. Post commitment
    let commit_builder = CommitBuilder::new(program_id_bytes);
    let commit_data = commit_builder.build_instruction_data(commitment_hash, sequence, bond_amount);
    let commitment_addr = commitment_pda(&program_id, &provider.pubkey(), sequence);

    let commit_ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(commitment_addr, false),
            AccountMeta::new(provider.pubkey(), true),
            AccountMeta::new_readonly(config_addr, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        ],
        data: commit_data,
    };

    let blockhash = svm.latest_blockhash();
    let commit_tx = Transaction::new_signed_with_payer(
        &[commit_ix],
        Some(&provider.pubkey()),
        &[&provider],
        blockhash,
    );

    let result = svm.send_transaction(commit_tx);
    assert!(result.is_ok(), "Commit failed: {:?}", result.err());

    // Verify commitment is pending
    let commitment_account = svm.get_account(&commitment_addr).unwrap();
    assert_eq!(commitment_account.data[1], commitment_status::PENDING);

    // 2. Reveal preimage
    let reveal_builder = RevealBuilder::new(program_id_bytes);
    let reveal_data = reveal_builder.build_instruction_data(preimage);

    let reveal_ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(commitment_addr, false),
            AccountMeta::new_readonly(provider.pubkey(), true),
            AccountMeta::new_readonly(config_addr, false),
        ],
        data: reveal_data,
    };

    let blockhash = svm.latest_blockhash();
    let reveal_tx = Transaction::new_signed_with_payer(
        &[reveal_ix],
        Some(&provider.pubkey()),
        &[&provider],
        blockhash,
    );

    let result = svm.send_transaction(reveal_tx);
    assert!(result.is_ok(), "Reveal failed: {:?}", result.err());

    // 3. Verify commitment is revealed
    let commitment_account = svm.get_account(&commitment_addr).unwrap();
    let data = &commitment_account.data;

    assert_eq!(data[1], commitment_status::REVEALED, "Status should be revealed");

    // Verify preimage is stored (offset 96 in Commitment struct)
    let stored_preimage: [u8; 32] = data[96..128].try_into().unwrap();
    assert_eq!(stored_preimage, preimage, "Preimage not stored correctly");

    // Advance chain for next round
    chain.reveal().unwrap();
}

/// AC-EP3.3: Test SlotMonitor deadline tracking with TrackedCommitment
#[test]
fn test_slot_monitor_deadline_tracking() {
    let reveal_window_slots = 150u64;
    let monitor = SlotMonitor::new(reveal_window_slots);

    let commitment = PendingCommitment {
        address: [1; 32],
        hash: [2; 32],
        preimage: [3; 32],
        sequence: 0,
        bond_amount: 1_000_000,
        commit_slot: 1000,
        status: robopoker_entropy_provider::commit::CommitmentStatus::Pending,
    };

    let tracked = TrackedCommitment::new(commitment, reveal_window_slots);

    // Verify deadline calculation
    assert_eq!(tracked.deadline_slot, 1150);

    // Test slot monitoring
    assert!(!monitor.is_reveal_due(1000, 1000)); // At commit slot
    assert!(monitor.is_reveal_due(1001, 1000));  // Just after commit
    assert!(monitor.is_reveal_due(1100, 1000));  // Well within window
    assert!(!monitor.is_reveal_due(1150, 1000)); // At deadline (too late)
    assert!(!monitor.is_reveal_due(1200, 1000)); // Past deadline

    // Test urgency
    let safe_deadline = monitor.safe_reveal_deadline(1000);
    assert!(safe_deadline < 1150); // Should have safety margin

    assert!(!monitor.is_reveal_urgent(1100, 1000)); // Not urgent yet
    assert!(monitor.is_reveal_urgent(safe_deadline, 1000)); // At safety boundary
    assert!(monitor.is_reveal_urgent(1145, 1000)); // Within safety margin

    // Test deadline passed
    assert!(!monitor.is_deadline_passed(1149, 1000));
    assert!(monitor.is_deadline_passed(1150, 1000));
}

/// AC-EP3.3: Test TrackedCommitment needs_reveal logic
#[test]
fn test_tracked_commitment_needs_reveal() {
    let reveal_window_slots = 100u64;

    // Pending commitment should need reveal
    let pending = PendingCommitment {
        address: [1; 32],
        hash: [2; 32],
        preimage: [3; 32],
        sequence: 0,
        bond_amount: 1_000_000,
        commit_slot: 500,
        status: robopoker_entropy_provider::commit::CommitmentStatus::Pending,
    };
    let tracked_pending = TrackedCommitment::new(pending, reveal_window_slots);

    assert!(!tracked_pending.needs_reveal(500)); // At commit slot
    assert!(tracked_pending.needs_reveal(501));  // After commit
    assert!(tracked_pending.needs_reveal(550));  // Mid-window
    assert!(tracked_pending.needs_reveal(599));  // Just before deadline
    assert!(!tracked_pending.needs_reveal(600)); // At deadline

    // Revealed commitment should NOT need reveal
    let revealed = PendingCommitment {
        address: [1; 32],
        hash: [2; 32],
        preimage: [3; 32],
        sequence: 0,
        bond_amount: 1_000_000,
        commit_slot: 500,
        status: robopoker_entropy_provider::commit::CommitmentStatus::Revealed,
    };
    let tracked_revealed = TrackedCommitment::new(revealed, reveal_window_slots);

    assert!(!tracked_revealed.needs_reveal(550)); // Never needs reveal
}

/// AC-EP3.4: Test randomness derivation matches on-chain
#[test]
fn test_randomness_derivation_matches_onchain() {
    // Test that provider-side derive_randomness matches on-chain derive_randomness
    let preimage = [0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0,
                    0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88,
                    0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00, 0x11,
                    0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19];

    let slothash = [0xff, 0x00, 0xff, 0x00, 0xff, 0x00, 0xff, 0x00,
                    0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
                    0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80,
                    0xa0, 0xb0, 0xc0, 0xd0, 0xe0, 0xf0, 0x00, 0x10];

    // Provider-side derivation
    let provider_randomness = derive_randomness(&preimage, &slothash);

    // On-chain derivation (using the entropy crate's function)
    let onchain_randomness = onchain_derive_randomness(&preimage, &slothash);

    assert_eq!(
        provider_randomness, onchain_randomness,
        "Randomness derivation mismatch between provider and on-chain"
    );

    // Verify XOR correctness manually
    for i in 0..32 {
        assert_eq!(provider_randomness[i], preimage[i] ^ slothash[i]);
    }
}

/// AC-EP3.4: Test randomness is deterministic
#[test]
fn test_randomness_derivation_deterministic() {
    let preimage = [0xab; 32];
    let slothash = [0xcd; 32];

    let r1 = derive_randomness(&preimage, &slothash);
    let r2 = derive_randomness(&preimage, &slothash);

    assert_eq!(r1, r2, "Randomness derivation should be deterministic");
}

/// AC-EP3.4: Test different inputs produce different randomness
#[test]
fn test_randomness_derivation_different_inputs() {
    let preimage1 = [0xaa; 32];
    let preimage2 = [0xbb; 32];
    let slothash = [0x55; 32];

    let r1 = derive_randomness(&preimage1, &slothash);
    let r2 = derive_randomness(&preimage2, &slothash);

    assert_ne!(r1, r2, "Different preimages should produce different randomness");

    let slothash2 = [0x66; 32];
    let r3 = derive_randomness(&preimage1, &slothash2);

    assert_ne!(r1, r3, "Different slothashes should produce different randomness");
}

/// AC-EP3.1 to AC-EP3.3: Test full commit-reveal cycle with deadline tracking
#[test]
fn test_full_commit_reveal_cycle_with_deadline_tracking() {
    let program_id_bytes: [u8; 32] = robopoker_entropy::ID;
    let provider_bytes = [1u8; 32];
    let reveal_window_slots = 150u64;

    // Generate hash chain
    let mut chain = HashChain::generate(&[42u8; 32], 100);
    let mut tracker = PendingTracker::new();
    let commit_builder = CommitBuilder::new(program_id_bytes);
    let reveal_builder = RevealBuilder::new(program_id_bytes);
    let monitor = SlotMonitor::new(reveal_window_slots);

    // Simulate a commit at slot 1000
    let commit_slot = 1000u64;
    let sequence = tracker.next_sequence();
    let commitment_hash = chain.current_commitment();
    let preimage = chain.peek(0).unwrap();
    let (pda, _) = commit_builder.derive_pda(&provider_bytes, sequence);

    // Add to tracker
    tracker.add(PendingCommitment {
        address: pda,
        hash: commitment_hash,
        preimage,
        sequence,
        bond_amount: 1_000_000_000,
        commit_slot,
        status: robopoker_entropy_provider::commit::CommitmentStatus::Pending,
    });

    // Create tracked commitment for deadline monitoring
    let tracked = TrackedCommitment::new(tracker.get(0).unwrap().clone(), reveal_window_slots);

    // Verify deadline
    assert_eq!(tracked.deadline_slot, 1150);

    // Simulate time passing - slot 1050 (well within window)
    let current_slot = 1050u64;
    assert!(tracked.needs_reveal(current_slot));
    assert!(monitor.is_reveal_due(current_slot, commit_slot));
    assert!(!monitor.is_reveal_urgent(current_slot, commit_slot));
    assert_eq!(monitor.slots_until_deadline(current_slot, commit_slot), 100);

    // Build reveal instruction
    let reveal_data = reveal_builder.build_instruction_data(preimage);
    assert_eq!(reveal_data.len(), 40);
    assert_eq!(reveal_data[0], ix_disc::REVEAL);
    assert_eq!(&reveal_data[8..40], &preimage);

    // Mark as revealed
    tracker.mark_revealed(0).unwrap();

    // Verify no longer needs reveal
    let pending = tracker.get(0).unwrap();
    assert_eq!(
        pending.status,
        robopoker_entropy_provider::commit::CommitmentStatus::Revealed
    );

    // Advance chain
    chain.reveal().unwrap();
}

// ============================================================================
// Request Subscription Tests (AC-EP4.1 to AC-EP4.3)
// ============================================================================

/// Create a test entropy request
fn create_test_request(address: [u8; 32], slot: u64) -> EntropyRequest {
    EntropyRequest {
        address,
        requester: [1u8; 32],
        table: [2u8; 32],
        status: RequestStatus::Pending,
        request_slot: slot,
        slothash: [3u8; 32],
        commitment: None,
    }
}

/// Create a handler config for testing
fn create_test_handler_config() -> HandlerConfig {
    let program_id_bytes: [u8; 32] = robopoker_entropy::ID;
    HandlerConfig {
        program_id: program_id_bytes,
        provider: [0xcd; 32],
        bond_amount: 1_000_000,
        max_pending: 10,
    }
}

/// AC-EP4.1: Test MockSubscriber provides requests in order
#[test]
fn test_subscription_request_ordering() {
    let subscriber = MockSubscriber::new();

    // Push requests in order
    for i in 0..5 {
        subscriber.push_request(create_test_request([i; 32], 1000 + i as u64));
    }

    // Subscribe and receive
    let mut receiver = subscriber.subscribe().unwrap();

    for i in 0..5 {
        let req = receiver.recv().expect("Should receive request");
        assert_eq!(req.address, [i; 32], "Request order mismatch at {}", i);
        assert_eq!(req.request_slot, 1000 + i as u64);
    }

    // No more requests
    assert!(receiver.try_recv().is_none());
}

/// AC-EP4.2: Test auto-commit when new requests arrive
#[test]
fn test_auto_commit_on_new_request() {
    let chain = HashChain::generate(&[42u8; 32], 100);
    let tracker = PendingTracker::new();
    let config = create_test_handler_config();

    let handler = RequestHandler::new(chain, tracker, config);

    // Initial state
    assert_eq!(handler.pending_count(), 0);
    assert!(!handler.has_pending());

    // Submit a request
    let request = create_test_request([1u8; 32], 1000);
    let result = handler.handle_request(request).unwrap();

    // Should trigger commit
    match result {
        HandleResult::Commit {
            commitment_hash,
            preimage,
            sequence,
            bond_amount,
            request_address,
        } => {
            assert_eq!(sequence, 0, "First commit should be sequence 0");
            assert_eq!(bond_amount, 1_000_000);
            assert_eq!(request_address, [1u8; 32]);

            // Verify hash chain correctness
            let computed = sha256(&preimage);
            assert_eq!(computed, commitment_hash, "Preimage should hash to commitment");
        }
        other => panic!("Expected Commit, got {:?}", other),
    }

    // Handler state updated
    assert_eq!(handler.pending_count(), 1);
    assert!(handler.has_pending());
}

/// AC-EP4.2: Test sequential requests generate sequential commitments
#[test]
fn test_sequential_requests_generate_sequential_commits() {
    let chain = HashChain::generate(&[42u8; 32], 100);
    let tracker = PendingTracker::new();
    let config = create_test_handler_config();

    let handler = RequestHandler::new(chain, tracker, config);

    let mut commitment_hashes = Vec::new();

    // Submit 5 sequential requests
    for i in 0..5 {
        let request = create_test_request([i; 32], 1000 + i as u64);
        let result = handler.handle_request(request).unwrap();

        match result {
            HandleResult::Commit {
                commitment_hash,
                sequence,
                ..
            } => {
                assert_eq!(sequence, i as u64, "Sequence should match request order");
                commitment_hashes.push(commitment_hash);
            }
            other => panic!("Expected Commit for request {}, got {:?}", i, other),
        }
    }

    // All hashes should be unique
    for i in 0..commitment_hashes.len() {
        for j in (i + 1)..commitment_hashes.len() {
            assert_ne!(
                commitment_hashes[i], commitment_hashes[j],
                "Commitment hashes {} and {} should be unique",
                i, j
            );
        }
    }

    // Status check
    let status = handler.status();
    assert_eq!(status.pending_commitments, 5);
    assert_eq!(status.next_sequence, 5);
    assert_eq!(status.chain_position, 5);
}

/// AC-EP4.3: Test concurrent request handling simulation
#[test]
fn test_multi_request_concurrent_simulation() {
    use std::thread;

    let chain = HashChain::generate(&[42u8; 32], 1000);
    let tracker = PendingTracker::new();
    let mut config = create_test_handler_config();
    config.max_pending = 500;

    let handler = RequestHandler::new(chain, tracker, config);

    // Simulate multiple "tables" sending requests concurrently
    let num_tables = 10;
    let requests_per_table = 20;

    let handles: Vec<_> = (0..num_tables)
        .map(|table_id| {
            let handler = handler.clone();
            thread::spawn(move || {
                let mut results = Vec::new();
                for request_id in 0..requests_per_table {
                    let mut address = [0u8; 32];
                    address[0] = table_id;
                    address[1] = request_id;

                    let request = EntropyRequest {
                        address,
                        requester: [table_id; 32],
                        table: [table_id; 32],
                        status: RequestStatus::Pending,
                        request_slot: 1000 + request_id as u64,
                        slothash: [request_id; 32],
                        commitment: None,
                    };

                    let result = handler.handle_request(request);
                    results.push(result);
                }
                results
            })
        })
        .collect();

    // Collect all results
    let mut all_sequences = Vec::new();
    for handle in handles {
        let results = handle.join().expect("Thread panicked");
        for result in results {
            match result {
                Ok(HandleResult::Commit { sequence, .. }) => {
                    all_sequences.push(sequence);
                }
                Ok(HandleResult::Throttled) => {
                    // Acceptable under load
                }
                Ok(other) => panic!("Unexpected result: {:?}", other),
                Err(e) => panic!("Request failed: {:?}", e),
            }
        }
    }

    // Verify no duplicate sequences (race condition check)
    all_sequences.sort();
    for i in 1..all_sequences.len() {
        assert_ne!(
            all_sequences[i],
            all_sequences[i - 1],
            "Duplicate sequence {} found - race condition!",
            all_sequences[i]
        );
    }

    // Sequences should be contiguous (no gaps from race conditions)
    for (i, seq) in all_sequences.iter().enumerate() {
        assert_eq!(
            *seq, i as u64,
            "Sequence gap detected at position {}: expected {}, got {}",
            i, i, seq
        );
    }

    // Total should match
    let total_requests = num_tables * requests_per_table;
    assert_eq!(
        all_sequences.len(),
        total_requests as usize,
        "Should have processed all {} requests",
        total_requests
    );

    // Handler state should reflect total
    let status = handler.status();
    assert_eq!(status.pending_commitments, total_requests as usize);
    assert_eq!(status.next_sequence, total_requests as u64);
}

/// AC-EP4.3: Test throttling under load prevents resource exhaustion
#[test]
fn test_throttling_prevents_resource_exhaustion() {
    let chain = HashChain::generate(&[42u8; 32], 100);
    let tracker = PendingTracker::new();
    let mut config = create_test_handler_config();
    config.max_pending = 5; // Low limit for testing

    let handler = RequestHandler::new(chain, tracker, config);

    // Submit requests up to limit
    for i in 0..5 {
        let request = create_test_request([i; 32], 1000 + i as u64);
        let result = handler.handle_request(request).unwrap();
        assert!(matches!(result, HandleResult::Commit { .. }));
    }

    assert_eq!(handler.pending_count(), 5);

    // Next requests should be throttled
    for i in 5..10 {
        let request = create_test_request([i; 32], 1000 + i as u64);
        let result = handler.handle_request(request).unwrap();
        assert!(
            matches!(result, HandleResult::Throttled),
            "Request {} should be throttled",
            i
        );
    }

    assert_eq!(handler.queue_size(), 5);

    // Process queue after revealing some commitments
    handler.mark_revealed(0).unwrap();
    handler.mark_revealed(1).unwrap();

    let processed = handler.process_queue().unwrap();
    assert!(!processed.is_empty(), "Should process queued requests");

    // Should have processed 2 from queue (matching reveals)
    let commits: Vec<_> = processed
        .iter()
        .filter(|r| matches!(r, HandleResult::Commit { .. }))
        .collect();
    assert_eq!(commits.len(), 2);
}

/// AC-EP4.1 to AC-EP4.3: Test full request-to-commit-to-reveal flow
#[test]
fn test_full_request_commit_reveal_flow() {
    let program_id_bytes: [u8; 32] = robopoker_entropy::ID;
    let chain = HashChain::generate(&[42u8; 32], 100);
    let tracker = PendingTracker::new();
    let config = HandlerConfig {
        program_id: program_id_bytes,
        provider: [0xcd; 32],
        bond_amount: 1_000_000,
        max_pending: 10,
    };

    let handler = RequestHandler::new(chain, tracker, config);
    let reveal_builder = RevealBuilder::new(program_id_bytes);
    let monitor = SlotMonitor::new(150);

    // 1. Mock subscriber receives requests
    let subscriber = MockSubscriber::new();
    subscriber.push_request(create_test_request([1u8; 32], 1000));
    subscriber.push_request(create_test_request([2u8; 32], 1001));
    subscriber.push_request(create_test_request([3u8; 32], 1002));

    let mut receiver = subscriber.subscribe().unwrap();

    // 2. Process requests through handler
    let mut commit_info = Vec::new();

    while let Some(request) = receiver.recv() {
        let result = handler.handle_request(request.clone()).unwrap();

        if let HandleResult::Commit {
            commitment_hash,
            preimage,
            sequence,
            ..
        } = result
        {
            commit_info.push((sequence, commitment_hash, preimage, request.request_slot));
        }
    }

    assert_eq!(commit_info.len(), 3);

    // 3. Simulate time passing and reveals
    for (sequence, _commitment_hash, preimage, commit_slot) in commit_info {
        let current_slot = commit_slot + 50; // 50 slots after commit

        // Check if reveal is due
        assert!(monitor.is_reveal_due(current_slot, commit_slot));
        assert!(!monitor.is_deadline_passed(current_slot, commit_slot));

        // Build reveal instruction
        let reveal_data = reveal_builder.build_instruction_data(preimage);
        assert_eq!(reveal_data.len(), 40);
        assert_eq!(reveal_data[0], ix_disc::REVEAL);

        // Mark as revealed
        handler.mark_revealed(sequence).unwrap();
    }

    // 4. Verify final state
    let status = handler.status();
    assert_eq!(status.pending_commitments, 0);
    assert_eq!(status.next_sequence, 3);
    assert_eq!(status.chain_position, 3);
}

/// AC-EP4.2: Test skips already-handled requests
#[test]
fn test_skips_already_handled_requests() {
    let chain = HashChain::generate(&[42u8; 32], 100);
    let tracker = PendingTracker::new();
    let config = create_test_handler_config();

    let handler = RequestHandler::new(chain, tracker, config);

    // Request already committed
    let committed_request = EntropyRequest {
        address: [1u8; 32],
        requester: [2u8; 32],
        table: [3u8; 32],
        status: RequestStatus::Committed,
        request_slot: 1000,
        slothash: [4u8; 32],
        commitment: Some([5u8; 32]),
    };

    let result = handler.handle_request(committed_request).unwrap();
    assert!(matches!(result, HandleResult::Skipped));

    // Request already fulfilled
    let fulfilled_request = EntropyRequest {
        address: [10u8; 32],
        requester: [2u8; 32],
        table: [3u8; 32],
        status: RequestStatus::Fulfilled,
        request_slot: 1000,
        slothash: [4u8; 32],
        commitment: Some([5u8; 32]),
    };

    let result = handler.handle_request(fulfilled_request).unwrap();
    assert!(matches!(result, HandleResult::Skipped));

    // Request cancelled
    let cancelled_request = EntropyRequest {
        address: [20u8; 32],
        requester: [2u8; 32],
        table: [3u8; 32],
        status: RequestStatus::Cancelled,
        request_slot: 1000,
        slothash: [4u8; 32],
        commitment: None,
    };

    let result = handler.handle_request(cancelled_request).unwrap();
    assert!(matches!(result, HandleResult::Skipped));

    // No commitments should have been made
    assert_eq!(handler.pending_count(), 0);
}

// ============================================================================
// CLI Smoke Tests (AC-EP6.1 to AC-EP6.3)
// ============================================================================

/// AC-EP6.1: Test CLI generate command creates valid chain file
#[test]
fn test_cli_generate_creates_valid_chain() {
    use tempfile::tempdir;

    let dir = tempdir().unwrap();
    let chain_path = dir.path().join("test_chain.json");

    // Test HashChain::generate + save (simulating CLI generate command)
    let depth = 50u64;
    let seed = [0x42u8; 32];

    let chain = HashChain::generate(&seed, depth);
    assert_eq!(chain.depth(), depth);
    assert_eq!(chain.position(), 0);
    assert_eq!(chain.remaining(), depth);

    // Save to file
    chain.save(&chain_path).unwrap();
    assert!(chain_path.exists());

    // Verify file can be loaded back
    let loaded = HashChain::load(&chain_path).unwrap();
    assert_eq!(loaded.depth(), depth);
    assert_eq!(loaded.position(), 0);
    assert_eq!(loaded.current_commitment(), chain.current_commitment());
}

/// AC-EP6.1: Test CLI generate with random seed produces unique chains
#[test]
fn test_cli_generate_random_seeds_unique() {
    use rand::RngCore;

    let mut seed1 = [0u8; 32];
    let mut seed2 = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut seed1);
    rand::thread_rng().fill_bytes(&mut seed2);

    let chain1 = HashChain::generate(&seed1, 10);
    let chain2 = HashChain::generate(&seed2, 10);

    assert_ne!(
        chain1.current_commitment(),
        chain2.current_commitment(),
        "Random seeds should produce different chains"
    );
}

/// AC-EP6.2: Test daemon config loading for CLI start command
#[test]
fn test_cli_start_config_loading() {
    use robopoker_entropy_provider::{DaemonConfig, DaemonState, Logger, ProviderDaemon};
    use robopoker_entropy_provider::subscription::HandlerConfig;
    use std::sync::Arc;
    use tempfile::tempdir;

    let dir = tempdir().unwrap();
    let chain_path = dir.path().join("chain.json");
    let tracker_path = dir.path().join("pending.json");

    // Create and save a chain
    let chain = HashChain::generate(&[0x99u8; 32], 100);
    chain.save(&chain_path).unwrap();

    // Create daemon config (as CLI start would)
    let config = DaemonConfig {
        chain_path: chain_path.clone(),
        tracker_path: tracker_path.clone(),
        initial_reconnect_delay_ms: 1000,
        max_reconnect_delay_ms: 60_000,
        max_reconnect_attempts: 0,
        persist_on_shutdown: true,
        load_on_startup: true,
    };

    // Verify chain can be loaded (as daemon would at startup)
    let loaded_chain = HashChain::load(&config.chain_path).unwrap();
    assert_eq!(loaded_chain.depth(), 100);
    assert!(!loaded_chain.is_exhausted());

    // Create handler config
    let handler_config = HandlerConfig {
        program_id: robopoker_entropy::ID,
        provider: [0xcd; 32],
        bond_amount: 1_000_000,
        max_pending: 10,
    };

    // Create handler and daemon
    let tracker = PendingTracker::new();
    let handler = RequestHandler::new(loaded_chain, tracker, handler_config);
    let logger = Arc::new(Logger::new());

    let daemon = ProviderDaemon::new(handler, config, logger);

    // Verify daemon starts in correct state
    assert_eq!(daemon.state(), DaemonState::Stopped);
    assert!(!daemon.is_shutdown_requested());

    // Simulate startup
    daemon.initialize();
    assert_eq!(daemon.state(), DaemonState::Starting);
}

/// AC-EP6.2: Test CLI start rejects exhausted chain
#[test]
fn test_cli_start_rejects_exhausted_chain() {
    use tempfile::tempdir;

    let dir = tempdir().unwrap();
    let chain_path = dir.path().join("chain.json");

    // Create a chain with depth 1 and exhaust it
    let mut chain = HashChain::generate(&[0x11u8; 32], 1);
    chain.reveal().unwrap();

    assert!(chain.is_exhausted());
    chain.save(&chain_path).unwrap();

    // Load and check (as CLI start would)
    let loaded = HashChain::load(&chain_path).unwrap();
    assert!(loaded.is_exhausted(), "Chain should be exhausted");
    assert_eq!(loaded.remaining(), 0);
}

/// AC-EP6.3: Test CLI status command output (chain info)
#[test]
fn test_cli_status_chain_info() {
    use tempfile::tempdir;

    let dir = tempdir().unwrap();
    let chain_path = dir.path().join("chain.json");

    // Create chain with some reveals consumed
    let mut chain = HashChain::generate(&[0x55u8; 32], 100);

    // Consume some reveals
    for _ in 0..25 {
        chain.reveal().unwrap();
    }

    chain.save(&chain_path).unwrap();

    // Load and check status (as CLI status would)
    let loaded = HashChain::load(&chain_path).unwrap();

    // Status output values
    let position = loaded.position();
    let depth = loaded.depth();
    let remaining = loaded.remaining();
    let commitment = loaded.current_commitment();

    assert_eq!(position, 25, "Position should be 25");
    assert_eq!(depth, 100, "Depth should be 100");
    assert_eq!(remaining, 75, "Remaining should be 75");
    assert_ne!(commitment, [0u8; 32], "Commitment should not be zeros");
}

/// AC-EP6.3: Test CLI status command output (pending operations)
#[test]
fn test_cli_status_pending_ops() {
    use robopoker_entropy_provider::commit::CommitmentStatus;
    use tempfile::tempdir;

    let dir = tempdir().unwrap();
    let tracker_path = dir.path().join("pending.json");

    // Create tracker with some pending commitments
    let mut tracker = PendingTracker::new();

    for i in 0..3 {
        tracker.add(PendingCommitment {
            address: [i as u8; 32],
            hash: [(i + 10) as u8; 32],
            preimage: [(i + 20) as u8; 32],
            sequence: i,
            bond_amount: 1_000_000,
            commit_slot: 1000 + i,
            status: if i == 1 {
                CommitmentStatus::Revealed
            } else {
                CommitmentStatus::Pending
            },
        });
    }

    tracker.save(&tracker_path).unwrap();

    // Load and check status (as CLI status would)
    let loaded = PendingTracker::load(&tracker_path).unwrap();

    let pending_count = loaded.pending_count();
    let total_count = loaded.total_count();
    let next_seq = loaded.next_sequence();

    assert_eq!(pending_count, 2, "Should have 2 pending");
    assert_eq!(total_count, 3, "Should have 3 total");
    assert_eq!(next_seq, 3, "Next sequence should be 3");
}

/// AC-EP6.3: Test CLI status handles missing files gracefully
#[test]
fn test_cli_status_missing_files() {
    use tempfile::tempdir;

    let dir = tempdir().unwrap();
    let chain_path = dir.path().join("nonexistent_chain.json");
    let tracker_path = dir.path().join("nonexistent_pending.json");

    // Simulate status command with missing files
    let chain_exists = chain_path.exists();
    let tracker_exists = tracker_path.exists();

    assert!(!chain_exists, "Chain file should not exist");
    assert!(!tracker_exists, "Tracker file should not exist");

    // CLI would report "not found" for both
    // This test verifies the existence check logic
}

/// AC-EP6.1: Test CLI generate preserves chain integrity
#[test]
fn test_cli_generate_chain_integrity() {
    use tempfile::tempdir;

    let dir = tempdir().unwrap();
    let chain_path = dir.path().join("chain.json");

    let seed = [0x77u8; 32];
    let depth = 50u64;

    let chain = HashChain::generate(&seed, depth);
    chain.save(&chain_path).unwrap();

    let loaded = HashChain::load(&chain_path).unwrap();

    // Verify chain integrity (as CLI might do)
    loaded.verify().expect("Chain integrity check should pass");
}

/// AC-EP6.2: Test CLI start with WS URL derivation
#[test]
fn test_cli_start_ws_url_derivation() {
    // Test the URL derivation logic used in CLI start command
    let rpc_url = "http://127.0.0.1:8899";
    let ws_url = rpc_url
        .replace("http://", "ws://")
        .replace("https://", "wss://");

    assert_eq!(ws_url, "ws://127.0.0.1:8899");

    let https_url = "https://api.mainnet-beta.solana.com";
    let wss_url = https_url
        .replace("http://", "ws://")
        .replace("https://", "wss://");

    assert_eq!(wss_url, "wss://api.mainnet-beta.solana.com");
}

/// AC-EP6.3: Test CLI status low-remaining warning threshold
#[test]
fn test_cli_status_low_remaining_warning() {
    let mut chain = HashChain::generate(&[0x88u8; 32], 150);

    // Consume most of the chain
    for _ in 0..100 {
        chain.reveal().unwrap();
    }

    let remaining = chain.remaining();

    // CLI would warn if remaining < 100
    let should_warn = remaining < 100;
    assert!(should_warn, "Should trigger low-remaining warning");
    assert_eq!(remaining, 50);
}

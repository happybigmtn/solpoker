//! Commit flow for the entropy provider.
//!
//! This module provides:
//! - Commitment PDA derivation (AC-EP2.1)
//! - Commit instruction building (AC-EP2.1)
//! - Pending commitment tracking (AC-EP2.3)
//!
//! # Example
//! ```ignore
//! use robopoker_entropy_provider::{HashChain, commit::{CommitBuilder, PendingTracker}};
//!
//! let chain = HashChain::generate(&[1u8; 32], 100);
//! let builder = CommitBuilder::new(entropy_program_id);
//! let ix_data = builder.build_instruction_data(
//!     chain.current_commitment(),
//!     0, // sequence
//!     1_000_000_000, // bond amount (1 SOL)
//! );
//! ```

use crate::error::{ProviderError, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

/// Entropy instruction discriminators (mirror of on-chain program)
pub mod discriminator {
    pub const INITIALIZE: u8 = 0;
    pub const COMMIT: u8 = 1;
    pub const REVEAL: u8 = 2;
    pub const REQUEST: u8 = 3;
    pub const FINALIZE: u8 = 4;
    pub const SLASH: u8 = 5;
    pub const UPDATE_CONFIG: u8 = 6;
}

/// Size of commitment instruction data
pub const COMMIT_IX_SIZE: usize = 56; // discriminator(1) + padding(7) + hash(32) + sequence(8) + bond_amount(8)

/// Build commitment PDA address.
///
/// Derives the PDA for a commitment account: `[b"commitment", provider, sequence.to_le_bytes()]`
///
/// # Arguments
/// * `program_id` - The entropy program ID
/// * `provider` - The provider's public key
/// * `sequence` - The sequence number for this commitment
///
/// # Returns
/// A tuple of (PDA address, bump seed)
pub fn derive_commitment_pda(
    program_id: &[u8; 32],
    provider: &[u8; 32],
    sequence: u64,
) -> ([u8; 32], u8) {
    let sequence_bytes = sequence.to_le_bytes();
    find_program_address(
        &[b"commitment", provider.as_slice(), sequence_bytes.as_slice()],
        program_id,
    )
}

/// Build config PDA address.
///
/// Derives the PDA for the config account: `[b"config"]`
pub fn derive_config_pda(program_id: &[u8; 32]) -> ([u8; 32], u8) {
    find_program_address(&[b"config"], program_id)
}

/// Compute SHA256 hash of data.
#[inline]
pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}

/// Find program address (PDA derivation).
///
/// This is a pure Rust implementation of Solana's `find_program_address`.
fn find_program_address(seeds: &[&[u8]], program_id: &[u8; 32]) -> ([u8; 32], u8) {
    for bump in (0..=255u8).rev() {
        if let Some(address) = try_find_program_address(seeds, program_id, bump) {
            return (address, bump);
        }
    }
    // This should never happen in practice
    ([0u8; 32], 0)
}

/// Try to derive a PDA with a specific bump seed.
fn try_find_program_address(seeds: &[&[u8]], program_id: &[u8; 32], bump: u8) -> Option<[u8; 32]> {
    let mut hasher = Sha256::new();
    for seed in seeds {
        hasher.update(seed);
    }
    hasher.update([bump]);
    hasher.update(program_id);
    hasher.update(b"ProgramDerivedAddress");

    let hash: [u8; 32] = hasher.finalize().into();

    // Check if the point is on the ed25519 curve
    // A point is off-curve (valid PDA) if it fails to decompress
    if is_on_curve(&hash) {
        None
    } else {
        Some(hash)
    }
}

/// Check if a 32-byte value represents a point on the ed25519 curve.
///
/// A valid PDA must NOT be on the curve.
fn is_on_curve(bytes: &[u8; 32]) -> bool {
    // Use curve25519-dalek for proper ed25519 point decompression
    use curve25519_dalek::edwards::CompressedEdwardsY;
    let compressed = CompressedEdwardsY::from_slice(bytes);
    match compressed {
        Ok(point) => point.decompress().is_some(),
        Err(_) => false,
    }
}

/// Builder for commit instructions (AC-EP2.1).
///
/// Constructs the instruction data for posting a commitment on-chain.
#[derive(Debug, Clone)]
pub struct CommitBuilder {
    /// The entropy program ID
    pub program_id: [u8; 32],
}

impl CommitBuilder {
    /// Create a new commit builder.
    pub fn new(program_id: [u8; 32]) -> Self {
        Self { program_id }
    }

    /// Build the instruction data for a commit transaction.
    ///
    /// # Arguments
    /// * `commitment_hash` - The commitment hash (SHA256 of preimage)
    /// * `sequence` - Sequence number in the provider's chain
    /// * `bond_amount` - Bond amount in lamports
    ///
    /// # Returns
    /// The serialized instruction data
    pub fn build_instruction_data(
        &self,
        commitment_hash: [u8; 32],
        sequence: u64,
        bond_amount: u64,
    ) -> Vec<u8> {
        let mut data = vec![0u8; COMMIT_IX_SIZE];
        data[0] = discriminator::COMMIT;
        // bytes 1-7 are padding (zeroed)
        data[8..40].copy_from_slice(&commitment_hash);
        data[40..48].copy_from_slice(&sequence.to_le_bytes());
        data[48..56].copy_from_slice(&bond_amount.to_le_bytes());
        data
    }

    /// Derive the commitment PDA for a given provider and sequence.
    pub fn derive_pda(&self, provider: &[u8; 32], sequence: u64) -> ([u8; 32], u8) {
        derive_commitment_pda(&self.program_id, provider, sequence)
    }

    /// Derive the config PDA.
    pub fn derive_config_pda(&self) -> ([u8; 32], u8) {
        derive_config_pda(&self.program_id)
    }
}

/// Status of a pending commitment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CommitmentStatus {
    /// Commitment posted, awaiting reveal
    Pending,
    /// Commitment has been revealed
    Revealed,
    /// Commitment was slashed (missed deadline)
    Slashed,
}

/// A pending commitment record (AC-EP2.3).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingCommitment {
    /// The commitment PDA address
    pub address: [u8; 32],
    /// The commitment hash
    pub hash: [u8; 32],
    /// The preimage (for reveal)
    pub preimage: [u8; 32],
    /// Sequence number
    pub sequence: u64,
    /// Bond amount locked
    pub bond_amount: u64,
    /// Slot when commitment was posted
    pub commit_slot: u64,
    /// Current status
    pub status: CommitmentStatus,
}

/// Tracks pending commitments awaiting reveal (AC-EP2.3).
///
/// Provides persistence and lookup for commitments that have been posted
/// but not yet revealed. This enables the provider to resume operations
/// after restart.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PendingTracker {
    /// Version for forward compatibility
    version: u32,
    /// Pending commitments indexed by sequence number
    commitments: BTreeMap<u64, PendingCommitment>,
    /// Next sequence number to use
    next_sequence: u64,
}

impl PendingTracker {
    /// Current tracker version
    const VERSION: u32 = 1;

    /// Create a new empty tracker.
    pub fn new() -> Self {
        Self {
            version: Self::VERSION,
            commitments: BTreeMap::new(),
            next_sequence: 0,
        }
    }

    /// Add a new pending commitment.
    ///
    /// # Arguments
    /// * `commitment` - The pending commitment to track
    pub fn add(&mut self, commitment: PendingCommitment) {
        let seq = commitment.sequence;
        self.commitments.insert(seq, commitment);
        // Update next_sequence if needed
        if seq >= self.next_sequence {
            self.next_sequence = seq + 1;
        }
    }

    /// Get the next sequence number to use.
    pub fn next_sequence(&self) -> u64 {
        self.next_sequence
    }

    /// Get a pending commitment by sequence number.
    pub fn get(&self, sequence: u64) -> Option<&PendingCommitment> {
        self.commitments.get(&sequence)
    }

    /// Get a mutable reference to a pending commitment.
    pub fn get_mut(&mut self, sequence: u64) -> Option<&mut PendingCommitment> {
        self.commitments.get_mut(&sequence)
    }

    /// Mark a commitment as revealed.
    pub fn mark_revealed(&mut self, sequence: u64) -> Result<()> {
        let commitment = self
            .commitments
            .get_mut(&sequence)
            .ok_or(ProviderError::CommitmentNotFound(sequence))?;
        commitment.status = CommitmentStatus::Revealed;
        Ok(())
    }

    /// Mark a commitment as slashed.
    pub fn mark_slashed(&mut self, sequence: u64) -> Result<()> {
        let commitment = self
            .commitments
            .get_mut(&sequence)
            .ok_or(ProviderError::CommitmentNotFound(sequence))?;
        commitment.status = CommitmentStatus::Slashed;
        Ok(())
    }

    /// Remove a commitment from tracking.
    pub fn remove(&mut self, sequence: u64) -> Option<PendingCommitment> {
        self.commitments.remove(&sequence)
    }

    /// Get all pending commitments (status == Pending).
    pub fn pending_commitments(&self) -> impl Iterator<Item = &PendingCommitment> {
        self.commitments
            .values()
            .filter(|c| c.status == CommitmentStatus::Pending)
    }

    /// Count of pending commitments.
    pub fn pending_count(&self) -> usize {
        self.commitments
            .values()
            .filter(|c| c.status == CommitmentStatus::Pending)
            .count()
    }

    /// Total count of tracked commitments.
    pub fn total_count(&self) -> usize {
        self.commitments.len()
    }

    /// Check if there are any pending commitments.
    pub fn has_pending(&self) -> bool {
        self.pending_count() > 0
    }

    /// Save the tracker to a file.
    pub fn save<P: AsRef<std::path::Path>>(&self, path: P) -> Result<()> {
        let file = std::fs::File::create(path)?;
        let writer = std::io::BufWriter::new(file);
        serde_json::to_writer_pretty(writer, self)?;
        Ok(())
    }

    /// Load the tracker from a file.
    pub fn load<P: AsRef<std::path::Path>>(path: P) -> Result<Self> {
        let file = std::fs::File::open(path)?;
        let reader = std::io::BufReader::new(file);
        let tracker: Self = serde_json::from_reader(reader)?;

        if tracker.version != Self::VERSION {
            return Err(ProviderError::IncompatibleVersion {
                found: tracker.version,
                expected: Self::VERSION,
            });
        }

        Ok(tracker)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    // Test program ID for entropy program
    const TEST_PROGRAM_ID: [u8; 32] = [
        0xdc, 0x9b, 0x5a, 0x54, 0x5e, 0x4b, 0x3f, 0x6c, 0x2a, 0x1d, 0x8e, 0x7f, 0x5b, 0x4a, 0x3c,
        0x2d, 0x1e, 0x0f, 0x9a, 0x8b, 0x7c, 0x6d, 0x5e, 0x4f, 0x3a, 0x2b, 0x1c, 0x0d, 0x9e, 0x8f,
        0x7a, 0x6b,
    ];

    const TEST_PROVIDER: [u8; 32] = [
        0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
        0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e,
        0x1f, 0x20,
    ];

    /// AC-EP2.1: Commitment PDA derivation
    #[test]
    fn test_derive_commitment_pda() {
        let (pda, bump) = derive_commitment_pda(&TEST_PROGRAM_ID, &TEST_PROVIDER, 0);

        // PDA should be deterministic
        let (pda2, bump2) = derive_commitment_pda(&TEST_PROGRAM_ID, &TEST_PROVIDER, 0);
        assert_eq!(pda, pda2);
        assert_eq!(bump, bump2);

        // Different sequence should give different PDA
        let (pda3, _) = derive_commitment_pda(&TEST_PROGRAM_ID, &TEST_PROVIDER, 1);
        assert_ne!(pda, pda3);

        // Different provider should give different PDA
        let other_provider = [0xffu8; 32];
        let (pda4, _) = derive_commitment_pda(&TEST_PROGRAM_ID, &other_provider, 0);
        assert_ne!(pda, pda4);
    }

    /// AC-EP2.1: Commit instruction data building
    #[test]
    fn test_build_instruction_data() {
        let builder = CommitBuilder::new(TEST_PROGRAM_ID);
        let commitment_hash = [0xabu8; 32];
        let sequence = 42u64;
        let bond_amount = 1_000_000_000u64;

        let data = builder.build_instruction_data(commitment_hash, sequence, bond_amount);

        assert_eq!(data.len(), COMMIT_IX_SIZE);
        assert_eq!(data[0], discriminator::COMMIT);
        assert_eq!(&data[8..40], &commitment_hash);
        assert_eq!(&data[40..48], &sequence.to_le_bytes());
        assert_eq!(&data[48..56], &bond_amount.to_le_bytes());
    }

    /// AC-EP2.3: Pending commitment tracking
    #[test]
    fn test_pending_tracker_add_and_get() {
        let mut tracker = PendingTracker::new();
        assert_eq!(tracker.next_sequence(), 0);
        assert!(!tracker.has_pending());

        let commitment = PendingCommitment {
            address: [1u8; 32],
            hash: [2u8; 32],
            preimage: [3u8; 32],
            sequence: 0,
            bond_amount: 1_000_000_000,
            commit_slot: 100,
            status: CommitmentStatus::Pending,
        };

        tracker.add(commitment.clone());

        assert_eq!(tracker.next_sequence(), 1);
        assert!(tracker.has_pending());
        assert_eq!(tracker.pending_count(), 1);

        let retrieved = tracker.get(0).unwrap();
        assert_eq!(retrieved.hash, commitment.hash);
        assert_eq!(retrieved.preimage, commitment.preimage);
    }

    /// AC-EP2.3: Pending tracker status transitions
    #[test]
    fn test_pending_tracker_status_transitions() {
        let mut tracker = PendingTracker::new();

        let commitment = PendingCommitment {
            address: [1u8; 32],
            hash: [2u8; 32],
            preimage: [3u8; 32],
            sequence: 0,
            bond_amount: 1_000_000_000,
            commit_slot: 100,
            status: CommitmentStatus::Pending,
        };
        tracker.add(commitment);

        assert_eq!(tracker.pending_count(), 1);

        // Mark as revealed
        tracker.mark_revealed(0).unwrap();
        assert_eq!(tracker.pending_count(), 0);
        assert_eq!(tracker.get(0).unwrap().status, CommitmentStatus::Revealed);
    }

    /// AC-EP2.3: Pending tracker persistence
    #[test]
    fn test_pending_tracker_save_load() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("pending.json");

        let mut tracker = PendingTracker::new();
        tracker.add(PendingCommitment {
            address: [1u8; 32],
            hash: [2u8; 32],
            preimage: [3u8; 32],
            sequence: 0,
            bond_amount: 1_000_000_000,
            commit_slot: 100,
            status: CommitmentStatus::Pending,
        });
        tracker.add(PendingCommitment {
            address: [4u8; 32],
            hash: [5u8; 32],
            preimage: [6u8; 32],
            sequence: 1,
            bond_amount: 2_000_000_000,
            commit_slot: 200,
            status: CommitmentStatus::Revealed,
        });

        tracker.save(&path).unwrap();

        let loaded = PendingTracker::load(&path).unwrap();
        assert_eq!(loaded.next_sequence(), 2);
        assert_eq!(loaded.total_count(), 2);
        assert_eq!(loaded.pending_count(), 1);
    }

    /// AC-EP2.3: Pending tracker handles multiple commitments
    #[test]
    fn test_pending_tracker_multiple_commitments() {
        let mut tracker = PendingTracker::new();

        for i in 0..5 {
            tracker.add(PendingCommitment {
                address: [i as u8; 32],
                hash: [(i + 10) as u8; 32],
                preimage: [(i + 20) as u8; 32],
                sequence: i,
                bond_amount: 1_000_000_000 * (i + 1),
                commit_slot: 100 * (i + 1),
                status: CommitmentStatus::Pending,
            });
        }

        assert_eq!(tracker.pending_count(), 5);
        assert_eq!(tracker.next_sequence(), 5);

        // Mark some as revealed
        tracker.mark_revealed(1).unwrap();
        tracker.mark_revealed(3).unwrap();
        assert_eq!(tracker.pending_count(), 3);

        // Iterate over pending
        let pending: Vec<_> = tracker.pending_commitments().collect();
        assert_eq!(pending.len(), 3);
        assert!(pending.iter().all(|c| c.status == CommitmentStatus::Pending));
    }

    /// AC-EP2.3: Error on non-existent commitment
    #[test]
    fn test_pending_tracker_not_found() {
        let mut tracker = PendingTracker::new();
        let result = tracker.mark_revealed(999);
        assert!(matches!(result, Err(ProviderError::CommitmentNotFound(999))));
    }

    /// Test config PDA derivation
    #[test]
    fn test_derive_config_pda() {
        let (pda, bump) = derive_config_pda(&TEST_PROGRAM_ID);

        // Should be deterministic
        let (pda2, bump2) = derive_config_pda(&TEST_PROGRAM_ID);
        assert_eq!(pda, pda2);
        assert_eq!(bump, bump2);

        // Bump should be non-zero (we always find a valid PDA)
        assert!(bump > 0 || pda != [0u8; 32]);
    }
}

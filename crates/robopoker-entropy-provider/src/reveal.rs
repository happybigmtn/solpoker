//! Reveal flow for the entropy provider.
//!
//! This module provides:
//! - Slot monitoring to detect when reveals are due (AC-EP3.1)
//! - Reveal instruction building (AC-EP3.2)
//! - Deadline tracking to avoid slashing (AC-EP3.3)
//! - Randomness derivation (AC-EP3.4)
//!
//! # Example
//! ```ignore
//! use robopoker_entropy_provider::{HashChain, reveal::{RevealBuilder, SlotMonitor}};
//!
//! let builder = RevealBuilder::new(entropy_program_id);
//! let preimage = chain.reveal().unwrap();
//! let ix_data = builder.build_instruction_data(preimage);
//!
//! // Check deadline
//! let monitor = SlotMonitor::new(150); // 150 slot reveal window
//! if monitor.is_reveal_due(current_slot, commit_slot) {
//!     // Send reveal transaction
//! }
//! ```

use crate::commit::{sha256, PendingCommitment};
use crate::error::{ProviderError, Result};

/// Reveal instruction discriminator (mirrors on-chain program)
pub const REVEAL_DISCRIMINATOR: u8 = 2;

/// Size of reveal instruction data: discriminator(1) + padding(7) + preimage(32) = 40
pub const REVEAL_IX_SIZE: usize = 40;

/// Builder for reveal instructions (AC-EP3.2).
///
/// Constructs the instruction data for revealing a preimage on-chain.
#[derive(Debug, Clone)]
pub struct RevealBuilder {
    /// The entropy program ID
    pub program_id: [u8; 32],
}

impl RevealBuilder {
    /// Create a new reveal builder.
    pub fn new(program_id: [u8; 32]) -> Self {
        Self { program_id }
    }

    /// Build the instruction data for a reveal transaction.
    ///
    /// # Arguments
    /// * `preimage` - The 32-byte preimage that hashes to the commitment
    ///
    /// # Returns
    /// The serialized instruction data
    pub fn build_instruction_data(&self, preimage: [u8; 32]) -> Vec<u8> {
        let mut data = vec![0u8; REVEAL_IX_SIZE];
        data[0] = REVEAL_DISCRIMINATOR;
        // bytes 1-7 are padding (zeroed)
        data[8..40].copy_from_slice(&preimage);
        data
    }
}

/// Slot monitor for tracking reveal deadlines (AC-EP3.1, AC-EP3.3).
///
/// Helps determine when reveals are due and whether they risk slashing.
#[derive(Debug, Clone, Copy)]
pub struct SlotMonitor {
    /// The reveal window in slots (from config)
    pub reveal_window_slots: u64,
    /// Safety margin in slots (reveal this many slots before deadline)
    pub safety_margin_slots: u64,
}

impl SlotMonitor {
    /// Create a new slot monitor.
    ///
    /// # Arguments
    /// * `reveal_window_slots` - Number of slots in the reveal window
    pub fn new(reveal_window_slots: u64) -> Self {
        Self {
            reveal_window_slots,
            // Default safety margin: 10% of window or minimum 5 slots
            safety_margin_slots: (reveal_window_slots / 10).max(5),
        }
    }

    /// Create a slot monitor with a custom safety margin.
    pub fn with_safety_margin(reveal_window_slots: u64, safety_margin_slots: u64) -> Self {
        Self {
            reveal_window_slots,
            safety_margin_slots,
        }
    }

    /// Calculate the deadline slot for a commitment.
    ///
    /// # Arguments
    /// * `commit_slot` - The slot when the commitment was posted
    ///
    /// # Returns
    /// The deadline slot after which the provider can be slashed
    pub fn deadline_slot(&self, commit_slot: u64) -> u64 {
        commit_slot.saturating_add(self.reveal_window_slots)
    }

    /// Calculate the safe reveal slot (with safety margin).
    ///
    /// # Arguments
    /// * `commit_slot` - The slot when the commitment was posted
    ///
    /// # Returns
    /// The slot by which the provider should reveal to have safety margin
    pub fn safe_reveal_deadline(&self, commit_slot: u64) -> u64 {
        self.deadline_slot(commit_slot)
            .saturating_sub(self.safety_margin_slots)
    }

    /// Check if a reveal is due (past the commit slot and not yet at deadline).
    ///
    /// # Arguments
    /// * `current_slot` - The current blockchain slot
    /// * `commit_slot` - The slot when the commitment was posted
    ///
    /// # Returns
    /// true if a reveal should be sent now
    pub fn is_reveal_due(&self, current_slot: u64, commit_slot: u64) -> bool {
        // Must be past the commit slot
        if current_slot <= commit_slot {
            return false;
        }

        // Must not be past the deadline
        let deadline = self.deadline_slot(commit_slot);
        current_slot < deadline
    }

    /// Check if a reveal is urgent (approaching deadline).
    ///
    /// # Arguments
    /// * `current_slot` - The current blockchain slot
    /// * `commit_slot` - The slot when the commitment was posted
    ///
    /// # Returns
    /// true if the reveal is within the safety margin
    pub fn is_reveal_urgent(&self, current_slot: u64, commit_slot: u64) -> bool {
        let safe_deadline = self.safe_reveal_deadline(commit_slot);
        let deadline = self.deadline_slot(commit_slot);

        current_slot >= safe_deadline && current_slot < deadline
    }

    /// Check if the deadline has passed (too late to reveal, slashing possible).
    ///
    /// # Arguments
    /// * `current_slot` - The current blockchain slot
    /// * `commit_slot` - The slot when the commitment was posted
    ///
    /// # Returns
    /// true if the deadline has passed
    pub fn is_deadline_passed(&self, current_slot: u64, commit_slot: u64) -> bool {
        current_slot >= self.deadline_slot(commit_slot)
    }

    /// Get the remaining slots until deadline.
    ///
    /// # Arguments
    /// * `current_slot` - The current blockchain slot
    /// * `commit_slot` - The slot when the commitment was posted
    ///
    /// # Returns
    /// Number of slots remaining, or 0 if deadline passed
    pub fn slots_until_deadline(&self, current_slot: u64, commit_slot: u64) -> u64 {
        let deadline = self.deadline_slot(commit_slot);
        deadline.saturating_sub(current_slot)
    }
}

/// Derive randomness from preimage and slothash (AC-EP3.4).
///
/// This matches the on-chain `derive_randomness` function:
/// `randomness = preimage XOR slothash`
///
/// # Arguments
/// * `preimage` - The revealed preimage from the hash chain
/// * `slothash` - The slothash captured at request time
///
/// # Returns
/// The derived 32-byte randomness value
#[inline]
pub fn derive_randomness(preimage: &[u8; 32], slothash: &[u8; 32]) -> [u8; 32] {
    let mut result = [0u8; 32];
    for i in 0..32 {
        result[i] = preimage[i] ^ slothash[i];
    }
    result
}

/// Verify that a preimage hashes to an expected commitment (AC-EP3.4).
///
/// # Arguments
/// * `preimage` - The preimage to verify
/// * `expected_hash` - The expected commitment hash
///
/// # Returns
/// `Ok(())` if the preimage is valid, `Err` otherwise
pub fn verify_preimage(preimage: &[u8; 32], expected_hash: &[u8; 32]) -> Result<()> {
    let computed_hash = sha256(preimage);
    if computed_hash != *expected_hash {
        return Err(ProviderError::HashMismatch {
            position: 0, // Position not applicable for single verification
        });
    }
    Ok(())
}

/// Extended pending commitment with deadline tracking.
///
/// This wraps a PendingCommitment with additional deadline-related state.
#[derive(Debug, Clone)]
pub struct TrackedCommitment {
    /// The underlying pending commitment
    pub commitment: PendingCommitment,
    /// Deadline slot (commit_slot + reveal_window)
    pub deadline_slot: u64,
    /// Whether a reveal has been attempted
    pub reveal_attempted: bool,
}

impl TrackedCommitment {
    /// Create a new tracked commitment.
    ///
    /// # Arguments
    /// * `commitment` - The pending commitment
    /// * `reveal_window_slots` - The reveal window from config
    pub fn new(commitment: PendingCommitment, reveal_window_slots: u64) -> Self {
        let deadline_slot = commitment.commit_slot.saturating_add(reveal_window_slots);
        Self {
            commitment,
            deadline_slot,
            reveal_attempted: false,
        }
    }

    /// Check if this commitment needs a reveal.
    ///
    /// # Arguments
    /// * `current_slot` - The current blockchain slot
    pub fn needs_reveal(&self, current_slot: u64) -> bool {
        use crate::commit::CommitmentStatus;

        // Only pending commitments need reveals
        if self.commitment.status != CommitmentStatus::Pending {
            return false;
        }

        // Must be past commit slot but before deadline
        current_slot > self.commitment.commit_slot && current_slot < self.deadline_slot
    }

    /// Check if this commitment is at risk of slashing.
    ///
    /// # Arguments
    /// * `current_slot` - The current blockchain slot
    /// * `safety_margin_slots` - Safety margin in slots
    pub fn is_at_risk(&self, current_slot: u64, safety_margin_slots: u64) -> bool {
        let safe_deadline = self.deadline_slot.saturating_sub(safety_margin_slots);
        current_slot >= safe_deadline && current_slot < self.deadline_slot
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commit::CommitmentStatus;

    /// AC-EP3.2: Test reveal instruction building
    #[test]
    fn test_reveal_builder_instruction_format() {
        let program_id = [0xab; 32];
        let builder = RevealBuilder::new(program_id);

        let preimage = [0xcd; 32];
        let data = builder.build_instruction_data(preimage);

        assert_eq!(data.len(), REVEAL_IX_SIZE);
        assert_eq!(data[0], REVEAL_DISCRIMINATOR);
        assert_eq!(&data[8..40], &preimage);
    }

    /// AC-EP3.1: Test slot monitoring - reveal due
    #[test]
    fn test_slot_monitor_is_reveal_due() {
        let monitor = SlotMonitor::new(150);

        let commit_slot = 100;

        // Before commit slot - not due
        assert!(!monitor.is_reveal_due(99, commit_slot));
        assert!(!monitor.is_reveal_due(100, commit_slot));

        // Just after commit - due
        assert!(monitor.is_reveal_due(101, commit_slot));
        assert!(monitor.is_reveal_due(150, commit_slot));
        assert!(monitor.is_reveal_due(249, commit_slot));

        // At or after deadline - not due (too late)
        assert!(!monitor.is_reveal_due(250, commit_slot));
        assert!(!monitor.is_reveal_due(300, commit_slot));
    }

    /// AC-EP3.3: Test deadline tracking
    #[test]
    fn test_slot_monitor_deadline() {
        let monitor = SlotMonitor::new(150);

        let commit_slot = 1000;
        assert_eq!(monitor.deadline_slot(commit_slot), 1150);
        assert_eq!(monitor.safe_reveal_deadline(commit_slot), 1135); // 1150 - 15 (10% of 150)
    }

    /// AC-EP3.3: Test urgency detection
    #[test]
    fn test_slot_monitor_urgency() {
        let monitor = SlotMonitor::new(100);
        let commit_slot = 1000;

        // Well before deadline - not urgent
        assert!(!monitor.is_reveal_urgent(1050, commit_slot));

        // Within safety margin (last 10 slots) - urgent
        assert!(monitor.is_reveal_urgent(1095, commit_slot));
        assert!(monitor.is_reveal_urgent(1099, commit_slot));

        // Past deadline - not urgent (too late)
        assert!(!monitor.is_reveal_urgent(1100, commit_slot));
    }

    /// AC-EP3.3: Test deadline passed detection
    #[test]
    fn test_slot_monitor_deadline_passed() {
        let monitor = SlotMonitor::new(150);
        let commit_slot = 500;

        assert!(!monitor.is_deadline_passed(500, commit_slot));
        assert!(!monitor.is_deadline_passed(649, commit_slot));
        assert!(monitor.is_deadline_passed(650, commit_slot));
        assert!(monitor.is_deadline_passed(700, commit_slot));
    }

    /// AC-EP3.3: Test remaining slots calculation
    #[test]
    fn test_slot_monitor_remaining_slots() {
        let monitor = SlotMonitor::new(100);
        let commit_slot = 1000;

        assert_eq!(monitor.slots_until_deadline(1000, commit_slot), 100);
        assert_eq!(monitor.slots_until_deadline(1050, commit_slot), 50);
        assert_eq!(monitor.slots_until_deadline(1100, commit_slot), 0);
        assert_eq!(monitor.slots_until_deadline(1200, commit_slot), 0);
    }

    /// AC-EP3.4: Test randomness derivation
    #[test]
    fn test_derive_randomness() {
        let preimage = [0xaa; 32];
        let slothash = [0x55; 32];

        let randomness = derive_randomness(&preimage, &slothash);

        // 0xaa XOR 0x55 = 0xff
        assert_eq!(randomness, [0xff; 32]);
    }

    /// AC-EP3.4: Test randomness derivation with varying inputs
    #[test]
    fn test_derive_randomness_different_inputs() {
        let preimage = [0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        let slothash = [0xff, 0x00, 0xff, 0x00, 0xff, 0x00, 0xff, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

        let randomness = derive_randomness(&preimage, &slothash);

        // Manual XOR verification for first 8 bytes
        assert_eq!(randomness[0], 0x12 ^ 0xff); // 0xed
        assert_eq!(randomness[1], 0x34 ^ 0x00); // 0x34
        assert_eq!(randomness[2], 0x56 ^ 0xff); // 0xa9
        assert_eq!(randomness[3], 0x78 ^ 0x00); // 0x78
    }

    /// AC-EP3.4: Test preimage verification success
    #[test]
    fn test_verify_preimage_success() {
        let preimage = [42u8; 32];
        let expected_hash = sha256(&preimage);

        assert!(verify_preimage(&preimage, &expected_hash).is_ok());
    }

    /// AC-EP3.4: Test preimage verification failure
    #[test]
    fn test_verify_preimage_failure() {
        let preimage = [42u8; 32];
        let wrong_hash = [0u8; 32];

        let result = verify_preimage(&preimage, &wrong_hash);
        assert!(matches!(result, Err(ProviderError::HashMismatch { .. })));
    }

    /// Test TrackedCommitment needs_reveal
    #[test]
    fn test_tracked_commitment_needs_reveal() {
        let commitment = PendingCommitment {
            address: [1; 32],
            hash: [2; 32],
            preimage: [3; 32],
            sequence: 0,
            bond_amount: 1_000_000,
            commit_slot: 100,
            status: CommitmentStatus::Pending,
        };

        let tracked = TrackedCommitment::new(commitment, 150);

        assert_eq!(tracked.deadline_slot, 250);

        // Before commit slot - doesn't need reveal
        assert!(!tracked.needs_reveal(100));

        // After commit, before deadline - needs reveal
        assert!(tracked.needs_reveal(101));
        assert!(tracked.needs_reveal(200));
        assert!(tracked.needs_reveal(249));

        // At or after deadline - doesn't need reveal
        assert!(!tracked.needs_reveal(250));
        assert!(!tracked.needs_reveal(300));
    }

    /// Test TrackedCommitment is_at_risk
    #[test]
    fn test_tracked_commitment_at_risk() {
        let commitment = PendingCommitment {
            address: [1; 32],
            hash: [2; 32],
            preimage: [3; 32],
            sequence: 0,
            bond_amount: 1_000_000,
            commit_slot: 100,
            status: CommitmentStatus::Pending,
        };

        let tracked = TrackedCommitment::new(commitment, 100);
        let safety_margin = 10;

        // Well before deadline - not at risk
        assert!(!tracked.is_at_risk(150, safety_margin));

        // Within safety margin - at risk
        assert!(tracked.is_at_risk(190, safety_margin));
        assert!(tracked.is_at_risk(195, safety_margin));
        assert!(tracked.is_at_risk(199, safety_margin));

        // At or after deadline - not at risk (already too late)
        assert!(!tracked.is_at_risk(200, safety_margin));
    }

    /// Test revealed commitment doesn't need reveal
    #[test]
    fn test_revealed_commitment_no_reveal_needed() {
        let commitment = PendingCommitment {
            address: [1; 32],
            hash: [2; 32],
            preimage: [3; 32],
            sequence: 0,
            bond_amount: 1_000_000,
            commit_slot: 100,
            status: CommitmentStatus::Revealed,
        };

        let tracked = TrackedCommitment::new(commitment, 150);

        // Even if slot is in valid range, revealed commitment doesn't need reveal
        assert!(!tracked.needs_reveal(150));
    }

    /// Test custom safety margin
    #[test]
    fn test_custom_safety_margin() {
        let monitor = SlotMonitor::with_safety_margin(200, 50);

        assert_eq!(monitor.reveal_window_slots, 200);
        assert_eq!(monitor.safety_margin_slots, 50);

        let commit_slot = 1000;
        assert_eq!(monitor.safe_reveal_deadline(commit_slot), 1150); // 1200 - 50
    }
}

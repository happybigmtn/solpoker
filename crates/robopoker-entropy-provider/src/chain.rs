//! Hash chain generation and management.
//!
//! A hash chain is a sequence of values where each value is the SHA256 hash of the next:
//! ```text
//! seed -> h(seed) -> h(h(seed)) -> ... -> h^n(seed)
//! ```
//!
//! The chain is revealed in reverse order (from the "tip" back to the seed), allowing
//! verification: anyone can check that h(revealed) = previous_commitment.
//!
//! # Example
//! ```
//! use robopoker_entropy_provider::HashChain;
//!
//! // Generate a chain of depth 100
//! let mut chain = HashChain::generate(&[1u8; 32], 100);
//!
//! // Get the current commitment (chain head)
//! let commitment = chain.current_commitment();
//!
//! // Reveal the preimage
//! let preimage = chain.reveal().unwrap();
//!
//! // Verify: hash(preimage) should equal the previous commitment
//! use sha2::{Sha256, Digest};
//! let mut hasher = Sha256::new();
//! hasher.update(preimage);
//! let hash: [u8; 32] = hasher.finalize().into();
//! // Note: commitment was the NEXT hash in the chain, not the current one
//! ```

use crate::error::{ProviderError, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{BufReader, BufWriter};
use std::path::Path;

/// Current serialization format version.
const CHAIN_VERSION: u32 = 1;

/// Default chain depth if not specified.
pub const DEFAULT_DEPTH: u64 = 10_000;

/// A hash chain for commit-reveal randomness.
///
/// The chain stores preimages in reveal order (index 0 = first to reveal).
/// Each preimage, when hashed, produces the previous entry (or the commitment at index 0).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HashChain {
    /// Serialization version for forward compatibility
    version: u32,
    /// The chain of preimages, stored in reveal order
    /// preimages[0] is revealed first, preimages[depth-1] is the original seed hash
    preimages: Vec<[u8; 32]>,
    /// Current position (next index to reveal)
    position: u64,
    /// Total depth of the chain
    depth: u64,
}

impl HashChain {
    /// Generate a new hash chain from a seed (AC-EP1.1).
    ///
    /// The seed is hashed `depth` times to create the chain. The resulting chain
    /// is stored in reveal order: index 0 is revealed first.
    ///
    /// # Arguments
    /// * `seed` - 32-byte seed value (should be cryptographically random)
    /// * `depth` - Number of preimages to generate (default: 10,000)
    ///
    /// # Panics
    /// Panics if depth is 0.
    pub fn generate(seed: &[u8; 32], depth: u64) -> Self {
        assert!(depth > 0, "depth must be > 0");

        // Build the chain from seed forward
        let mut forward_chain = Vec::with_capacity(depth as usize);
        let mut current = *seed;

        // First entry is hash of seed
        current = sha256(&current);
        forward_chain.push(current);

        // Continue hashing to build the chain
        for _ in 1..depth {
            current = sha256(&current);
            forward_chain.push(current);
        }

        // Reverse so that index 0 is the last hash (first to reveal)
        // and index depth-1 is hash(seed) (last to reveal)
        forward_chain.reverse();

        Self {
            version: CHAIN_VERSION,
            preimages: forward_chain,
            position: 0,
            depth,
        }
    }

    /// Get the current commitment hash (AC-EP1.3).
    ///
    /// This is the hash that should be posted on-chain. When the preimage
    /// is revealed, verifiers can check that hash(preimage) = this commitment.
    ///
    /// Returns the hash of the next preimage to be revealed.
    pub fn current_commitment(&self) -> [u8; 32] {
        if self.position >= self.depth {
            // Chain exhausted, return zeros
            return [0u8; 32];
        }

        // The commitment is the hash of the current preimage
        sha256(&self.preimages[self.position as usize])
    }

    /// Reveal the current preimage and advance position (AC-EP1.4).
    ///
    /// Returns the preimage for the current commitment. After calling this,
    /// `current_commitment()` will return the next commitment in the chain.
    ///
    /// # Errors
    /// Returns `ChainExhausted` if no more preimages are available.
    pub fn reveal(&mut self) -> Result<[u8; 32]> {
        if self.position >= self.depth {
            return Err(ProviderError::ChainExhausted(self.position));
        }

        let preimage = self.preimages[self.position as usize];
        self.position += 1;
        Ok(preimage)
    }

    /// Get the current position in the chain.
    pub fn position(&self) -> u64 {
        self.position
    }

    /// Get the total depth of the chain.
    pub fn depth(&self) -> u64 {
        self.depth
    }

    /// Get the remaining number of reveals available.
    pub fn remaining(&self) -> u64 {
        self.depth.saturating_sub(self.position)
    }

    /// Check if the chain is exhausted.
    pub fn is_exhausted(&self) -> bool {
        self.position >= self.depth
    }

    /// Save the chain to a file (AC-EP1.2).
    ///
    /// The chain is serialized to JSON format with pretty printing for debugging.
    ///
    /// # Arguments
    /// * `path` - Path to save the chain file
    pub fn save<P: AsRef<Path>>(&self, path: P) -> Result<()> {
        let file = File::create(path)?;
        let writer = BufWriter::new(file);
        serde_json::to_writer_pretty(writer, self)?;
        Ok(())
    }

    /// Load a chain from a file (AC-EP1.2).
    ///
    /// # Arguments
    /// * `path` - Path to the chain file
    ///
    /// # Errors
    /// Returns `IncompatibleVersion` if the file version doesn't match.
    pub fn load<P: AsRef<Path>>(path: P) -> Result<Self> {
        let file = File::open(path)?;
        let reader = BufReader::new(file);
        let chain: Self = serde_json::from_reader(reader)?;

        if chain.version != CHAIN_VERSION {
            return Err(ProviderError::IncompatibleVersion {
                found: chain.version,
                expected: CHAIN_VERSION,
            });
        }

        Ok(chain)
    }

    /// Verify the chain integrity by checking that each hash links correctly.
    ///
    /// This is useful after loading a chain from disk to ensure it wasn't corrupted.
    ///
    /// # Returns
    /// `Ok(())` if the chain is valid, or an error indicating where the mismatch occurred.
    pub fn verify(&self) -> Result<()> {
        for i in 0..(self.preimages.len() - 1) {
            let expected = sha256(&self.preimages[i + 1]);
            if expected != self.preimages[i] {
                return Err(ProviderError::HashMismatch {
                    position: (i + 1) as u64,
                });
            }
        }
        Ok(())
    }

    /// Peek at a preimage without advancing the position.
    ///
    /// # Arguments
    /// * `offset` - Offset from current position (0 = current, 1 = next, etc.)
    ///
    /// # Returns
    /// The preimage at the given offset, or None if out of bounds.
    pub fn peek(&self, offset: u64) -> Option<[u8; 32]> {
        let index = self.position + offset;
        if index >= self.depth {
            return None;
        }
        Some(self.preimages[index as usize])
    }

    /// Get the commitment at a specific position (for verification).
    ///
    /// # Arguments
    /// * `position` - The position to get the commitment for
    ///
    /// # Returns
    /// The commitment hash at that position, or None if out of bounds.
    pub fn commitment_at(&self, position: u64) -> Option<[u8; 32]> {
        if position >= self.depth {
            return None;
        }
        Some(sha256(&self.preimages[position as usize]))
    }
}

/// Compute SHA256 hash of data.
#[inline]
fn sha256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// AC-EP1.1: Generate a hash chain of configurable depth
    #[test]
    fn test_generate_chain_default_depth() {
        let seed = [42u8; 32];
        let chain = HashChain::generate(&seed, DEFAULT_DEPTH);

        assert_eq!(chain.depth(), DEFAULT_DEPTH);
        assert_eq!(chain.position(), 0);
        assert_eq!(chain.remaining(), DEFAULT_DEPTH);
        assert!(!chain.is_exhausted());
    }

    #[test]
    fn test_generate_chain_custom_depth() {
        let seed = [1u8; 32];
        let chain = HashChain::generate(&seed, 100);

        assert_eq!(chain.depth(), 100);
        assert_eq!(chain.remaining(), 100);
    }

    #[test]
    #[should_panic(expected = "depth must be > 0")]
    fn test_generate_chain_zero_depth_panics() {
        let seed = [0u8; 32];
        HashChain::generate(&seed, 0);
    }

    /// AC-EP1.2: Persistence to disk
    #[test]
    fn test_save_and_load_chain() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("chain.json");

        let seed = [7u8; 32];
        let chain = HashChain::generate(&seed, 50);
        let original_commitment = chain.current_commitment();

        chain.save(&path).unwrap();

        let loaded = HashChain::load(&path).unwrap();
        assert_eq!(loaded.depth(), 50);
        assert_eq!(loaded.position(), 0);
        assert_eq!(loaded.current_commitment(), original_commitment);
    }

    #[test]
    fn test_save_and_load_preserves_position() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("chain.json");

        let seed = [99u8; 32];
        let mut chain = HashChain::generate(&seed, 20);

        // Advance position
        chain.reveal().unwrap();
        chain.reveal().unwrap();
        assert_eq!(chain.position(), 2);

        let commitment_after_reveals = chain.current_commitment();

        chain.save(&path).unwrap();
        let loaded = HashChain::load(&path).unwrap();

        assert_eq!(loaded.position(), 2);
        assert_eq!(loaded.remaining(), 18);
        assert_eq!(loaded.current_commitment(), commitment_after_reveals);
    }

    #[test]
    fn test_load_nonexistent_file() {
        let result = HashChain::load("/nonexistent/path/chain.json");
        assert!(result.is_err());
    }

    /// AC-EP1.3: Commitment matches on-chain verification
    #[test]
    fn test_commitment_verification() {
        let seed = [13u8; 32];
        let mut chain = HashChain::generate(&seed, 10);

        // Get commitment before reveal
        let commitment = chain.current_commitment();

        // Reveal preimage
        let preimage = chain.reveal().unwrap();

        // Verify: hash(preimage) should equal the commitment
        let computed_hash = sha256(&preimage);
        assert_eq!(computed_hash, commitment);
    }

    #[test]
    fn test_multiple_commitment_verifications() {
        let seed = [255u8; 32];
        let mut chain = HashChain::generate(&seed, 5);

        for _ in 0..5 {
            let commitment = chain.current_commitment();
            let preimage = chain.reveal().unwrap();
            let computed = sha256(&preimage);
            assert_eq!(computed, commitment, "commitment verification failed");
        }
    }

    /// AC-EP1.4: Chain position advances correctly
    #[test]
    fn test_position_advances_after_reveal() {
        let seed = [0u8; 32];
        let mut chain = HashChain::generate(&seed, 100);

        assert_eq!(chain.position(), 0);
        chain.reveal().unwrap();
        assert_eq!(chain.position(), 1);
        chain.reveal().unwrap();
        assert_eq!(chain.position(), 2);
    }

    #[test]
    fn test_remaining_decreases_after_reveal() {
        let seed = [0u8; 32];
        let mut chain = HashChain::generate(&seed, 10);

        assert_eq!(chain.remaining(), 10);
        chain.reveal().unwrap();
        assert_eq!(chain.remaining(), 9);
    }

    #[test]
    fn test_chain_exhaustion() {
        let seed = [0u8; 32];
        let mut chain = HashChain::generate(&seed, 3);

        chain.reveal().unwrap();
        chain.reveal().unwrap();
        chain.reveal().unwrap();

        assert!(chain.is_exhausted());
        assert_eq!(chain.remaining(), 0);

        let result = chain.reveal();
        assert!(matches!(result, Err(ProviderError::ChainExhausted(3))));
    }

    #[test]
    fn test_exhausted_commitment_returns_zeros() {
        let seed = [0u8; 32];
        let mut chain = HashChain::generate(&seed, 1);

        chain.reveal().unwrap();
        assert!(chain.is_exhausted());
        assert_eq!(chain.current_commitment(), [0u8; 32]);
    }

    #[test]
    fn test_verify_valid_chain() {
        let seed = [123u8; 32];
        let chain = HashChain::generate(&seed, 100);
        assert!(chain.verify().is_ok());
    }

    #[test]
    fn test_peek_without_advancing() {
        let seed = [0u8; 32];
        let mut chain = HashChain::generate(&seed, 10);

        let peeked = chain.peek(0).unwrap();
        let revealed = chain.reveal().unwrap();

        assert_eq!(peeked, revealed);
    }

    #[test]
    fn test_peek_out_of_bounds() {
        let seed = [0u8; 32];
        let chain = HashChain::generate(&seed, 5);

        assert!(chain.peek(5).is_none());
        assert!(chain.peek(100).is_none());
    }

    #[test]
    fn test_commitment_at_position() {
        let seed = [0u8; 32];
        let chain = HashChain::generate(&seed, 10);

        // commitment_at(0) should equal current_commitment() when position is 0
        assert_eq!(chain.commitment_at(0), Some(chain.current_commitment()));
    }

    #[test]
    fn test_different_seeds_produce_different_chains() {
        let chain1 = HashChain::generate(&[1u8; 32], 10);
        let chain2 = HashChain::generate(&[2u8; 32], 10);

        assert_ne!(
            chain1.current_commitment(),
            chain2.current_commitment(),
            "different seeds should produce different chains"
        );
    }

    #[test]
    fn test_same_seed_produces_same_chain() {
        let seed = [42u8; 32];
        let chain1 = HashChain::generate(&seed, 10);
        let chain2 = HashChain::generate(&seed, 10);

        assert_eq!(
            chain1.current_commitment(),
            chain2.current_commitment(),
            "same seed should produce same chain"
        );
    }
}

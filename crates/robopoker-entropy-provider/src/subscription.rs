//! Request subscription and concurrency handling.
//!
//! This module provides:
//! - Entropy request account representation (AC-EP4.1)
//! - Auto-commit trigger logic (AC-EP4.2)
//! - Concurrent request handling (AC-EP4.3)
//!
//! # Design
//!
//! The subscription system is built around traits to enable testing without
//! actual network connections. The core trait `RequestSubscriber` abstracts
//! the WebSocket subscription, while `RequestHandler` manages the business
//! logic of responding to new requests.
//!
//! # Concurrency Model
//!
//! Requests are handled through a channel-based architecture:
//! - A subscriber pushes incoming requests to a bounded channel
//! - A single handler processes requests sequentially from the channel
//! - This avoids race conditions while maintaining throughput
//!
//! # Example
//! ```ignore
//! use robopoker_entropy_provider::subscription::{RequestHandler, EntropyRequest};
//!
//! let handler = RequestHandler::new(chain, tracker, config);
//!
//! // Process an incoming request
//! handler.handle_request(request).await?;
//! ```

use crate::chain::HashChain;
use crate::commit::{CommitBuilder, CommitmentStatus, PendingCommitment, PendingTracker};
use crate::error::{ProviderError, Result};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex, MutexGuard};

/// Status of an entropy request account.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum RequestStatus {
    /// Request is pending entropy
    Pending = 0,
    /// Request has been committed to
    Committed = 1,
    /// Request has been fulfilled with randomness
    Fulfilled = 2,
    /// Request was cancelled
    Cancelled = 3,
}

/// Represents an on-chain entropy request account (AC-EP4.1).
///
/// This is the provider's view of a request account. It contains the
/// information needed to decide whether to commit and later reveal.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntropyRequest {
    /// The request account's public key
    pub address: [u8; 32],
    /// The requester's public key
    pub requester: [u8; 32],
    /// The table/game this request is for
    pub table: [u8; 32],
    /// Request status
    pub status: RequestStatus,
    /// Slot when the request was created
    pub request_slot: u64,
    /// The slothash captured at request time (for randomness derivation)
    pub slothash: [u8; 32],
    /// Commitment address assigned to this request (if any)
    pub commitment: Option<[u8; 32]>,
}

impl EntropyRequest {
    /// Check if this request needs a commitment.
    pub fn needs_commitment(&self) -> bool {
        self.status == RequestStatus::Pending && self.commitment.is_none()
    }
}

/// Configuration for the request handler.
#[derive(Debug, Clone)]
pub struct HandlerConfig {
    /// The entropy program ID
    pub program_id: [u8; 32],
    /// The provider's public key
    pub provider: [u8; 32],
    /// Default bond amount in lamports
    pub bond_amount: u64,
    /// Maximum pending commitments before throttling
    pub max_pending: usize,
}

impl Default for HandlerConfig {
    fn default() -> Self {
        Self {
            program_id: [0u8; 32],
            provider: [0u8; 32],
            bond_amount: 1_000_000, // 0.001 SOL
            max_pending: 100,
        }
    }
}

/// Result of handling a request.
#[derive(Debug, Clone)]
pub enum HandleResult {
    /// A new commitment should be posted
    Commit {
        /// The commitment hash to post
        commitment_hash: [u8; 32],
        /// The preimage (for later reveal)
        preimage: [u8; 32],
        /// Sequence number
        sequence: u64,
        /// Bond amount
        bond_amount: u64,
        /// The request this commit is for
        request_address: [u8; 32],
    },
    /// Request is already being handled by an existing commitment
    AlreadyPending {
        /// The commitment sequence handling this request
        sequence: u64,
    },
    /// Too many pending commitments, request queued
    Throttled,
    /// Request doesn't need handling (already fulfilled, cancelled, etc.)
    Skipped,
}

/// Thread-safe request handler (AC-EP4.2, AC-EP4.3).
///
/// Manages the lifecycle of entropy requests, coordinating between the hash
/// chain, pending tracker, and commit builder. All operations are protected
/// by a mutex to ensure concurrent safety.
#[derive(Debug)]
pub struct RequestHandler {
    /// Internal state protected by mutex
    inner: Arc<Mutex<RequestHandlerInner>>,
    /// Configuration (immutable after construction)
    config: HandlerConfig,
}

/// Inner state of the request handler.
#[derive(Debug)]
struct RequestHandlerInner {
    /// The hash chain for commitments
    chain: HashChain,
    /// Tracker for pending commitments
    tracker: PendingTracker,
    /// Queue of pending requests when throttled
    request_queue: VecDeque<EntropyRequest>,
    /// Commit builder for PDA derivation
    commit_builder: CommitBuilder,
}

impl RequestHandler {
    /// Create a new request handler.
    ///
    /// # Arguments
    /// * `chain` - The hash chain for generating commitments
    /// * `tracker` - The pending commitment tracker
    /// * `config` - Handler configuration
    pub fn new(chain: HashChain, tracker: PendingTracker, config: HandlerConfig) -> Self {
        let commit_builder = CommitBuilder::new(config.program_id);
        Self {
            inner: Arc::new(Mutex::new(RequestHandlerInner {
                chain,
                tracker,
                request_queue: VecDeque::new(),
                commit_builder,
            })),
            config,
        }
    }

    /// Lock the inner state.
    fn lock(&self) -> MutexGuard<'_, RequestHandlerInner> {
        self.inner.lock().expect("RequestHandler mutex poisoned")
    }

    /// Handle an incoming entropy request (AC-EP4.2).
    ///
    /// This method is thread-safe and can be called from multiple threads
    /// concurrently. Requests are processed sequentially to avoid races.
    ///
    /// # Arguments
    /// * `request` - The incoming entropy request
    ///
    /// # Returns
    /// A `HandleResult` indicating what action should be taken.
    pub fn handle_request(&self, request: EntropyRequest) -> Result<HandleResult> {
        // Skip requests that don't need commitment
        if !request.needs_commitment() {
            return Ok(HandleResult::Skipped);
        }

        let mut inner = self.lock();

        // Check if we're at capacity
        if inner.tracker.pending_count() >= self.config.max_pending {
            inner.request_queue.push_back(request);
            return Ok(HandleResult::Throttled);
        }

        // Check if chain is exhausted
        if inner.chain.is_exhausted() {
            return Err(ProviderError::ChainExhausted(inner.chain.position()));
        }

        // Generate commitment for this request
        let sequence = inner.tracker.next_sequence();
        let commitment_hash = inner.chain.current_commitment();
        let preimage = inner
            .chain
            .peek(0)
            .ok_or_else(|| ProviderError::ChainExhausted(inner.chain.position()))?;

        // Derive PDA
        let (pda, _) = inner
            .commit_builder
            .derive_pda(&self.config.provider, sequence);

        // Add to tracker
        inner.tracker.add(PendingCommitment {
            address: pda,
            hash: commitment_hash,
            preimage,
            sequence,
            bond_amount: self.config.bond_amount,
            commit_slot: request.request_slot,
            status: CommitmentStatus::Pending,
        });

        // Advance chain
        inner.chain.reveal()?;

        Ok(HandleResult::Commit {
            commitment_hash,
            preimage,
            sequence,
            bond_amount: self.config.bond_amount,
            request_address: request.address,
        })
    }

    /// Process queued requests after a commitment is revealed.
    ///
    /// This should be called after successfully revealing a commitment to
    /// process any requests that were queued due to throttling.
    ///
    /// # Returns
    /// A vector of `HandleResult` for each processed request.
    pub fn process_queue(&self) -> Result<Vec<HandleResult>> {
        let mut results = Vec::new();

        loop {
            // Get next request from queue
            let request = {
                let mut inner = self.lock();
                inner.request_queue.pop_front()
            };

            match request {
                Some(req) => {
                    let result = self.handle_request(req)?;
                    let is_throttled = matches!(result, HandleResult::Throttled);
                    results.push(result);

                    // If we got throttled again, stop processing
                    if is_throttled {
                        break;
                    }
                }
                None => break,
            }
        }

        Ok(results)
    }

    /// Get the current count of pending commitments.
    pub fn pending_count(&self) -> usize {
        self.lock().tracker.pending_count()
    }

    /// Get the size of the request queue.
    pub fn queue_size(&self) -> usize {
        self.lock().request_queue.len()
    }

    /// Get the remaining chain depth.
    pub fn chain_remaining(&self) -> u64 {
        self.lock().chain.remaining()
    }

    /// Mark a commitment as revealed.
    ///
    /// # Arguments
    /// * `sequence` - The sequence number of the revealed commitment
    pub fn mark_revealed(&self, sequence: u64) -> Result<()> {
        self.lock().tracker.mark_revealed(sequence)
    }

    /// Get a snapshot of the handler state for status reporting.
    pub fn status(&self) -> HandlerStatus {
        let inner = self.lock();
        HandlerStatus {
            pending_commitments: inner.tracker.pending_count(),
            queued_requests: inner.request_queue.len(),
            chain_position: inner.chain.position(),
            chain_remaining: inner.chain.remaining(),
            next_sequence: inner.tracker.next_sequence(),
        }
    }

    /// Save the handler's persistent state.
    ///
    /// # Arguments
    /// * `chain_path` - Path to save the hash chain
    /// * `tracker_path` - Path to save the pending tracker
    pub fn save<P: AsRef<std::path::Path>>(&self, chain_path: P, tracker_path: P) -> Result<()> {
        let inner = self.lock();
        inner.chain.save(chain_path)?;
        inner.tracker.save(tracker_path)?;
        Ok(())
    }

    /// Check if there are any pending commitments.
    pub fn has_pending(&self) -> bool {
        self.lock().tracker.has_pending()
    }
}

/// Clone implementation for RequestHandler (shares the inner state).
impl Clone for RequestHandler {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
            config: self.config.clone(),
        }
    }
}

/// Status snapshot of the request handler.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandlerStatus {
    /// Number of pending commitments awaiting reveal
    pub pending_commitments: usize,
    /// Number of requests in the throttle queue
    pub queued_requests: usize,
    /// Current position in the hash chain
    pub chain_position: u64,
    /// Remaining reveals in the chain
    pub chain_remaining: u64,
    /// Next sequence number to use
    pub next_sequence: u64,
}

/// Trait for subscribing to entropy request account changes (AC-EP4.1).
///
/// This trait abstracts the WebSocket subscription mechanism, allowing
/// for easy testing with mock implementations.
pub trait RequestSubscriber {
    /// Subscribe to entropy request account changes.
    ///
    /// Returns a receiver that will yield new requests as they arrive.
    fn subscribe(&self) -> Result<Box<dyn RequestReceiver>>;
}

/// Trait for receiving entropy requests from a subscription.
pub trait RequestReceiver: Send {
    /// Receive the next request, blocking until one is available.
    ///
    /// Returns `None` if the subscription has been closed.
    fn recv(&mut self) -> Option<EntropyRequest>;

    /// Try to receive a request without blocking.
    ///
    /// Returns `None` if no request is immediately available.
    fn try_recv(&mut self) -> Option<EntropyRequest>;
}

/// Mock subscriber for testing (AC-EP4.3).
///
/// Allows injecting requests for testing the handler logic.
#[derive(Debug, Default)]
pub struct MockSubscriber {
    requests: Arc<Mutex<VecDeque<EntropyRequest>>>,
}

impl MockSubscriber {
    /// Create a new mock subscriber.
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a request to be returned by the subscriber.
    pub fn push_request(&self, request: EntropyRequest) {
        self.requests
            .lock()
            .expect("MockSubscriber mutex poisoned")
            .push_back(request);
    }

    /// Add multiple requests.
    pub fn push_requests(&self, requests: impl IntoIterator<Item = EntropyRequest>) {
        let mut queue = self
            .requests
            .lock()
            .expect("MockSubscriber mutex poisoned");
        for req in requests {
            queue.push_back(req);
        }
    }
}

impl RequestSubscriber for MockSubscriber {
    fn subscribe(&self) -> Result<Box<dyn RequestReceiver>> {
        Ok(Box::new(MockReceiver {
            requests: Arc::clone(&self.requests),
        }))
    }
}

/// Mock receiver for testing.
struct MockReceiver {
    requests: Arc<Mutex<VecDeque<EntropyRequest>>>,
}

impl RequestReceiver for MockReceiver {
    fn recv(&mut self) -> Option<EntropyRequest> {
        self.try_recv()
    }

    fn try_recv(&mut self) -> Option<EntropyRequest> {
        self.requests
            .lock()
            .expect("MockReceiver mutex poisoned")
            .pop_front()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::Digest;

    fn test_config() -> HandlerConfig {
        HandlerConfig {
            program_id: [0xab; 32],
            provider: [0xcd; 32],
            bond_amount: 1_000_000,
            max_pending: 5,
        }
    }

    fn test_request(address: [u8; 32]) -> EntropyRequest {
        EntropyRequest {
            address,
            requester: [1u8; 32],
            table: [2u8; 32],
            status: RequestStatus::Pending,
            request_slot: 1000,
            slothash: [3u8; 32],
            commitment: None,
        }
    }

    /// AC-EP4.2: Test auto-commit on new request
    #[test]
    fn test_handle_request_generates_commit() {
        let chain = HashChain::generate(&[42u8; 32], 100);
        let tracker = PendingTracker::new();
        let config = test_config();

        let handler = RequestHandler::new(chain, tracker, config);

        let request = test_request([1u8; 32]);
        let result = handler.handle_request(request).unwrap();

        match result {
            HandleResult::Commit {
                commitment_hash,
                preimage,
                sequence,
                bond_amount,
                request_address,
            } => {
                assert_eq!(sequence, 0);
                assert_eq!(bond_amount, 1_000_000);
                assert_eq!(request_address, [1u8; 32]);
                // Verify preimage hashes to commitment
                let computed = sha2::Sha256::digest(preimage);
                assert_eq!(computed.as_slice(), &commitment_hash);
            }
            other => panic!("Expected Commit, got {:?}", other),
        }

        assert_eq!(handler.pending_count(), 1);
    }

    /// AC-EP4.2: Test no commit when pending exists
    #[test]
    fn test_handle_request_tracks_sequence() {
        let chain = HashChain::generate(&[42u8; 32], 100);
        let tracker = PendingTracker::new();
        let config = test_config();

        let handler = RequestHandler::new(chain, tracker, config);

        // Handle 3 requests
        for i in 0..3 {
            let request = test_request([i as u8; 32]);
            let result = handler.handle_request(request).unwrap();

            match result {
                HandleResult::Commit { sequence, .. } => {
                    assert_eq!(sequence, i as u64);
                }
                other => panic!("Expected Commit, got {:?}", other),
            }
        }

        assert_eq!(handler.pending_count(), 3);

        // Mark first as revealed
        handler.mark_revealed(0).unwrap();
        assert_eq!(handler.pending_count(), 2);
    }

    /// AC-EP4.2: Test skip already-handled requests
    #[test]
    fn test_handle_request_skips_fulfilled() {
        let chain = HashChain::generate(&[42u8; 32], 100);
        let tracker = PendingTracker::new();
        let config = test_config();

        let handler = RequestHandler::new(chain, tracker, config);

        // Request that's already fulfilled
        let request = EntropyRequest {
            address: [1u8; 32],
            requester: [2u8; 32],
            table: [3u8; 32],
            status: RequestStatus::Fulfilled,
            request_slot: 1000,
            slothash: [4u8; 32],
            commitment: Some([5u8; 32]),
        };

        let result = handler.handle_request(request).unwrap();
        assert!(matches!(result, HandleResult::Skipped));
        assert_eq!(handler.pending_count(), 0);
    }

    /// AC-EP4.3: Test throttling when at capacity
    #[test]
    fn test_handle_request_throttles_at_capacity() {
        let chain = HashChain::generate(&[42u8; 32], 100);
        let tracker = PendingTracker::new();
        let mut config = test_config();
        config.max_pending = 3;

        let handler = RequestHandler::new(chain, tracker, config);

        // Fill up to capacity
        for i in 0..3 {
            let request = test_request([i as u8; 32]);
            let result = handler.handle_request(request).unwrap();
            assert!(matches!(result, HandleResult::Commit { .. }));
        }

        assert_eq!(handler.pending_count(), 3);

        // Next request should be throttled
        let request = test_request([10u8; 32]);
        let result = handler.handle_request(request).unwrap();
        assert!(matches!(result, HandleResult::Throttled));

        assert_eq!(handler.queue_size(), 1);
    }

    /// AC-EP4.3: Test queue processing after reveal
    #[test]
    fn test_process_queue_after_reveal() {
        let chain = HashChain::generate(&[42u8; 32], 100);
        let tracker = PendingTracker::new();
        let mut config = test_config();
        config.max_pending = 2;

        let handler = RequestHandler::new(chain, tracker, config);

        // Fill up capacity
        handler.handle_request(test_request([0u8; 32])).unwrap();
        handler.handle_request(test_request([1u8; 32])).unwrap();

        // Queue a third request
        let result = handler.handle_request(test_request([2u8; 32])).unwrap();
        assert!(matches!(result, HandleResult::Throttled));

        // Mark one as revealed to free up space
        handler.mark_revealed(0).unwrap();

        // Process queue
        let results = handler.process_queue().unwrap();
        assert_eq!(results.len(), 1);
        assert!(matches!(results[0], HandleResult::Commit { sequence: 2, .. }));

        assert_eq!(handler.pending_count(), 2); // Still at 2 (1 revealed + 1 new)
        assert_eq!(handler.queue_size(), 0);
    }

    /// AC-EP4.3: Test concurrent access (simulated)
    #[test]
    fn test_concurrent_handler_access() {
        use std::thread;

        let chain = HashChain::generate(&[42u8; 32], 1000);
        let tracker = PendingTracker::new();
        let mut config = test_config();
        config.max_pending = 100;

        let handler = RequestHandler::new(chain, tracker, config);

        // Spawn multiple threads that concurrently submit requests
        let handles: Vec<_> = (0..10)
            .map(|thread_id| {
                let handler = handler.clone();
                thread::spawn(move || {
                    for i in 0..10 {
                        let request = EntropyRequest {
                            address: [(thread_id * 10 + i) as u8; 32],
                            requester: [1u8; 32],
                            table: [2u8; 32],
                            status: RequestStatus::Pending,
                            request_slot: 1000,
                            slothash: [3u8; 32],
                            commitment: None,
                        };
                        handler.handle_request(request).unwrap();
                    }
                })
            })
            .collect();

        // Wait for all threads
        for handle in handles {
            handle.join().unwrap();
        }

        // Verify all 100 requests were handled
        assert_eq!(handler.pending_count(), 100);

        // Verify sequences are unique (no races)
        let status = handler.status();
        assert_eq!(status.next_sequence, 100);
    }

    /// AC-EP4.3: Test chain exhaustion error
    #[test]
    fn test_handle_request_chain_exhausted() {
        let mut chain = HashChain::generate(&[42u8; 32], 2);
        let tracker = PendingTracker::new();
        let config = test_config();

        // Exhaust the chain
        chain.reveal().unwrap();
        chain.reveal().unwrap();

        let handler = RequestHandler::new(chain, tracker, config);

        let request = test_request([1u8; 32]);
        let result = handler.handle_request(request);

        assert!(matches!(result, Err(ProviderError::ChainExhausted(_))));
    }

    /// AC-EP4.1: Test MockSubscriber for testing
    #[test]
    fn test_mock_subscriber() {
        let subscriber = MockSubscriber::new();

        // Push some requests
        subscriber.push_request(test_request([1u8; 32]));
        subscriber.push_request(test_request([2u8; 32]));

        // Subscribe and receive
        let mut receiver = subscriber.subscribe().unwrap();

        let req1 = receiver.recv().unwrap();
        assert_eq!(req1.address, [1u8; 32]);

        let req2 = receiver.recv().unwrap();
        assert_eq!(req2.address, [2u8; 32]);

        // No more requests
        assert!(receiver.recv().is_none());
    }

    /// Test handler status reporting
    #[test]
    fn test_handler_status() {
        let chain = HashChain::generate(&[42u8; 32], 100);
        let tracker = PendingTracker::new();
        let config = test_config();

        let handler = RequestHandler::new(chain, tracker, config);

        let status = handler.status();
        assert_eq!(status.pending_commitments, 0);
        assert_eq!(status.queued_requests, 0);
        assert_eq!(status.chain_position, 0);
        assert_eq!(status.chain_remaining, 100);
        assert_eq!(status.next_sequence, 0);

        // Add a request
        handler.handle_request(test_request([1u8; 32])).unwrap();

        let status = handler.status();
        assert_eq!(status.pending_commitments, 1);
        assert_eq!(status.chain_position, 1);
        assert_eq!(status.chain_remaining, 99);
        assert_eq!(status.next_sequence, 1);
    }

    /// Test save functionality
    #[test]
    fn test_handler_save() {
        use tempfile::tempdir;

        let dir = tempdir().unwrap();
        let chain_path = dir.path().join("chain.json");
        let tracker_path = dir.path().join("tracker.json");

        let chain = HashChain::generate(&[42u8; 32], 100);
        let tracker = PendingTracker::new();
        let config = test_config();

        let handler = RequestHandler::new(chain, tracker, config);

        // Add some state
        handler.handle_request(test_request([1u8; 32])).unwrap();
        handler.handle_request(test_request([2u8; 32])).unwrap();

        // Save
        handler.save(&chain_path, &tracker_path).unwrap();

        // Verify files exist
        assert!(chain_path.exists());
        assert!(tracker_path.exists());

        // Load and verify
        let loaded_chain = HashChain::load(&chain_path).unwrap();
        assert_eq!(loaded_chain.position(), 2);

        let loaded_tracker = PendingTracker::load(&tracker_path).unwrap();
        assert_eq!(loaded_tracker.next_sequence(), 2);
    }
}

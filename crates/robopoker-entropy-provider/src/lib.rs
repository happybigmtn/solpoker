//! Entropy Provider - Off-chain service for managing hash chains and providing randomness.
//!
//! This crate implements the provider-side logic for the commit-reveal scheme:
//! 1. Generate a hash chain from a seed (AC-EP1.1)
//! 2. Persist the chain to disk (AC-EP1.2)
//! 3. Provide the chain head as commitment (AC-EP1.3)
//! 4. Track chain position and consume preimages (AC-EP1.4)
//! 5. Post commitment transactions on-chain (AC-EP2.1)
//! 6. Track pending commitments awaiting reveal (AC-EP2.3)
//! 7. Monitor slots and reveal preimages (AC-EP3.1 to AC-EP3.4)
//! 8. Subscribe to entropy requests via WebSocket (AC-EP4.1)
//! 9. Auto-commit when new requests arrive (AC-EP4.2)
//! 10. Handle concurrent requests safely (AC-EP4.3)
//! 11. Automatic reconnection after RPC disconnection (AC-EP5.1)
//! 12. Persist state on graceful shutdown (AC-EP5.2)
//! 13. Resume pending operations after restart (AC-EP5.3)
//! 14. Log all commit/reveal activity with timestamps (AC-EP5.4)

pub mod chain;
pub mod commit;
pub mod daemon;
pub mod error;
pub mod reveal;
pub mod subscription;

pub use chain::HashChain;
pub use commit::{CommitBuilder, PendingCommitment, PendingTracker};
pub use daemon::{DaemonConfig, DaemonState, LogEntry, LogEvent, Logger, ProviderDaemon};
pub use error::ProviderError;
pub use reveal::{derive_randomness, RevealBuilder, SlotMonitor, TrackedCommitment};
pub use subscription::{
    EntropyRequest, HandleResult, HandlerConfig, HandlerStatus, MockSubscriber, RequestHandler,
    RequestReceiver, RequestStatus, RequestSubscriber,
};

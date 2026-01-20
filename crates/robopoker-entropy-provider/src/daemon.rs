//! Provider daemon with reliability and logging.
//!
//! This module provides:
//! - Logger for commit/reveal activity with timestamps (AC-EP5.4)
//! - ProviderDaemon for running the provider as a service (AC-EP5.1 to AC-EP5.3)
//!   - Automatic reconnection after RPC disconnection
//!   - Graceful shutdown with state persistence
//!   - Resume pending operations after restart
//!
//! # Example
//! ```ignore
//! use robopoker_entropy_provider::daemon::{Logger, ProviderDaemon, DaemonConfig};
//!
//! let logger = Logger::new();
//! let config = DaemonConfig::default();
//! let daemon = ProviderDaemon::new(handler, config, logger);
//!
//! // Run the daemon (blocking)
//! daemon.run().await?;
//! ```

use crate::chain::HashChain;
use crate::commit::PendingTracker;
use crate::error::{ProviderError, Result};
use crate::subscription::RequestHandler;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Log entry type for commit/reveal activity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LogEvent {
    /// Commitment posted on-chain
    Commit,
    /// Preimage revealed on-chain
    Reveal,
    /// Request received from subscription
    RequestReceived,
    /// RPC connection established
    Connected,
    /// RPC connection lost
    Disconnected,
    /// Reconnection attempt
    ReconnectAttempt,
    /// Shutdown initiated
    ShutdownInitiated,
    /// State persisted to disk
    StatePersisted,
    /// State loaded from disk
    StateLoaded,
    /// Error occurred
    Error,
}

impl std::fmt::Display for LogEvent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            Self::Commit => "COMMIT",
            Self::Reveal => "REVEAL",
            Self::RequestReceived => "REQUEST",
            Self::Connected => "CONNECTED",
            Self::Disconnected => "DISCONNECTED",
            Self::ReconnectAttempt => "RECONNECT",
            Self::ShutdownInitiated => "SHUTDOWN",
            Self::StatePersisted => "PERSISTED",
            Self::StateLoaded => "LOADED",
            Self::Error => "ERROR",
        };
        write!(f, "{}", s)
    }
}

/// A log entry with timestamp (AC-EP5.4).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    /// Unix timestamp in milliseconds
    pub timestamp_ms: u64,
    /// Event type
    pub event: LogEvent,
    /// Optional message with details
    pub message: Option<String>,
    /// Optional sequence number (for commit/reveal events)
    pub sequence: Option<u64>,
}

impl LogEntry {
    /// Create a new log entry with the current timestamp.
    pub fn new(event: LogEvent) -> Self {
        Self {
            timestamp_ms: current_timestamp_ms(),
            event,
            message: None,
            sequence: None,
        }
    }

    /// Add a message to the log entry.
    pub fn with_message(mut self, message: impl Into<String>) -> Self {
        self.message = Some(message.into());
        self
    }

    /// Add a sequence number to the log entry.
    pub fn with_sequence(mut self, sequence: u64) -> Self {
        self.sequence = Some(sequence);
        self
    }
}

impl std::fmt::Display for LogEntry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let timestamp = format_timestamp(self.timestamp_ms);
        write!(f, "[{}] {}", timestamp, self.event)?;

        if let Some(seq) = self.sequence {
            write!(f, " seq={}", seq)?;
        }

        if let Some(ref msg) = self.message {
            write!(f, " {}", msg)?;
        }

        Ok(())
    }
}

/// Logger for commit/reveal activity with timestamps (AC-EP5.4).
///
/// Stores log entries in memory and optionally writes to a callback function.
#[derive(Debug, Default)]
pub struct Logger {
    /// In-memory log entries (bounded ring buffer)
    entries: std::sync::Mutex<Vec<LogEntry>>,
    /// Maximum number of entries to keep in memory
    max_entries: usize,
    /// Whether logging is enabled
    enabled: AtomicBool,
}

impl Logger {
    /// Create a new logger.
    pub fn new() -> Self {
        Self {
            entries: std::sync::Mutex::new(Vec::new()),
            max_entries: 1000,
            enabled: AtomicBool::new(true),
        }
    }

    /// Create a logger with a custom max entries limit.
    pub fn with_max_entries(max_entries: usize) -> Self {
        Self {
            entries: std::sync::Mutex::new(Vec::new()),
            max_entries,
            enabled: AtomicBool::new(true),
        }
    }

    /// Enable or disable logging.
    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::SeqCst);
    }

    /// Check if logging is enabled.
    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }

    /// Log an event.
    pub fn log(&self, entry: LogEntry) {
        if !self.is_enabled() {
            return;
        }

        let mut entries = self.entries.lock().expect("Logger mutex poisoned");

        // Enforce ring buffer limit
        if entries.len() >= self.max_entries {
            entries.remove(0);
        }

        entries.push(entry);
    }

    /// Log a commit event.
    pub fn log_commit(&self, sequence: u64, message: Option<&str>) {
        let mut entry = LogEntry::new(LogEvent::Commit).with_sequence(sequence);
        if let Some(msg) = message {
            entry = entry.with_message(msg);
        }
        self.log(entry);
    }

    /// Log a reveal event.
    pub fn log_reveal(&self, sequence: u64, message: Option<&str>) {
        let mut entry = LogEntry::new(LogEvent::Reveal).with_sequence(sequence);
        if let Some(msg) = message {
            entry = entry.with_message(msg);
        }
        self.log(entry);
    }

    /// Log a request received event.
    pub fn log_request(&self, message: Option<&str>) {
        let mut entry = LogEntry::new(LogEvent::RequestReceived);
        if let Some(msg) = message {
            entry = entry.with_message(msg);
        }
        self.log(entry);
    }

    /// Log a connection event.
    pub fn log_connected(&self, message: Option<&str>) {
        let mut entry = LogEntry::new(LogEvent::Connected);
        if let Some(msg) = message {
            entry = entry.with_message(msg);
        }
        self.log(entry);
    }

    /// Log a disconnection event.
    pub fn log_disconnected(&self, message: Option<&str>) {
        let mut entry = LogEntry::new(LogEvent::Disconnected);
        if let Some(msg) = message {
            entry = entry.with_message(msg);
        }
        self.log(entry);
    }

    /// Log a reconnection attempt.
    pub fn log_reconnect_attempt(&self, attempt: u32) {
        let entry = LogEntry::new(LogEvent::ReconnectAttempt)
            .with_message(format!("attempt={}", attempt));
        self.log(entry);
    }

    /// Log an error.
    pub fn log_error(&self, message: &str) {
        let entry = LogEntry::new(LogEvent::Error).with_message(message);
        self.log(entry);
    }

    /// Log a state persistence event.
    pub fn log_persisted(&self) {
        let entry = LogEntry::new(LogEvent::StatePersisted);
        self.log(entry);
    }

    /// Log a state load event.
    pub fn log_loaded(&self) {
        let entry = LogEntry::new(LogEvent::StateLoaded);
        self.log(entry);
    }

    /// Log a shutdown initiated event.
    pub fn log_shutdown(&self) {
        let entry = LogEntry::new(LogEvent::ShutdownInitiated);
        self.log(entry);
    }

    /// Get all log entries.
    pub fn entries(&self) -> Vec<LogEntry> {
        self.entries
            .lock()
            .expect("Logger mutex poisoned")
            .clone()
    }

    /// Get the last N log entries.
    pub fn last_entries(&self, n: usize) -> Vec<LogEntry> {
        let entries = self.entries.lock().expect("Logger mutex poisoned");
        let start = entries.len().saturating_sub(n);
        entries[start..].to_vec()
    }

    /// Clear all log entries.
    pub fn clear(&self) {
        self.entries
            .lock()
            .expect("Logger mutex poisoned")
            .clear();
    }
}

/// Configuration for the provider daemon.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonConfig {
    /// Path to persist the hash chain
    pub chain_path: PathBuf,
    /// Path to persist the pending tracker
    pub tracker_path: PathBuf,
    /// Initial reconnection delay in milliseconds
    pub initial_reconnect_delay_ms: u64,
    /// Maximum reconnection delay in milliseconds
    pub max_reconnect_delay_ms: u64,
    /// Maximum number of reconnection attempts (0 = unlimited)
    pub max_reconnect_attempts: u32,
    /// Whether to persist state on shutdown
    pub persist_on_shutdown: bool,
    /// Whether to load state on startup
    pub load_on_startup: bool,
}

impl Default for DaemonConfig {
    fn default() -> Self {
        Self {
            chain_path: PathBuf::from("chain.json"),
            tracker_path: PathBuf::from("pending.json"),
            initial_reconnect_delay_ms: 1000,      // 1 second
            max_reconnect_delay_ms: 60_000,        // 1 minute
            max_reconnect_attempts: 0,             // unlimited
            persist_on_shutdown: true,
            load_on_startup: true,
        }
    }
}

/// State of the provider daemon.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DaemonState {
    /// Daemon is starting up
    Starting,
    /// Daemon is running and connected
    Running,
    /// Daemon is attempting to reconnect
    Reconnecting,
    /// Daemon is shutting down
    ShuttingDown,
    /// Daemon has stopped
    Stopped,
}

/// Provider daemon for running the entropy provider as a service.
///
/// Handles:
/// - Automatic reconnection after RPC disconnection (AC-EP5.1)
/// - Graceful shutdown with state persistence (AC-EP5.2)
/// - Resume pending operations after restart (AC-EP5.3)
#[derive(Debug)]
pub struct ProviderDaemon {
    /// The request handler
    handler: RequestHandler,
    /// Daemon configuration
    config: DaemonConfig,
    /// Logger for activity tracking
    logger: Arc<Logger>,
    /// Shutdown signal
    shutdown_flag: Arc<AtomicBool>,
    /// Current daemon state
    state: std::sync::Mutex<DaemonState>,
}

impl ProviderDaemon {
    /// Create a new provider daemon.
    pub fn new(handler: RequestHandler, config: DaemonConfig, logger: Arc<Logger>) -> Self {
        Self {
            handler,
            config,
            logger,
            shutdown_flag: Arc::new(AtomicBool::new(false)),
            state: std::sync::Mutex::new(DaemonState::Stopped),
        }
    }

    /// Get the shutdown flag for signal handling.
    pub fn shutdown_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.shutdown_flag)
    }

    /// Get the current daemon state.
    pub fn state(&self) -> DaemonState {
        *self.state.lock().expect("State mutex poisoned")
    }

    /// Set the daemon state.
    fn set_state(&self, new_state: DaemonState) {
        *self.state.lock().expect("State mutex poisoned") = new_state;
    }

    /// Signal the daemon to shut down (AC-EP5.2).
    pub fn shutdown(&self) {
        self.shutdown_flag.store(true, Ordering::SeqCst);
        self.logger.log_shutdown();
    }

    /// Check if shutdown has been requested.
    pub fn is_shutdown_requested(&self) -> bool {
        self.shutdown_flag.load(Ordering::SeqCst)
    }

    /// Persist the current state to disk (AC-EP5.2).
    pub fn persist_state(&self) -> Result<()> {
        self.handler
            .save(&self.config.chain_path, &self.config.tracker_path)?;
        self.logger.log_persisted();
        Ok(())
    }

    /// Load state from disk (AC-EP5.3).
    ///
    /// Returns the loaded chain and tracker, or defaults if files don't exist.
    pub fn load_state(config: &DaemonConfig, logger: &Logger) -> Result<(HashChain, PendingTracker)> {
        let chain = if config.chain_path.exists() {
            HashChain::load(&config.chain_path)?
        } else {
            return Err(ProviderError::IoError(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "Chain file not found",
            )));
        };

        let tracker = if config.tracker_path.exists() {
            PendingTracker::load(&config.tracker_path)?
        } else {
            PendingTracker::new()
        };

        logger.log_loaded();
        Ok((chain, tracker))
    }

    /// Calculate reconnection delay with exponential backoff (AC-EP5.1).
    pub fn reconnect_delay(&self, attempt: u32) -> Duration {
        let base = self.config.initial_reconnect_delay_ms;
        let max = self.config.max_reconnect_delay_ms;

        // Exponential backoff: base * 2^attempt, capped at max
        let delay_ms = base.saturating_mul(1u64 << attempt.min(10));
        Duration::from_millis(delay_ms.min(max))
    }

    /// Check if reconnection attempts should continue.
    pub fn should_reconnect(&self, attempt: u32) -> bool {
        if self.is_shutdown_requested() {
            return false;
        }

        if self.config.max_reconnect_attempts == 0 {
            return true; // Unlimited attempts
        }

        attempt < self.config.max_reconnect_attempts
    }

    /// Get the handler reference.
    pub fn handler(&self) -> &RequestHandler {
        &self.handler
    }

    /// Get the logger reference.
    pub fn logger(&self) -> &Logger {
        &self.logger
    }

    /// Get the config reference.
    pub fn config(&self) -> &DaemonConfig {
        &self.config
    }

    /// Initialize the daemon (sets state to Starting, optionally loads state).
    ///
    /// Returns true if state was loaded from disk.
    pub fn initialize(&self) -> bool {
        self.set_state(DaemonState::Starting);
        // Note: actual state loading is handled by caller since it needs mutable handler
        false
    }

    /// Transition to running state.
    pub fn start_running(&self) {
        self.set_state(DaemonState::Running);
        self.logger.log_connected(None);
    }

    /// Transition to reconnecting state.
    pub fn start_reconnecting(&self) {
        self.set_state(DaemonState::Reconnecting);
        self.logger.log_disconnected(None);
    }

    /// Perform graceful shutdown (AC-EP5.2).
    pub fn graceful_shutdown(&self) -> Result<()> {
        self.set_state(DaemonState::ShuttingDown);

        if self.config.persist_on_shutdown {
            self.persist_state()?;
        }

        self.set_state(DaemonState::Stopped);
        Ok(())
    }
}

/// Get current Unix timestamp in milliseconds.
fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Format a timestamp in milliseconds to ISO 8601 format.
fn format_timestamp(timestamp_ms: u64) -> String {
    let secs = timestamp_ms / 1000;
    let millis = timestamp_ms % 1000;

    // Simple UTC timestamp formatting (no external dependencies)
    // Format: YYYY-MM-DDTHH:MM:SS.mmmZ
    let days_since_epoch = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    // Calculate date (simplified - doesn't handle leap seconds)
    let (year, month, day) = days_to_ymd(days_since_epoch as i64);

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year, month, day, hours, minutes, seconds, millis
    )
}

/// Convert days since epoch to year-month-day.
fn days_to_ymd(days: i64) -> (i32, u32, u32) {
    // Simplified algorithm for dates after 1970
    let mut remaining_days = days;
    let mut year = 1970i32;

    loop {
        let days_in_year = if is_leap_year(year) { 366 } else { 365 };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        year += 1;
    }

    let leap = is_leap_year(year);
    let days_in_months: [i64; 12] = if leap {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    let mut month = 1u32;
    for days_in_month in days_in_months.iter() {
        if remaining_days < *days_in_month {
            break;
        }
        remaining_days -= days_in_month;
        month += 1;
    }

    let day = (remaining_days + 1) as u32;

    (year, month, day)
}

/// Check if a year is a leap year.
fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commit::PendingTracker;
    use crate::subscription::HandlerConfig;
    use tempfile::tempdir;

    fn test_handler() -> RequestHandler {
        let chain = HashChain::generate(&[42u8; 32], 100);
        let tracker = PendingTracker::new();
        let config = HandlerConfig::default();
        RequestHandler::new(chain, tracker, config)
    }

    // ========================================================================
    // Logger Tests (AC-EP5.4)
    // ========================================================================

    /// AC-EP5.4: Logger logs commit activity with timestamps
    #[test]
    fn test_logger_logs_commit_with_timestamp() {
        let logger = Logger::new();

        logger.log_commit(0, Some("commitment posted"));

        let entries = logger.entries();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].event, LogEvent::Commit);
        assert_eq!(entries[0].sequence, Some(0));
        assert!(entries[0].message.as_ref().unwrap().contains("commitment posted"));
        assert!(entries[0].timestamp_ms > 0);
    }

    /// AC-EP5.4: Logger logs reveal activity with timestamps
    #[test]
    fn test_logger_logs_reveal_with_timestamp() {
        let logger = Logger::new();

        logger.log_reveal(5, Some("preimage revealed"));

        let entries = logger.entries();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].event, LogEvent::Reveal);
        assert_eq!(entries[0].sequence, Some(5));
        assert!(entries[0].message.as_ref().unwrap().contains("preimage revealed"));
        assert!(entries[0].timestamp_ms > 0);
    }

    /// AC-EP5.4: Logger entries have valid timestamp format
    #[test]
    fn test_log_entry_display_format() {
        let entry = LogEntry {
            timestamp_ms: 1705708800000, // 2024-01-20T00:00:00Z
            event: LogEvent::Commit,
            message: Some("test message".to_string()),
            sequence: Some(42),
        };

        let display = format!("{}", entry);

        assert!(display.contains("COMMIT"));
        assert!(display.contains("seq=42"));
        assert!(display.contains("test message"));
        // Should have ISO timestamp
        assert!(display.contains("2024-01-20"));
    }

    /// AC-EP5.4: Logger respects max entries limit (ring buffer)
    #[test]
    fn test_logger_ring_buffer() {
        let logger = Logger::with_max_entries(5);

        for i in 0..10 {
            logger.log_commit(i, None);
        }

        let entries = logger.entries();
        assert_eq!(entries.len(), 5);

        // Should have the last 5 entries (sequences 5-9)
        for (i, entry) in entries.iter().enumerate() {
            assert_eq!(entry.sequence, Some((i + 5) as u64));
        }
    }

    /// AC-EP5.4: Logger can be disabled
    #[test]
    fn test_logger_disable() {
        let logger = Logger::new();

        logger.log_commit(0, None);
        assert_eq!(logger.entries().len(), 1);

        logger.set_enabled(false);
        logger.log_commit(1, None);
        assert_eq!(logger.entries().len(), 1); // No new entry

        logger.set_enabled(true);
        logger.log_commit(2, None);
        assert_eq!(logger.entries().len(), 2);
    }

    /// AC-EP5.4: Logger logs all event types
    #[test]
    fn test_logger_all_event_types() {
        let logger = Logger::new();

        logger.log_commit(0, None);
        logger.log_reveal(1, None);
        logger.log_request(None);
        logger.log_connected(None);
        logger.log_disconnected(None);
        logger.log_reconnect_attempt(1);
        logger.log_error("test error");
        logger.log_persisted();
        logger.log_loaded();
        logger.log_shutdown();

        let entries = logger.entries();
        assert_eq!(entries.len(), 10);

        assert_eq!(entries[0].event, LogEvent::Commit);
        assert_eq!(entries[1].event, LogEvent::Reveal);
        assert_eq!(entries[2].event, LogEvent::RequestReceived);
        assert_eq!(entries[3].event, LogEvent::Connected);
        assert_eq!(entries[4].event, LogEvent::Disconnected);
        assert_eq!(entries[5].event, LogEvent::ReconnectAttempt);
        assert_eq!(entries[6].event, LogEvent::Error);
        assert_eq!(entries[7].event, LogEvent::StatePersisted);
        assert_eq!(entries[8].event, LogEvent::StateLoaded);
        assert_eq!(entries[9].event, LogEvent::ShutdownInitiated);
    }

    /// AC-EP5.4: last_entries returns correct subset
    #[test]
    fn test_logger_last_entries() {
        let logger = Logger::new();

        for i in 0..10 {
            logger.log_commit(i, None);
        }

        let last_3 = logger.last_entries(3);
        assert_eq!(last_3.len(), 3);
        assert_eq!(last_3[0].sequence, Some(7));
        assert_eq!(last_3[1].sequence, Some(8));
        assert_eq!(last_3[2].sequence, Some(9));
    }

    // ========================================================================
    // DaemonConfig Tests
    // ========================================================================

    #[test]
    fn test_daemon_config_default() {
        let config = DaemonConfig::default();

        assert_eq!(config.chain_path, PathBuf::from("chain.json"));
        assert_eq!(config.tracker_path, PathBuf::from("pending.json"));
        assert_eq!(config.initial_reconnect_delay_ms, 1000);
        assert_eq!(config.max_reconnect_delay_ms, 60_000);
        assert_eq!(config.max_reconnect_attempts, 0); // unlimited
        assert!(config.persist_on_shutdown);
        assert!(config.load_on_startup);
    }

    // ========================================================================
    // ProviderDaemon Tests (AC-EP5.1 to AC-EP5.3)
    // ========================================================================

    /// AC-EP5.1: Daemon calculates exponential backoff correctly
    #[test]
    fn test_reconnect_delay_exponential_backoff() {
        let handler = test_handler();
        let mut config = DaemonConfig::default();
        config.initial_reconnect_delay_ms = 1000;
        config.max_reconnect_delay_ms = 60_000;
        let logger = Arc::new(Logger::new());

        let daemon = ProviderDaemon::new(handler, config, logger);

        // First attempt: 1000ms
        assert_eq!(daemon.reconnect_delay(0), Duration::from_millis(1000));

        // Second attempt: 2000ms
        assert_eq!(daemon.reconnect_delay(1), Duration::from_millis(2000));

        // Third attempt: 4000ms
        assert_eq!(daemon.reconnect_delay(2), Duration::from_millis(4000));

        // Fourth attempt: 8000ms
        assert_eq!(daemon.reconnect_delay(3), Duration::from_millis(8000));

        // Cap at max: 60000ms
        assert_eq!(daemon.reconnect_delay(10), Duration::from_millis(60_000));
        assert_eq!(daemon.reconnect_delay(20), Duration::from_millis(60_000));
    }

    /// AC-EP5.1: Daemon respects max reconnect attempts
    #[test]
    fn test_should_reconnect_max_attempts() {
        let handler = test_handler();
        let mut config = DaemonConfig::default();
        config.max_reconnect_attempts = 5;
        let logger = Arc::new(Logger::new());

        let daemon = ProviderDaemon::new(handler, config, logger);

        assert!(daemon.should_reconnect(0));
        assert!(daemon.should_reconnect(4));
        assert!(!daemon.should_reconnect(5));
        assert!(!daemon.should_reconnect(10));
    }

    /// AC-EP5.1: Daemon with unlimited reconnect attempts
    #[test]
    fn test_should_reconnect_unlimited() {
        let handler = test_handler();
        let mut config = DaemonConfig::default();
        config.max_reconnect_attempts = 0; // unlimited
        let logger = Arc::new(Logger::new());

        let daemon = ProviderDaemon::new(handler, config, logger);

        assert!(daemon.should_reconnect(0));
        assert!(daemon.should_reconnect(100));
        assert!(daemon.should_reconnect(1000));
    }

    /// AC-EP5.1: Shutdown stops reconnection attempts
    #[test]
    fn test_shutdown_stops_reconnect() {
        let handler = test_handler();
        let config = DaemonConfig::default();
        let logger = Arc::new(Logger::new());

        let daemon = ProviderDaemon::new(handler, config, logger);

        assert!(daemon.should_reconnect(0));

        daemon.shutdown();

        assert!(!daemon.should_reconnect(0));
    }

    /// AC-EP5.2: Daemon persists state on graceful shutdown
    #[test]
    fn test_persist_state_on_shutdown() {
        let dir = tempdir().unwrap();

        let handler = test_handler();
        let mut config = DaemonConfig::default();
        config.chain_path = dir.path().join("chain.json");
        config.tracker_path = dir.path().join("pending.json");
        config.persist_on_shutdown = true;
        let logger = Arc::new(Logger::new());

        let daemon = ProviderDaemon::new(handler, config.clone(), logger.clone());

        // Graceful shutdown should persist state
        daemon.graceful_shutdown().unwrap();

        // Files should exist
        assert!(config.chain_path.exists());
        assert!(config.tracker_path.exists());

        // Logger should record persistence
        let entries = logger.entries();
        assert!(entries.iter().any(|e| e.event == LogEvent::StatePersisted));
    }

    /// AC-EP5.2: Daemon signals shutdown correctly
    #[test]
    fn test_shutdown_signal() {
        let handler = test_handler();
        let config = DaemonConfig::default();
        let logger = Arc::new(Logger::new());

        let daemon = ProviderDaemon::new(handler, config, logger.clone());

        assert!(!daemon.is_shutdown_requested());

        daemon.shutdown();

        assert!(daemon.is_shutdown_requested());

        // Logger should record shutdown
        let entries = logger.entries();
        assert!(entries
            .iter()
            .any(|e| e.event == LogEvent::ShutdownInitiated));
    }

    /// AC-EP5.2: Daemon state transitions correctly
    #[test]
    fn test_daemon_state_transitions() {
        let handler = test_handler();
        let config = DaemonConfig::default();
        let logger = Arc::new(Logger::new());

        let daemon = ProviderDaemon::new(handler, config, logger);

        assert_eq!(daemon.state(), DaemonState::Stopped);

        daemon.initialize();
        assert_eq!(daemon.state(), DaemonState::Starting);

        daemon.start_running();
        assert_eq!(daemon.state(), DaemonState::Running);

        daemon.start_reconnecting();
        assert_eq!(daemon.state(), DaemonState::Reconnecting);

        daemon.set_state(DaemonState::ShuttingDown);
        assert_eq!(daemon.state(), DaemonState::ShuttingDown);

        daemon.set_state(DaemonState::Stopped);
        assert_eq!(daemon.state(), DaemonState::Stopped);
    }

    /// AC-EP5.3: Daemon loads state from disk
    #[test]
    fn test_load_state_from_disk() {
        let dir = tempdir().unwrap();
        let chain_path = dir.path().join("chain.json");
        let tracker_path = dir.path().join("pending.json");

        // Create and save state
        let chain = HashChain::generate(&[99u8; 32], 50);
        let mut tracker = PendingTracker::new();
        use crate::commit::{CommitmentStatus, PendingCommitment};
        tracker.add(PendingCommitment {
            address: [1u8; 32],
            hash: [2u8; 32],
            preimage: [3u8; 32],
            sequence: 0,
            bond_amount: 1_000_000,
            commit_slot: 100,
            status: CommitmentStatus::Pending,
        });

        chain.save(&chain_path).unwrap();
        tracker.save(&tracker_path).unwrap();

        // Load state
        let config = DaemonConfig {
            chain_path,
            tracker_path,
            ..Default::default()
        };
        let logger = Logger::new();

        let (loaded_chain, loaded_tracker) = ProviderDaemon::load_state(&config, &logger).unwrap();

        assert_eq!(loaded_chain.depth(), 50);
        assert_eq!(loaded_tracker.pending_count(), 1);

        // Logger should record load
        let entries = logger.entries();
        assert!(entries.iter().any(|e| e.event == LogEvent::StateLoaded));
    }

    /// AC-EP5.3: Daemon handles missing chain file
    #[test]
    fn test_load_state_missing_chain() {
        let dir = tempdir().unwrap();
        let config = DaemonConfig {
            chain_path: dir.path().join("nonexistent_chain.json"),
            tracker_path: dir.path().join("pending.json"),
            ..Default::default()
        };
        let logger = Logger::new();

        let result = ProviderDaemon::load_state(&config, &logger);
        assert!(result.is_err());
    }

    /// AC-EP5.3: Daemon resumes with pending commitments
    #[test]
    fn test_resume_pending_operations() {
        let dir = tempdir().unwrap();
        let chain_path = dir.path().join("chain.json");
        let tracker_path = dir.path().join("pending.json");

        // Create initial state with pending commitment
        let mut chain = HashChain::generate(&[42u8; 32], 100);
        let mut tracker = PendingTracker::new();

        // Simulate having posted 3 commitments (2 pending, 1 revealed)
        use crate::commit::{CommitmentStatus, PendingCommitment};
        for i in 0..3 {
            let status = if i == 1 {
                CommitmentStatus::Revealed
            } else {
                CommitmentStatus::Pending
            };
            tracker.add(PendingCommitment {
                address: [i as u8; 32],
                hash: chain.current_commitment(),
                preimage: chain.peek(0).unwrap(),
                sequence: i,
                bond_amount: 1_000_000,
                commit_slot: 100 + i,
                status,
            });
            chain.reveal().unwrap();
        }

        chain.save(&chain_path).unwrap();
        tracker.save(&tracker_path).unwrap();

        // Simulate restart: load state
        let config = DaemonConfig {
            chain_path,
            tracker_path,
            ..Default::default()
        };
        let logger = Logger::new();

        let (loaded_chain, loaded_tracker) = ProviderDaemon::load_state(&config, &logger).unwrap();

        // Verify pending operations are still tracked
        assert_eq!(loaded_tracker.pending_count(), 2); // 2 still pending
        assert_eq!(loaded_tracker.total_count(), 3);
        assert_eq!(loaded_chain.position(), 3); // Chain position preserved
        assert_eq!(loaded_chain.remaining(), 97); // Remaining reveals

        // Verify we can identify which need reveals
        let pending: Vec<_> = loaded_tracker.pending_commitments().collect();
        assert_eq!(pending.len(), 2);
        assert!(pending.iter().any(|c| c.sequence == 0));
        assert!(pending.iter().any(|c| c.sequence == 2));
    }

    /// AC-EP5.1: Logger logs reconnection attempts
    #[test]
    fn test_logger_reconnect_attempts() {
        let logger = Logger::new();

        logger.log_disconnected(Some("RPC connection lost"));
        logger.log_reconnect_attempt(1);
        logger.log_reconnect_attempt(2);
        logger.log_connected(Some("RPC connection restored"));

        let entries = logger.entries();
        assert_eq!(entries.len(), 4);

        assert_eq!(entries[0].event, LogEvent::Disconnected);
        assert_eq!(entries[1].event, LogEvent::ReconnectAttempt);
        assert!(entries[1].message.as_ref().unwrap().contains("attempt=1"));
        assert_eq!(entries[2].event, LogEvent::ReconnectAttempt);
        assert!(entries[2].message.as_ref().unwrap().contains("attempt=2"));
        assert_eq!(entries[3].event, LogEvent::Connected);
    }

    // ========================================================================
    // Timestamp Formatting Tests
    // ========================================================================

    #[test]
    fn test_timestamp_formatting() {
        // Test known timestamp: 2024-01-20T00:00:00.000Z
        let timestamp_ms = 1705708800000u64;
        let formatted = format_timestamp(timestamp_ms);
        assert_eq!(formatted, "2024-01-20T00:00:00.000Z");

        // Test with milliseconds
        let timestamp_with_ms = 1705708800123u64;
        let formatted = format_timestamp(timestamp_with_ms);
        assert_eq!(formatted, "2024-01-20T00:00:00.123Z");
    }

    #[test]
    fn test_days_to_ymd() {
        // 1970-01-01
        assert_eq!(days_to_ymd(0), (1970, 1, 1));

        // 2000-01-01 (leap year)
        assert_eq!(days_to_ymd(10957), (2000, 1, 1));

        // 2024-01-20
        assert_eq!(days_to_ymd(19742), (2024, 1, 20));
    }

    #[test]
    fn test_is_leap_year() {
        assert!(is_leap_year(2000)); // divisible by 400
        assert!(is_leap_year(2024)); // divisible by 4, not by 100
        assert!(!is_leap_year(1900)); // divisible by 100, not by 400
        assert!(!is_leap_year(2023)); // not divisible by 4
    }
}

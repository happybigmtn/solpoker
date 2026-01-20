//! Entropy Provider CLI
//!
//! Commands:
//! - `generate`: Generate a new hash chain and save to file (AC-EP6.1)
//! - `start`: Start the provider daemon with specified config (AC-EP6.2)
//! - `status`: Report current provider status (AC-EP6.3)

use clap::{Parser, Subcommand};
use robopoker_entropy_provider::{
    DaemonConfig, HashChain, PendingTracker,
    chain::DEFAULT_DEPTH,
};
use std::path::PathBuf;

/// Entropy Provider CLI - Off-chain service for commit-reveal randomness
#[derive(Parser)]
#[command(name = "entropy-provider")]
#[command(about = "Off-chain entropy provider for robopoker")]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Generate a new hash chain and save to file (AC-EP6.1)
    Generate {
        /// Output file path for the chain
        #[arg(short, long, default_value = "chain.json")]
        output: PathBuf,

        /// Chain depth (number of preimages)
        #[arg(short, long, default_value_t = DEFAULT_DEPTH)]
        depth: u64,

        /// Optional seed file (32 bytes). If not provided, generates random seed.
        #[arg(short, long)]
        seed_file: Option<PathBuf>,
    },

    /// Start the provider daemon with specified config (AC-EP6.2)
    Start {
        /// Path to the hash chain file
        #[arg(short, long, default_value = "chain.json")]
        chain: PathBuf,

        /// Path for pending tracker persistence
        #[arg(short, long, default_value = "pending.json")]
        tracker: PathBuf,

        /// RPC URL for Solana cluster
        #[arg(short, long, default_value = "http://127.0.0.1:8899")]
        rpc_url: String,

        /// WebSocket URL for subscriptions (derived from RPC if not provided)
        #[arg(short, long)]
        ws_url: Option<String>,

        /// Entropy program ID (base58)
        #[arg(long)]
        program_id: Option<String>,
    },

    /// Report current provider status (AC-EP6.3)
    Status {
        /// Path to the hash chain file
        #[arg(short, long, default_value = "chain.json")]
        chain: PathBuf,

        /// Path to the pending tracker file
        #[arg(short, long, default_value = "pending.json")]
        tracker: PathBuf,
    },
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Generate { output, depth, seed_file } => {
            cmd_generate(output, depth, seed_file);
        }
        Commands::Start { chain, tracker, rpc_url, ws_url, program_id } => {
            cmd_start(chain, tracker, rpc_url, ws_url, program_id);
        }
        Commands::Status { chain, tracker } => {
            cmd_status(chain, tracker);
        }
    }
}

/// Generate a new hash chain (AC-EP6.1)
fn cmd_generate(output: PathBuf, depth: u64, seed_file: Option<PathBuf>) {
    // Validate depth
    if depth == 0 {
        eprintln!("Error: depth must be greater than 0");
        std::process::exit(1);
    }

    // Get or generate seed
    let seed: [u8; 32] = match seed_file {
        Some(path) => {
            match std::fs::read(&path) {
                Ok(bytes) if bytes.len() == 32 => {
                    let mut seed = [0u8; 32];
                    seed.copy_from_slice(&bytes);
                    seed
                }
                Ok(bytes) => {
                    eprintln!("Error: seed file must be exactly 32 bytes (got {})", bytes.len());
                    std::process::exit(1);
                }
                Err(e) => {
                    eprintln!("Error: failed to read seed file: {}", e);
                    std::process::exit(1);
                }
            }
        }
        None => {
            use rand::RngCore;
            let mut seed = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut seed);
            seed
        }
    };

    // Generate chain
    println!("Generating hash chain with depth {}...", depth);
    let chain = HashChain::generate(&seed, depth);

    // Save to file
    match chain.save(&output) {
        Ok(()) => {
            println!("Chain saved to: {}", output.display());
            println!("Commitment (chain head): {}", hex::encode(chain.current_commitment()));
            println!("Remaining reveals: {}", chain.remaining());
        }
        Err(e) => {
            eprintln!("Error: failed to save chain: {}", e);
            std::process::exit(1);
        }
    }
}

/// Start the provider daemon (AC-EP6.2)
fn cmd_start(chain_path: PathBuf, tracker_path: PathBuf, rpc_url: String, ws_url: Option<String>, _program_id: Option<String>) {
    // Check chain file exists
    if !chain_path.exists() {
        eprintln!("Error: chain file not found: {}", chain_path.display());
        eprintln!("Run 'entropy-provider generate' first to create a chain.");
        std::process::exit(1);
    }

    // Load chain to verify it's valid
    let chain = match HashChain::load(&chain_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Error: failed to load chain: {}", e);
            std::process::exit(1);
        }
    };

    if chain.is_exhausted() {
        eprintln!("Error: chain is exhausted (no remaining reveals)");
        eprintln!("Generate a new chain with 'entropy-provider generate'.");
        std::process::exit(1);
    }

    // Derive WS URL from RPC if not provided
    let ws_url = ws_url.unwrap_or_else(|| {
        rpc_url
            .replace("http://", "ws://")
            .replace("https://", "wss://")
    });

    let config = DaemonConfig {
        chain_path: chain_path.clone(),
        tracker_path: tracker_path.clone(),
        ..Default::default()
    };

    println!("Starting entropy provider daemon...");
    println!("  Chain: {} (position {}/{})", chain_path.display(), chain.position(), chain.depth());
    println!("  Tracker: {}", tracker_path.display());
    println!("  RPC: {}", rpc_url);
    println!("  WebSocket: {}", ws_url);
    println!();
    println!("Daemon configuration loaded. Ready to process entropy requests.");
    println!("(Full async runtime integration pending - this is a placeholder for AC-EP6.2)");

    // Note: Full daemon execution requires async runtime (tokio) and RPC client.
    // The daemon infrastructure (ProviderDaemon, RequestHandler) is implemented,
    // but the actual network I/O would need additional dependencies.
    // For now, we print the config and exit gracefully.

    // In a full implementation, we would:
    // 1. Set up tokio runtime
    // 2. Create RPC/WebSocket clients
    // 3. Initialize RequestHandler with chain and tracker
    // 4. Create ProviderDaemon and call daemon.run()
    // 5. Handle SIGINT/SIGTERM for graceful shutdown

    println!();
    println!("Config summary:");
    println!("  Initial reconnect delay: {}ms", config.initial_reconnect_delay_ms);
    println!("  Max reconnect delay: {}ms", config.max_reconnect_delay_ms);
    println!("  Max reconnect attempts: {} (0 = unlimited)", config.max_reconnect_attempts);
    println!("  Persist on shutdown: {}", config.persist_on_shutdown);
    println!("  Load on startup: {}", config.load_on_startup);
}

/// Report provider status (AC-EP6.3)
fn cmd_status(chain_path: PathBuf, tracker_path: PathBuf) {
    // Load chain if exists
    let chain_status = if chain_path.exists() {
        match HashChain::load(&chain_path) {
            Ok(chain) => {
                Some((chain.position(), chain.depth(), chain.remaining(), chain.current_commitment()))
            }
            Err(e) => {
                eprintln!("Warning: failed to load chain: {}", e);
                None
            }
        }
    } else {
        None
    };

    // Load tracker if exists
    let tracker_status = if tracker_path.exists() {
        match PendingTracker::load(&tracker_path) {
            Ok(tracker) => {
                Some((tracker.pending_count(), tracker.total_count(), tracker.next_sequence()))
            }
            Err(e) => {
                eprintln!("Warning: failed to load tracker: {}", e);
                None
            }
        }
    } else {
        None
    };

    println!("=== Entropy Provider Status ===");
    println!();

    // Chain status
    println!("Hash Chain:");
    match chain_status {
        Some((position, depth, remaining, commitment)) => {
            println!("  File: {}", chain_path.display());
            println!("  Position: {}/{}", position, depth);
            println!("  Remaining: {}", remaining);
            println!("  Current commitment: {}", hex::encode(commitment));
            if remaining == 0 {
                println!("  WARNING: Chain exhausted! Generate a new chain.");
            } else if remaining < 100 {
                println!("  WARNING: Low on reveals ({} remaining)", remaining);
            }
        }
        None => {
            println!("  File: {} (not found)", chain_path.display());
            println!("  Run 'entropy-provider generate' to create a chain.");
        }
    }

    println!();

    // Pending operations status
    println!("Pending Operations:");
    match tracker_status {
        Some((pending, total, next_seq)) => {
            println!("  File: {}", tracker_path.display());
            println!("  Pending reveals: {}", pending);
            println!("  Total tracked: {}", total);
            println!("  Next sequence: {}", next_seq);
        }
        None => {
            println!("  File: {} (not found)", tracker_path.display());
            println!("  No pending operations tracked.");
        }
    }
}

/// Hex encoding helper (minimal, no external dependency)
mod hex {
    pub fn encode(bytes: impl AsRef<[u8]>) -> String {
        bytes.as_ref().iter().map(|b| format!("{:02x}", b)).collect()
    }
}

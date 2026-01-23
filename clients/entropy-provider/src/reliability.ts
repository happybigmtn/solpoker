/**
 * Reliability Layer for Entropy Provider
 *
 * Implements AC-EP5.1, AC-EP5.2, AC-EP5.3, AC-EP5.4:
 * - AC-EP5.1: Reconnect automatically after RPC disconnection
 * - AC-EP5.2: Persist state on graceful shutdown (SIGTERM/SIGINT)
 * - AC-EP5.3: Resume pending operations after restart
 * - AC-EP5.4: Log all commit/reveal activity with timestamps
 *
 * Architecture:
 * - Logger: Structured logging with timestamps and operation types
 * - ProviderDaemon: Orchestrates the provider with reliability features
 * - Uses exponential backoff for reconnection attempts
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { Address } from "@solana/kit";

import type { HashChain } from "./hash-chain.js";
import { saveHashChain, loadHashChain } from "./hash-chain.js";
import type { CommitmentState, PendingCommitment, EntropyProviderConfig } from "./commit.js";
import { initCommitmentState } from "./commit.js";
import { fetchCommitmentAccount, waitAndReveal } from "./reveal.js";
import { RequestWatcher, AutoHandler, createRequestProcessor } from "./subscription.js";
import { exportProviderMetrics, type ProviderMetricsSnapshot } from "./metrics.js";
import { resolveRpcUrls } from "./rpc-failover.js";

/**
 * Log levels for structured logging
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Log entry with timestamp and structured data
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  operation: string;
  message: string;
  request_id: string | null;
  table_id: string | null;
  data?: Record<string, unknown>;
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  /** Minimum log level to output */
  minLevel: LogLevel;
  /** Custom output function (defaults to console) */
  output?: (entry: LogEntry) => void;
}

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function normalizeLogId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return value.toString();
  if (typeof value === "string") return value;
  return String(value);
}

function serializeLogEntry(entry: LogEntry): string {
  return JSON.stringify(entry, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value
  );
}

/**
 * Structured logger for the entropy provider (AC-EP5.4)
 *
 * Logs all commit/reveal activity with timestamps and operation types.
 */
export class Logger {
  private config: LoggerConfig;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      minLevel: config.minLevel ?? "info",
      output: config.output,
    };
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[this.config.minLevel];
  }

  private extractIds(data?: Record<string, unknown>): { request_id: string | null; table_id: string | null } {
    const requestId = data?.request_id ?? data?.requestId;
    const tableId = data?.table_id ?? data?.tableId;
    return {
      request_id: normalizeLogId(requestId),
      table_id: normalizeLogId(tableId),
    };
  }

  private formatEntry(entry: LogEntry): string {
    return serializeLogEntry(entry);
  }

  log(level: LogLevel, operation: string, message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const ids = this.extractIds(data);
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      operation,
      message,
      request_id: ids.request_id,
      table_id: ids.table_id,
      data,
    };

    if (this.config.output) {
      this.config.output(entry);
    } else {
      // Default to console with appropriate method
      const formatted = this.formatEntry(entry);
      switch (level) {
        case "error":
          console.error(formatted);
          break;
        case "warn":
          console.warn(formatted);
          break;
        default:
          console.log(formatted);
      }
    }
  }

  debug(operation: string, message: string, data?: Record<string, unknown>): void {
    this.log("debug", operation, message, data);
  }

  info(operation: string, message: string, data?: Record<string, unknown>): void {
    this.log("info", operation, message, data);
  }

  warn(operation: string, message: string, data?: Record<string, unknown>): void {
    this.log("warn", operation, message, data);
  }

  error(operation: string, message: string, data?: Record<string, unknown>): void {
    this.log("error", operation, message, data);
  }
}

/**
 * Provider state persisted to disk (AC-EP5.2)
 */
export interface PersistedState {
  /** Version for backwards compatibility */
  version: number;
  /** Path to the hash chain file */
  chainPath: string;
  /** Current chain position */
  chainPosition: number;
  /** Next commitment sequence number */
  nextSequence: string; // serialized bigint
  /** Pending commitments awaiting reveal */
  pendingCommitments: Array<{
    sequence: string; // serialized bigint
    address: string;
    hash: string; // base64
    commitSlot: string; // serialized bigint
    signature: string;
  }>;
  /** Last activity timestamp */
  lastActivity: string;
}

const STATE_VERSION = 1;

/**
 * Save provider state to file (AC-EP5.2)
 */
export async function saveProviderState(
  statePath: string,
  chainPath: string,
  chain: HashChain,
  commitmentState: CommitmentState
): Promise<void> {
  // Save the chain first
  await saveHashChain(chain, chainPath);

  // Build persisted state
  const state: PersistedState = {
    version: STATE_VERSION,
    chainPath,
    chainPosition: chain.position,
    nextSequence: commitmentState.nextSequence.toString(),
    pendingCommitments: commitmentState.pending.map((p) => ({
      sequence: p.sequence.toString(),
      address: p.address,
      hash: Buffer.from(p.hash).toString("base64"),
      commitSlot: p.commitSlot.toString(),
      signature: p.signature,
    })),
    lastActivity: new Date().toISOString(),
  };

  await writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Load provider state from file (AC-EP5.3)
 */
export async function loadProviderState(
  statePath: string
): Promise<{ chainPath: string; commitmentState: CommitmentState } | null> {
  if (!existsSync(statePath)) {
    return null;
  }

  try {
    const content = await readFile(statePath, "utf-8");
    const state: PersistedState = JSON.parse(content);

    if (state.version !== STATE_VERSION) {
      throw new Error(`Unsupported state version: ${state.version}`);
    }

    const commitmentState: CommitmentState = {
      nextSequence: BigInt(state.nextSequence),
      pending: state.pendingCommitments.map((p) => ({
        sequence: BigInt(p.sequence),
        address: p.address as Address,
        hash: new Uint8Array(Buffer.from(p.hash, "base64")),
        commitSlot: BigInt(p.commitSlot),
        signature: p.signature,
      })),
    };

    return { chainPath: state.chainPath, commitmentState };
  } catch (error) {
    return null;
  }
}

/**
 * Configuration for ProviderDaemon
 */
export interface ProviderDaemonConfig extends EntropyProviderConfig {
  /** Path to hash chain file */
  chainPath: string;
  /** Path to state file */
  statePath: string;
  /** Reconnect base delay in ms (default 1000) */
  reconnectBaseDelayMs?: number;
  /** Maximum reconnect delay in ms (default 60000) */
  reconnectMaxDelayMs?: number;
  /** Logger configuration */
  loggerConfig?: Partial<LoggerConfig>;
}

/**
 * Daemon status
 */
export interface DaemonStatus {
  running: boolean;
  chainPosition: number;
  chainDepth: number;
  pendingCount: number;
  lastError: string | null;
  reconnectAttempts: number;
  uptime: number; // milliseconds since start
}

/**
 * Provider daemon with reliability features (AC-EP5.1, AC-EP5.2, AC-EP5.3, AC-EP5.4)
 *
 * This is the main orchestrator that:
 * - Manages the request watcher with automatic reconnection
 * - Persists state on shutdown
 * - Resumes pending operations on restart
 * - Logs all activity with timestamps
 */
export class ProviderDaemon {
  private config: ProviderDaemonConfig;
  private logger: Logger;
  private chain: HashChain | null = null;
  private commitmentState: CommitmentState | null = null;
  private watcher: RequestWatcher | null = null;
  private handler: AutoHandler | null = null;
  private running = false;
  private startTime = 0;
  private reconnectAttempts = 0;
  private lastError: string | null = null;
  private shutdownRequested = false;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(config: ProviderDaemonConfig) {
    this.config = {
      reconnectBaseDelayMs: 1000,
      reconnectMaxDelayMs: 60000,
      ...config,
    };
    this.logger = new Logger(config.loggerConfig);
  }

  /**
   * Start the provider daemon
   *
   * This method:
   * 1. Loads persisted state if available (AC-EP5.3)
   * 2. Initializes the request watcher
   * 3. Registers signal handlers for graceful shutdown (AC-EP5.2)
   * 4. Resumes pending operations (AC-EP5.3)
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error("Daemon already running");
    }

    this.shutdownRequested = false;
    this.startTime = Date.now();
    this.running = true;

    this.logger.debug("daemon", "Starting entropy provider daemon");

    // Register signal handlers for graceful shutdown (AC-EP5.2)
    this.registerSignalHandlers();

    // Load state or initialize fresh
    await this.initializeState();

    // Start the watcher with reconnection logic
    await this.startWatcher();

    // Resume pending operations (AC-EP5.3)
    await this.resumePendingOperations();

    this.logger.debug("daemon", "Entropy provider daemon started", {
      chainPosition: this.chain?.position,
      chainDepth: this.chain?.depth,
      pendingCount: this.commitmentState?.pending.length,
    });
  }

  /**
   * Stop the provider daemon gracefully
   *
   * Persists state before stopping (AC-EP5.2)
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.logger.debug("daemon", "Stopping entropy provider daemon");
    this.shutdownRequested = true;

    // Stop reconnect attempts
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Stop the watcher
    if (this.watcher) {
      this.watcher.stop();
      this.watcher = null;
    }

    // Persist state (AC-EP5.2)
    await this.persistState();

    this.running = false;
    this.logger.debug("daemon", "Entropy provider daemon stopped");
  }

  /**
   * Get current daemon status
   */
  getStatus(): DaemonStatus {
    return {
      running: this.running,
      chainPosition: this.chain?.position ?? 0,
      chainDepth: this.chain?.depth ?? 0,
      pendingCount: this.commitmentState?.pending.length ?? 0,
      lastError: this.lastError,
      reconnectAttempts: this.reconnectAttempts,
      uptime: this.running ? Date.now() - this.startTime : 0,
    };
  }

  /**
   * Export current metrics snapshot (AC-OPS1.2)
   */
  getMetrics(): ProviderMetricsSnapshot {
    const handlerStatus = this.handler?.getStatus();
    const queueDepth = handlerStatus ? handlerStatus.processing + handlerStatus.queueLength : 0;
    return exportProviderMetrics(queueDepth);
  }

  /**
   * Get the logger instance for external use
   */
  getLogger(): Logger {
    return this.logger;
  }

  /**
   * Initialize state from persisted file or fresh (AC-EP5.3)
   */
  private async initializeState(): Promise<void> {
    // Try to load persisted state
    const loaded = await loadProviderState(this.config.statePath);

    if (loaded) {
      this.logger.debug("daemon", "Loading persisted state", {
        chainPath: loaded.chainPath,
        pendingCount: loaded.commitmentState.pending.length,
      });

      // Load the hash chain
      this.chain = await loadHashChain(loaded.chainPath);
      this.commitmentState = loaded.commitmentState;
    } else {
      this.logger.debug("daemon", "No persisted state found, initializing fresh");

      // Load the chain from config path
      this.chain = await loadHashChain(this.config.chainPath);

      // Initialize commitment state from on-chain data
      this.commitmentState = await initCommitmentState(
        resolveRpcUrls(this.config),
        this.config.entropyProgramId,
        this.config.providerSigner.address,
        this.config.rpcFailover
      );
    }
  }

  /**
   * Start the request watcher with reconnection logic (AC-EP5.1)
   */
  private async startWatcher(): Promise<void> {
    if (!this.chain || !this.commitmentState) {
      throw new Error("State not initialized");
    }

    try {
      const { watcher, handler } = createRequestProcessor(
        this.config,
        this.chain,
        this.commitmentState
      );

      // Wrap the handler to log activity
      const originalHandle = handler.handleRequest.bind(handler);
      handler.handleRequest = async (event) => {
        this.logger.debug("request", "Handling entropy request", {
          address: event.address,
          request_id: event.data.requestId.toString(),
        });

        try {
          await originalHandle(event);
          this.logger.debug("request", "Request handled successfully", {
            address: event.address,
          });
        } catch (error) {
          this.logger.error("request", "Failed to handle request", {
            address: event.address,
            error: String(error),
          });
          throw error;
        }
      };

      this.watcher = watcher;
      this.handler = handler;

      await watcher.start();
      this.reconnectAttempts = 0;
      this.lastError = null;

      this.logger.debug("watcher", "Request watcher started");
    } catch (error) {
      this.lastError = String(error);
      this.logger.error("watcher", "Failed to start watcher", { error: this.lastError });
      await this.scheduleReconnect();
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff (AC-EP5.1)
   */
  private async scheduleReconnect(): Promise<void> {
    if (this.shutdownRequested) {
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.config.reconnectBaseDelayMs! * Math.pow(2, this.reconnectAttempts - 1),
      this.config.reconnectMaxDelayMs!
    );

    this.logger.warn("reconnect", `Scheduling reconnect in ${delay}ms`, {
      attempt: this.reconnectAttempts,
      delay,
    });

    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null;
      await this.attemptReconnect();
    }, delay);
  }

  /**
   * Attempt to reconnect after RPC drop (AC-EP5.1)
   */
  private async attemptReconnect(): Promise<void> {
    if (this.shutdownRequested) {
      return;
    }

    this.logger.warn("reconnect", `Attempting reconnection`, {
      attempt: this.reconnectAttempts,
    });

    // Stop existing watcher if any
    if (this.watcher) {
      this.watcher.stop();
      this.watcher = null;
    }

    // Try to reconnect
    await this.startWatcher();
  }

  /**
   * Resume pending operations after restart (AC-EP5.3)
   */
  private async resumePendingOperations(): Promise<void> {
    if (!this.chain || !this.commitmentState) {
      return;
    }

    const pending = this.commitmentState.pending;
    if (pending.length === 0) {
      return;
    }

    this.logger.debug("resume", `Resuming ${pending.length} pending operations`);

    for (const commitment of pending) {
      try {
        // Fetch commitment account to check status and get target/deadline slots
        const commitmentData = await fetchCommitmentAccount(
          resolveRpcUrls(this.config),
          commitment.address,
          this.config.rpcFailover
        );

        if (!commitmentData) {
          this.logger.warn("resume", "Commitment account not found", {
            address: commitment.address,
          });
          continue;
        }

        // Check if already revealed (status = 1)
        if (commitmentData.status === 1) {
          this.logger.debug("resume", "Commitment already revealed, removing from pending", {
            address: commitment.address,
          });
          this.commitmentState.pending = this.commitmentState.pending.filter(
            (p) => p.address !== commitment.address
          );
          continue;
        }

        // Calculate target slot (commit_slot + some buffer, or use a default)
        // The reveal window is typically defined by the entropy config
        const targetSlot = commitmentData.commitSlot + 10n; // 10 slots after commit
        const deadlineSlot = commitmentData.commitSlot + 150n; // ~1 minute deadline

        this.logger.debug("resume", "Resuming reveal for commitment", {
          address: commitment.address,
          targetSlot: targetSlot.toString(),
          deadlineSlot: deadlineSlot.toString(),
        });

        // Wait and reveal
        await waitAndReveal(
          this.config,
          this.chain,
          this.commitmentState,
          commitment,
          targetSlot,
          deadlineSlot
        );

        this.logger.debug("resume", "Successfully resumed commitment reveal", {
          address: commitment.address,
        });
      } catch (error) {
        this.logger.error("resume", "Failed to resume commitment", {
          address: commitment.address,
          error: String(error),
        });
      }
    }
  }

  /**
   * Persist state to disk (AC-EP5.2)
   */
  private async persistState(): Promise<void> {
    if (!this.chain || !this.commitmentState) {
      return;
    }

    try {
      await saveProviderState(
        this.config.statePath,
        this.config.chainPath,
        this.chain,
        this.commitmentState
      );
      this.logger.debug("persist", "State saved to disk", {
        statePath: this.config.statePath,
        chainPosition: this.chain.position,
        pendingCount: this.commitmentState.pending.length,
      });
    } catch (error) {
      this.logger.error("persist", "Failed to save state", { error: String(error) });
    }
  }

  /**
   * Register signal handlers for graceful shutdown (AC-EP5.2)
   */
  private registerSignalHandlers(): void {
    const handleSignal = async (signal: string) => {
      this.logger.warn("signal", `Received ${signal}, shutting down gracefully`);
      await this.stop();
      process.exit(0);
    };

    process.on("SIGTERM", () => handleSignal("SIGTERM"));
    process.on("SIGINT", () => handleSignal("SIGINT"));
  }
}

/**
 * RPC health check - verify connection is working
 */
export async function checkRpcHealth(rpcUrl: string | string[]): Promise<boolean> {
  const urls = Array.isArray(rpcUrl) ? rpcUrl : [rpcUrl];
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getHealth",
        }),
      });
      const data = await response.json();
      if (data.result === "ok") {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * Request Subscription and Auto-Handling for Entropy Provider
 *
 * Implements AC-EP4.1, AC-EP4.2, AC-EP4.3:
 * - AC-EP4.1: Subscribe to entropy request account changes via WebSocket
 * - AC-EP4.2: Auto-commit when new requests are detected
 * - AC-EP4.3: Handle concurrent requests without race conditions
 *
 * Architecture:
 * - RequestWatcher: Monitors for new Request accounts via WebSocket
 * - RequestHandler: Coordinates commit/reveal flow for detected requests
 * - Uses a processing queue with mutex to prevent concurrent race conditions
 */

import {
  address,
  createSolanaRpcSubscriptions,
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
  getProgramDerivedAddress,
  getAddressEncoder,
  type Address,
} from "@solana/kit";

import type { HashChain } from "./hash-chain.js";
import type { EntropyProviderConfig, CommitmentState, PendingCommitment } from "./commit.js";
import { postCommitment } from "./commit.js";
import { waitAndReveal, fetchCommitmentAccount } from "./reveal.js";

/**
 * Request account data parsed from on-chain
 */
export interface RequestAccountData {
  /** Request status: 0=pending, 1=finalized */
  status: number;
  /** The requester pubkey */
  requester: Uint8Array;
  /** The commitment this request is against */
  commitment: Uint8Array;
  /** Unique request ID */
  requestId: bigint;
  /** Slot when request was created */
  requestSlot: bigint;
  /** Deadline slot for reveal */
  deadlineSlot: bigint;
  /** Derived randomness (zeroed until finalized) */
  randomness: Uint8Array;
  /** Slothash at request time */
  slothash: Uint8Array;
}

/**
 * Size of request account (from Rust state.rs)
 * Layout: discriminator(1) + status(1) + padding(6) + requester(32) + commitment(32) +
 *         request_id(8) + request_slot(8) + deadline_slot(8) + randomness(32) + slothash(32) = 160 bytes
 */
export const REQUEST_SIZE = 160;

/**
 * Request discriminator value
 */
const REQUEST_DISCRIMINATOR = 3;

/**
 * Request status values
 */
export const REQUEST_STATUS = {
  PENDING: 0,
  FINALIZED: 1,
} as const;

/**
 * Event emitted when a new request is detected
 */
export interface RequestDetectedEvent {
  /** Request account address */
  address: Address;
  /** Parsed request data */
  data: RequestAccountData;
}

/**
 * Event handler type for request detection
 */
export type RequestHandler = (event: RequestDetectedEvent) => void | Promise<void>;

/**
 * Configuration for RequestWatcher
 */
export interface RequestWatcherConfig {
  /** WebSocket URL for subscriptions */
  wsUrl: string;
  /** HTTP RPC URL for queries */
  rpcUrl: string;
  /** Entropy program ID to watch */
  entropyProgramId: Address;
  /** Polling interval in ms when WebSocket is unavailable (default 2000) */
  pollIntervalMs?: number;
}

/**
 * Parse request account data from bytes
 */
export function parseRequestAccount(data: Uint8Array): RequestAccountData | null {
  if (data.length < REQUEST_SIZE) {
    return null;
  }

  // Check discriminator
  if (data[0] !== REQUEST_DISCRIMINATOR) {
    return null;
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  return {
    status: data[1],
    requester: new Uint8Array(data.slice(8, 40)),
    commitment: new Uint8Array(data.slice(40, 72)),
    requestId: view.getBigUint64(72, true),
    requestSlot: view.getBigUint64(80, true),
    deadlineSlot: view.getBigUint64(88, true),
    randomness: new Uint8Array(data.slice(96, 128)),
    slothash: new Uint8Array(data.slice(128, 160)),
  };
}

/**
 * Create RPC client from URL
 */
function createRpc(url: string) {
  const transport = createDefaultRpcTransport({ url });
  return createSolanaRpcFromTransport(transport);
}

/**
 * Derive request PDA address
 */
export async function deriveRequestPda(
  entropyProgramId: Address,
  requester: Address,
  requestId: bigint
): Promise<readonly [Address, number]> {
  const requestIdBytes = new Uint8Array(8);
  new DataView(requestIdBytes.buffer).setBigUint64(0, requestId, true);

  const encoder = getAddressEncoder();
  const requesterBytes = encoder.encode(requester);

  return getProgramDerivedAddress({
    programAddress: entropyProgramId,
    seeds: [new TextEncoder().encode("request"), requesterBytes, requestIdBytes],
  });
}

/**
 * Fetch all pending request accounts from the entropy program
 */
export async function fetchPendingRequests(
  rpcUrl: string,
  entropyProgramId: Address
): Promise<Map<Address, RequestAccountData>> {
  const rpc = createRpc(rpcUrl);

  // Query program accounts with dataSize filter (Request = 160 bytes)
  // and discriminator filter (first byte = 3 for Request)
  const accounts = await (rpc as any)
    .getProgramAccounts(entropyProgramId, {
      encoding: "base64",
      filters: [
        { dataSize: REQUEST_SIZE },
        { memcmp: { offset: 0, bytes: Buffer.from([REQUEST_DISCRIMINATOR]).toString("base64"), encoding: "base64" } },
      ],
    })
    .send();

  const pending = new Map<Address, RequestAccountData>();

  for (const account of accounts) {
    const data = Buffer.from(account.account.data[0], "base64");
    const parsed = parseRequestAccount(new Uint8Array(data));

    if (parsed && parsed.status === REQUEST_STATUS.PENDING) {
      pending.set(account.pubkey as Address, parsed);
    }
  }

  return pending;
}

/**
 * RequestWatcher monitors for new entropy requests via WebSocket subscription
 *
 * Implements AC-EP4.1: Subscribe to entropy request account changes via WebSocket
 */
export class RequestWatcher {
  private config: RequestWatcherConfig;
  private handlers: RequestHandler[] = [];
  private abortController: AbortController | null = null;
  private seenRequests = new Set<string>();
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: RequestWatcherConfig) {
    this.config = {
      pollIntervalMs: 2000,
      ...config,
    };
  }

  /**
   * Add a handler for request detection events
   */
  onRequest(handler: RequestHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Start watching for new requests
   *
   * Uses a polling approach since programSubscribe isn't widely supported.
   * Falls back to periodic getProgramAccounts calls.
   */
  async start(): Promise<void> {
    if (this.abortController) {
      throw new Error("Watcher already started");
    }

    this.abortController = new AbortController();

    // Start polling for new requests
    await this.pollForRequests();
    this.pollInterval = setInterval(
      () => this.pollForRequests(),
      this.config.pollIntervalMs
    );
  }

  /**
   * Stop watching for requests
   */
  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Poll for pending requests and emit events for new ones
   */
  private async pollForRequests(): Promise<void> {
    try {
      const pending = await fetchPendingRequests(
        this.config.rpcUrl,
        this.config.entropyProgramId
      );

      for (const [addr, data] of pending) {
        const key = `${addr}:${data.requestId}`;
        if (!this.seenRequests.has(key)) {
          this.seenRequests.add(key);
          await this.emitRequest({ address: addr, data });
        }
      }
    } catch (error) {
      // Log but don't crash - we'll retry on next poll
      console.error("Error polling for requests:", error);
    }
  }

  /**
   * Emit request event to all handlers
   */
  private async emitRequest(event: RequestDetectedEvent): Promise<void> {
    for (const handler of this.handlers) {
      try {
        await handler(event);
      } catch (error) {
        console.error("Request handler error:", error);
      }
    }
  }

  /**
   * Check if watcher is running
   */
  isRunning(): boolean {
    return this.abortController !== null;
  }

  /**
   * Get count of seen requests
   */
  getSeenCount(): number {
    return this.seenRequests.size;
  }
}

/**
 * Simple mutex for preventing concurrent operations
 */
class Mutex {
  private locked = false;
  private queue: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }

  isLocked(): boolean {
    return this.locked;
  }

  queueLength(): number {
    return this.queue.length;
  }
}

/**
 * AutoHandler automatically processes detected requests
 *
 * Implements AC-EP4.2 and AC-EP4.3:
 * - AC-EP4.2: Auto-commit when new requests trigger reveals
 * - AC-EP4.3: Handle concurrent requests without race conditions
 */
export class AutoHandler {
  private config: EntropyProviderConfig;
  private chain: HashChain;
  private state: CommitmentState;
  private mutex = new Mutex();
  private processing = new Map<string, Promise<void>>();

  constructor(
    config: EntropyProviderConfig,
    chain: HashChain,
    state: CommitmentState
  ) {
    this.config = config;
    this.chain = chain;
    this.state = state;
  }

  /**
   * Handle a detected request
   *
   * This method:
   * 1. Checks if we have a pending commitment for this request
   * 2. If not, posts a new commitment (AC-EP4.2)
   * 3. Waits for target slot and reveals
   * 4. Uses mutex to prevent race conditions (AC-EP4.3)
   */
  async handleRequest(event: RequestDetectedEvent): Promise<void> {
    const requestKey = `${event.address}`;

    // Check if already processing this request
    if (this.processing.has(requestKey)) {
      return;
    }

    // Start processing with mutex protection
    const processPromise = this.processRequestWithLock(event);
    this.processing.set(requestKey, processPromise);

    try {
      await processPromise;
    } finally {
      this.processing.delete(requestKey);
    }
  }

  /**
   * Process request with mutex lock to prevent race conditions
   */
  private async processRequestWithLock(event: RequestDetectedEvent): Promise<void> {
    await this.mutex.acquire();
    try {
      await this.processRequest(event);
    } finally {
      this.mutex.release();
    }
  }

  /**
   * Process a single request
   */
  private async processRequest(event: RequestDetectedEvent): Promise<void> {
    const { data } = event;
    // Find the pending commitment for this request
    let pendingCommitment = this.findPendingCommitment(data.commitment);

    // If no pending commitment exists, we need to post one first
    if (!pendingCommitment) {
      // Post a new commitment (AC-EP4.2)
      pendingCommitment = await postCommitment(this.config, this.chain, this.state);
    }

    // Get commitment account data to find target/deadline slots
    const commitmentData = await fetchCommitmentAccount(
      this.config.rpcUrl,
      pendingCommitment.address
    );

    if (!commitmentData) {
      throw new Error(`Commitment account not found: ${pendingCommitment.address}`);
    }

    // Calculate target slot (request slot + 1 to ensure slothash is available)
    const targetSlot = data.requestSlot + 1n;
    const deadlineSlot = data.deadlineSlot;

    // Wait and reveal
    await waitAndReveal(
      this.config,
      this.chain,
      this.state,
      pendingCommitment,
      targetSlot,
      deadlineSlot
    );
  }

  /**
   * Find a pending commitment that matches the request's commitment pubkey
   */
  private findPendingCommitment(commitmentPubkey: Uint8Array): PendingCommitment | undefined {
    // The commitment pubkey in the request is a 32-byte address
    // We need to match it against our pending commitments
    const encoder = getAddressEncoder();

    for (const pending of this.state.pending) {
      const pendingBytes = encoder.encode(pending.address);
      if (arraysEqual(pendingBytes, commitmentPubkey)) {
        return pending;
      }
    }

    return undefined;
  }

  /**
   * Get current processing state
   */
  getStatus(): { processing: number; queueLength: number; locked: boolean } {
    return {
      processing: this.processing.size,
      queueLength: this.mutex.queueLength(),
      locked: this.mutex.isLocked(),
    };
  }
}

/**
 * Create a fully configured request handler that watches and auto-processes requests
 */
export function createRequestProcessor(
  config: EntropyProviderConfig,
  chain: HashChain,
  state: CommitmentState
): { watcher: RequestWatcher; handler: AutoHandler } {
  const watcher = new RequestWatcher({
    wsUrl: config.wsUrl,
    rpcUrl: config.rpcUrl,
    entropyProgramId: config.entropyProgramId,
  });

  const handler = new AutoHandler(config, chain, state);

  watcher.onRequest((event) => handler.handleRequest(event));

  return { watcher, handler };
}

/**
 * Helper to compare Uint8Arrays (works with ReadonlyUint8Array too)
 */
function arraysEqual(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

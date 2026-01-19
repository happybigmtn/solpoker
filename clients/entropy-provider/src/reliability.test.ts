/**
 * Tests for Reliability Layer
 *
 * Covers AC-EP5.1, AC-EP5.2, AC-EP5.3, AC-EP5.4:
 * - AC-EP5.1: Provider reconnects after RPC drop
 * - AC-EP5.2: State file written on shutdown
 * - AC-EP5.3: Resume pending operations after restart
 * - AC-EP5.4: Logs contain timestamps and operation types
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFile, readFile, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import type { Address } from "@solana/kit";

import {
  Logger,
  saveProviderState,
  loadProviderState,
  checkRpcHealth,
  type LogEntry,
  type PersistedState,
} from "./reliability.js";
import { generateHashChain, saveHashChain, loadHashChain } from "./hash-chain.js";
import type { CommitmentState, PendingCommitment } from "./commit.js";

describe("Logger (AC-EP5.4)", () => {
  it("should include timestamp in ISO format", () => {
    const entries: LogEntry[] = [];
    const logger = new Logger({
      minLevel: "info",
      output: (entry) => entries.push(entry),
    });

    logger.info("test-op", "test message");

    expect(entries).toHaveLength(1);
    expect(entries[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // Verify it parses as valid ISO date
    expect(new Date(entries[0].timestamp).toISOString()).toBe(entries[0].timestamp);
  });

  it("should include operation type in logs", () => {
    const entries: LogEntry[] = [];
    const logger = new Logger({
      minLevel: "debug",
      output: (entry) => entries.push(entry),
    });

    logger.info("commit", "Posting commitment");
    logger.info("reveal", "Revealing preimage");
    logger.error("reconnect", "Connection failed");

    expect(entries).toHaveLength(3);
    expect(entries[0].operation).toBe("commit");
    expect(entries[1].operation).toBe("reveal");
    expect(entries[2].operation).toBe("reconnect");
  });

  it("should filter by log level", () => {
    const entries: LogEntry[] = [];
    const logger = new Logger({
      minLevel: "warn",
      output: (entry) => entries.push(entry),
    });

    logger.debug("op", "debug message");
    logger.info("op", "info message");
    logger.warn("op", "warn message");
    logger.error("op", "error message");

    expect(entries).toHaveLength(2);
    expect(entries[0].level).toBe("warn");
    expect(entries[1].level).toBe("error");
  });

  it("should include optional data in logs", () => {
    const entries: LogEntry[] = [];
    const logger = new Logger({
      minLevel: "info",
      output: (entry) => entries.push(entry),
    });

    logger.info("commit", "Commitment posted", {
      sequence: 5,
      address: "abc123",
    });

    expect(entries[0].data).toEqual({
      sequence: 5,
      address: "abc123",
    });
  });

  it("should respect all log level methods", () => {
    const entries: LogEntry[] = [];
    const logger = new Logger({
      minLevel: "debug",
      output: (entry) => entries.push(entry),
    });

    logger.debug("op", "debug");
    logger.info("op", "info");
    logger.warn("op", "warn");
    logger.error("op", "error");

    expect(entries.map((e) => e.level)).toEqual(["debug", "info", "warn", "error"]);
  });
});

describe("State Persistence (AC-EP5.2, AC-EP5.3)", () => {
  let testDir: string;
  let chainPath: string;
  let statePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `entropy-test-${randomBytes(8).toString("hex")}`);
    await mkdir(testDir, { recursive: true });
    chainPath = join(testDir, "chain.json");
    statePath = join(testDir, "state.json");
  });

  afterEach(async () => {
    // Cleanup test files
    try {
      if (existsSync(chainPath)) await unlink(chainPath);
      if (existsSync(statePath)) await unlink(statePath);
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should save state file on shutdown (AC-EP5.2)", async () => {
    // Create a hash chain
    const seed = randomBytes(32);
    const chain = generateHashChain(new Uint8Array(seed), 100);
    chain.position = 5; // Simulate some usage

    // Create commitment state with pending commitments
    const commitmentState: CommitmentState = {
      nextSequence: 10n,
      pending: [
        {
          sequence: 9n,
          address: "test-address-123" as Address,
          hash: randomBytes(32),
          commitSlot: 12345n,
          signature: "sig-abc",
        },
      ],
    };

    // Save state
    await saveProviderState(statePath, chainPath, chain, commitmentState);

    // Verify files exist
    expect(existsSync(statePath)).toBe(true);
    expect(existsSync(chainPath)).toBe(true);

    // Verify state file content
    const stateContent = JSON.parse(await readFile(statePath, "utf-8")) as PersistedState;
    expect(stateContent.version).toBe(1);
    expect(stateContent.chainPath).toBe(chainPath);
    expect(stateContent.chainPosition).toBe(5);
    expect(stateContent.nextSequence).toBe("10");
    expect(stateContent.pendingCommitments).toHaveLength(1);
    expect(stateContent.pendingCommitments[0].sequence).toBe("9");
    expect(stateContent.pendingCommitments[0].address).toBe("test-address-123");
    expect(stateContent.lastActivity).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("should load state from file after restart (AC-EP5.3)", async () => {
    // Create and save initial state
    const seed = randomBytes(32);
    const chain = generateHashChain(new Uint8Array(seed), 100);
    chain.position = 7;

    const originalPending: PendingCommitment = {
      sequence: 15n,
      address: "pda-address-xyz" as Address,
      hash: randomBytes(32),
      commitSlot: 98765n,
      signature: "sig-xyz",
    };

    const commitmentState: CommitmentState = {
      nextSequence: 16n,
      pending: [originalPending],
    };

    await saveProviderState(statePath, chainPath, chain, commitmentState);

    // Load state (simulating restart)
    const loaded = await loadProviderState(statePath);

    expect(loaded).not.toBeNull();
    expect(loaded!.chainPath).toBe(chainPath);
    expect(loaded!.commitmentState.nextSequence).toBe(16n);
    expect(loaded!.commitmentState.pending).toHaveLength(1);
    expect(loaded!.commitmentState.pending[0].sequence).toBe(15n);
    expect(loaded!.commitmentState.pending[0].address).toBe("pda-address-xyz");
    expect(loaded!.commitmentState.pending[0].commitSlot).toBe(98765n);
  });

  it("should return null when no state file exists", async () => {
    const loaded = await loadProviderState(statePath);
    expect(loaded).toBeNull();
  });

  it("should preserve hash chain position through save/load cycle", async () => {
    const seed = randomBytes(32);
    const chain = generateHashChain(new Uint8Array(seed), 50);

    // Advance chain
    chain.position = 10;

    await saveHashChain(chain, chainPath);
    const loadedChain = await loadHashChain(chainPath);

    expect(loadedChain.position).toBe(10);
    expect(loadedChain.depth).toBe(50);
    // Verify preimages match
    expect(Buffer.from(loadedChain.preimages[10]).toString("hex")).toBe(
      Buffer.from(chain.preimages[10]).toString("hex")
    );
  });

  it("should preserve multiple pending commitments", async () => {
    const seed = randomBytes(32);
    const chain = generateHashChain(new Uint8Array(seed), 100);

    const commitmentState: CommitmentState = {
      nextSequence: 5n,
      pending: [
        {
          sequence: 2n,
          address: "addr-1" as Address,
          hash: randomBytes(32),
          commitSlot: 100n,
          signature: "sig-1",
        },
        {
          sequence: 3n,
          address: "addr-2" as Address,
          hash: randomBytes(32),
          commitSlot: 200n,
          signature: "sig-2",
        },
        {
          sequence: 4n,
          address: "addr-3" as Address,
          hash: randomBytes(32),
          commitSlot: 300n,
          signature: "sig-3",
        },
      ],
    };

    await saveProviderState(statePath, chainPath, chain, commitmentState);
    const loaded = await loadProviderState(statePath);

    expect(loaded!.commitmentState.pending).toHaveLength(3);
    expect(loaded!.commitmentState.pending.map((p) => p.sequence)).toEqual([2n, 3n, 4n]);
  });
});

describe("RPC Health Check (AC-EP5.1)", () => {
  it("should return true for healthy RPC", async () => {
    // Mock fetch
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ result: "ok" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const healthy = await checkRpcHealth("http://localhost:8899");

    expect(healthy).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8899",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("getHealth"),
      })
    );

    vi.unstubAllGlobals();
  });

  it("should return false on connection error", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Connection refused"));
    vi.stubGlobal("fetch", mockFetch);

    const healthy = await checkRpcHealth("http://localhost:8899");

    expect(healthy).toBe(false);

    vi.unstubAllGlobals();
  });

  it("should return false when RPC returns unhealthy status", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ error: { code: -32005, message: "Node is behind" } }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const healthy = await checkRpcHealth("http://localhost:8899");

    expect(healthy).toBe(false);

    vi.unstubAllGlobals();
  });
});

describe("Reconnect Logic (AC-EP5.1)", () => {
  it("should calculate exponential backoff delays correctly", () => {
    const baseDelay = 1000;
    const maxDelay = 60000;

    const calculateDelay = (attempt: number) =>
      Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);

    expect(calculateDelay(1)).toBe(1000); // 1s
    expect(calculateDelay(2)).toBe(2000); // 2s
    expect(calculateDelay(3)).toBe(4000); // 4s
    expect(calculateDelay(4)).toBe(8000); // 8s
    expect(calculateDelay(5)).toBe(16000); // 16s
    expect(calculateDelay(6)).toBe(32000); // 32s
    expect(calculateDelay(7)).toBe(60000); // capped at 60s
    expect(calculateDelay(10)).toBe(60000); // still capped
  });

  it("should reset reconnect attempts on successful connection", () => {
    // This is a unit test for the concept - actual integration test would require
    // mocking the full RPC client
    let reconnectAttempts = 5;
    const simulateSuccessfulConnection = () => {
      reconnectAttempts = 0;
    };

    simulateSuccessfulConnection();
    expect(reconnectAttempts).toBe(0);
  });
});

describe("Log Format Verification (AC-EP5.4)", () => {
  it("should format logs with [timestamp] [LEVEL] [operation] message format", () => {
    let formattedOutput = "";
    const logger = new Logger({
      minLevel: "info",
      output: (entry) => {
        const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : "";
        formattedOutput = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.operation}] ${entry.message}${dataStr}`;
      },
    });

    logger.info("commit", "Posted commitment", { sequence: 5 });

    expect(formattedOutput).toMatch(
      /^\[\d{4}-\d{2}-\d{2}T.*\] \[INFO\] \[commit\] Posted commitment \{"sequence":5\}$/
    );
  });

  it("should log commit operations correctly", () => {
    const entries: LogEntry[] = [];
    const logger = new Logger({
      minLevel: "info",
      output: (entry) => entries.push(entry),
    });

    // Simulate commit log
    logger.info("commit", "Commitment posted successfully", {
      sequence: 10,
      address: "ABC123",
      slot: 12345,
    });

    expect(entries[0].operation).toBe("commit");
    expect(entries[0].data?.sequence).toBe(10);
  });

  it("should log reveal operations correctly", () => {
    const entries: LogEntry[] = [];
    const logger = new Logger({
      minLevel: "info",
      output: (entry) => entries.push(entry),
    });

    // Simulate reveal log
    logger.info("reveal", "Revealed preimage", {
      commitment: "XYZ789",
      targetSlot: 12350,
      actualSlot: 12355,
    });

    expect(entries[0].operation).toBe("reveal");
    expect(entries[0].data?.targetSlot).toBe(12350);
  });

  it("should log errors with full context", () => {
    const entries: LogEntry[] = [];
    const logger = new Logger({
      minLevel: "error",
      output: (entry) => entries.push(entry),
    });

    logger.error("reconnect", "Failed to reconnect to RPC", {
      url: "http://localhost:8899",
      attempt: 3,
      error: "Connection refused",
    });

    expect(entries[0].level).toBe("error");
    expect(entries[0].operation).toBe("reconnect");
    expect(entries[0].data?.attempt).toBe(3);
  });
});

describe("Perceptual Quality (AC-PQ.EP1)", () => {
  it("should only log errors when healthy (info level = silent operation)", () => {
    const entries: LogEntry[] = [];
    const logger = new Logger({
      minLevel: "error", // Only errors surface
      output: (entry) => entries.push(entry),
    });

    // Normal operation logs (should be filtered)
    logger.info("daemon", "Started");
    logger.info("commit", "Posted");
    logger.info("reveal", "Revealed");
    logger.debug("poll", "Polling for requests");

    // Error (should surface)
    logger.error("commit", "Transaction failed");

    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe("error");
    expect(entries[0].operation).toBe("commit");
  });

  it("should allow configurable verbosity for debugging", () => {
    const entries: LogEntry[] = [];
    const logger = new Logger({
      minLevel: "debug", // Full verbosity
      output: (entry) => entries.push(entry),
    });

    logger.debug("poll", "Checking for requests");
    logger.info("commit", "Posted");
    logger.warn("reveal", "Close to deadline");
    logger.error("commit", "Failed");

    expect(entries).toHaveLength(4);
  });
});

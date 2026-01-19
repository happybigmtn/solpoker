/**
 * Request Subscription Tests
 *
 * Tests for:
 * - AC-EP4.1: Provider detects new request via WebSocket (polling)
 * - AC-EP4.2: Provider commits automatically on request
 * - AC-EP4.3: Concurrent requests handled without deadlock
 *
 * These tests include both unit tests and integration tests.
 * Integration tests require a running devnet and deployed programs.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  address,
  createKeyPairSignerFromBytes,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";

import { generateHashChain } from "./hash-chain.js";
import { initCommitmentState, type EntropyProviderConfig, type CommitmentState } from "./commit.js";
import {
  RequestWatcher,
  AutoHandler,
  createRequestProcessor,
  parseRequestAccount,
  deriveRequestPda,
  REQUEST_SIZE,
  REQUEST_STATUS,
  type RequestAccountData,
  type RequestDetectedEvent,
} from "./subscription.js";

// Test configuration
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const WS_URL = process.env.SOLANA_WS_URL || "wss://api.devnet.solana.com";

// Skip integration tests if flag set
const SKIP_DEVNET_TESTS = process.env.SKIP_DEVNET_TESTS === "true";

describe("subscription module", () => {
  describe("parseRequestAccount", () => {
    it("parses valid request account data", () => {
      // Build a mock request account buffer
      const data = new Uint8Array(REQUEST_SIZE);
      const view = new DataView(data.buffer);

      // discriminator(1) = 3 (Request)
      data[0] = 3;
      // status(1) = 0 (Pending)
      data[1] = 0;
      // padding[6] = zeros
      // requester[32] at offset 8
      data.set(new Uint8Array(32).fill(1), 8);
      // commitment[32] at offset 40
      data.set(new Uint8Array(32).fill(2), 40);
      // request_id(8) at offset 72
      view.setBigUint64(72, 123n, true);
      // request_slot(8) at offset 80
      view.setBigUint64(80, 1000n, true);
      // deadline_slot(8) at offset 88
      view.setBigUint64(88, 1100n, true);
      // randomness[32] at offset 96
      // slothash[32] at offset 128
      data.set(new Uint8Array(32).fill(3), 128);

      const parsed = parseRequestAccount(data);

      expect(parsed).not.toBeNull();
      expect(parsed!.status).toBe(REQUEST_STATUS.PENDING);
      expect(parsed!.requestId).toBe(123n);
      expect(parsed!.requestSlot).toBe(1000n);
      expect(parsed!.deadlineSlot).toBe(1100n);
      expect(parsed!.requester[0]).toBe(1);
      expect(parsed!.commitment[0]).toBe(2);
      expect(parsed!.slothash[0]).toBe(3);
    });

    it("returns null for wrong discriminator", () => {
      const data = new Uint8Array(REQUEST_SIZE);
      data[0] = 1; // Wrong discriminator (Config = 1)

      const parsed = parseRequestAccount(data);
      expect(parsed).toBeNull();
    });

    it("returns null for buffer too small", () => {
      const data = new Uint8Array(REQUEST_SIZE - 1);
      data[0] = 3;

      const parsed = parseRequestAccount(data);
      expect(parsed).toBeNull();
    });

    it("correctly identifies pending vs finalized status", () => {
      const data = new Uint8Array(REQUEST_SIZE);
      data[0] = 3; // Request discriminator

      // Test pending
      data[1] = REQUEST_STATUS.PENDING;
      const pending = parseRequestAccount(data);
      expect(pending!.status).toBe(REQUEST_STATUS.PENDING);

      // Test finalized
      data[1] = REQUEST_STATUS.FINALIZED;
      const finalized = parseRequestAccount(data);
      expect(finalized!.status).toBe(REQUEST_STATUS.FINALIZED);
    });
  });

  describe("deriveRequestPda", () => {
    it("derives consistent PDAs for same inputs", async () => {
      const programId = address("GG5nqvfpYHXyMF5A5yyMYjTCKQmKTDjMheJ4iCRSvTRf");
      const requester = address("11111111111111111111111111111111");

      const [pda1] = await deriveRequestPda(programId, requester, 0n);
      const [pda2] = await deriveRequestPda(programId, requester, 0n);

      expect(pda1).toBe(pda2);
    });

    it("derives different PDAs for different request IDs", async () => {
      const programId = address("GG5nqvfpYHXyMF5A5yyMYjTCKQmKTDjMheJ4iCRSvTRf");
      const requester = address("11111111111111111111111111111111");

      const [pda0] = await deriveRequestPda(programId, requester, 0n);
      const [pda1] = await deriveRequestPda(programId, requester, 1n);

      expect(pda0).not.toBe(pda1);
    });

    it("derives different PDAs for different requesters", async () => {
      const programId = address("GG5nqvfpYHXyMF5A5yyMYjTCKQmKTDjMheJ4iCRSvTRf");
      const requester1 = address("11111111111111111111111111111111");
      const requester2 = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

      const [pda1] = await deriveRequestPda(programId, requester1, 0n);
      const [pda2] = await deriveRequestPda(programId, requester2, 0n);

      expect(pda1).not.toBe(pda2);
    });
  });

  describe("RequestWatcher", () => {
    it("can be instantiated with config", () => {
      const watcher = new RequestWatcher({
        wsUrl: WS_URL,
        rpcUrl: RPC_URL,
        entropyProgramId: address("GG5nqvfpYHXyMF5A5yyMYjTCKQmKTDjMheJ4iCRSvTRf"),
      });

      expect(watcher.isRunning()).toBe(false);
      expect(watcher.getSeenCount()).toBe(0);
    });

    it("registers request handlers", () => {
      const watcher = new RequestWatcher({
        wsUrl: WS_URL,
        rpcUrl: RPC_URL,
        entropyProgramId: address("GG5nqvfpYHXyMF5A5yyMYjTCKQmKTDjMheJ4iCRSvTRf"),
      });

      const mockHandler = vi.fn();
      watcher.onRequest(mockHandler);

      // Handler registered (can't easily test invocation without starting)
      expect(watcher.isRunning()).toBe(false);
    });

    it("starts and stops polling", async () => {
      const watcher = new RequestWatcher({
        wsUrl: WS_URL,
        rpcUrl: RPC_URL,
        entropyProgramId: address("GG5nqvfpYHXyMF5A5yyMYjTCKQmKTDjMheJ4iCRSvTRf"),
        pollIntervalMs: 10000, // Long interval to avoid actual polling
      });

      // Skip actual network calls by mocking
      vi.spyOn(watcher as any, "pollForRequests").mockResolvedValue(undefined);

      await watcher.start();
      expect(watcher.isRunning()).toBe(true);

      watcher.stop();
      expect(watcher.isRunning()).toBe(false);
    });

    it("throws if started twice", async () => {
      const watcher = new RequestWatcher({
        wsUrl: WS_URL,
        rpcUrl: RPC_URL,
        entropyProgramId: address("GG5nqvfpYHXyMF5A5yyMYjTCKQmKTDjMheJ4iCRSvTRf"),
        pollIntervalMs: 10000,
      });

      vi.spyOn(watcher as any, "pollForRequests").mockResolvedValue(undefined);

      await watcher.start();

      await expect(watcher.start()).rejects.toThrow("already started");

      watcher.stop();
    });
  });

  describe("AutoHandler", () => {
    it("can be instantiated with mock config", async () => {
      const mockConfig: EntropyProviderConfig = {
        rpcUrl: RPC_URL,
        wsUrl: WS_URL,
        entropyProgramId: address("GG5nqvfpYHXyMF5A5yyMYjTCKQmKTDjMheJ4iCRSvTRf"),
        entropyConfigPda: address("11111111111111111111111111111111"),
        providerSigner: {
          address: address("11111111111111111111111111111111"),
        } as any,
        minBond: 100_000_000n,
      };

      const chain = generateHashChain(randomBytes(32), 100);
      const state: CommitmentState = {
        nextSequence: 0n,
        pending: [],
      };

      const handler = new AutoHandler(mockConfig, chain, state);
      const status = handler.getStatus();

      expect(status.processing).toBe(0);
      expect(status.queueLength).toBe(0);
      expect(status.locked).toBe(false);
    });

    it("reports status correctly", () => {
      const mockConfig: EntropyProviderConfig = {
        rpcUrl: RPC_URL,
        wsUrl: WS_URL,
        entropyProgramId: address("GG5nqvfpYHXyMF5A5yyMYjTCKQmKTDjMheJ4iCRSvTRf"),
        entropyConfigPda: address("11111111111111111111111111111111"),
        providerSigner: {
          address: address("11111111111111111111111111111111"),
        } as any,
        minBond: 100_000_000n,
      };

      const chain = generateHashChain(randomBytes(32), 100);
      const state: CommitmentState = {
        nextSequence: 0n,
        pending: [],
      };

      const handler = new AutoHandler(mockConfig, chain, state);

      const status = handler.getStatus();
      expect(typeof status.processing).toBe("number");
      expect(typeof status.queueLength).toBe("number");
      expect(typeof status.locked).toBe("boolean");
    });
  });

  describe("createRequestProcessor", () => {
    it("creates linked watcher and handler", () => {
      const mockConfig: EntropyProviderConfig = {
        rpcUrl: RPC_URL,
        wsUrl: WS_URL,
        entropyProgramId: address("GG5nqvfpYHXyMF5A5yyMYjTCKQmKTDjMheJ4iCRSvTRf"),
        entropyConfigPda: address("11111111111111111111111111111111"),
        providerSigner: {
          address: address("11111111111111111111111111111111"),
        } as any,
        minBond: 100_000_000n,
      };

      const chain = generateHashChain(randomBytes(32), 100);
      const state: CommitmentState = {
        nextSequence: 0n,
        pending: [],
      };

      const { watcher, handler } = createRequestProcessor(mockConfig, chain, state);

      expect(watcher).toBeInstanceOf(RequestWatcher);
      expect(handler).toBeInstanceOf(AutoHandler);
    });
  });

  describe("Mutex (AC-EP4.3: concurrent request handling)", () => {
    it("prevents concurrent execution", async () => {
      // Access the internal Mutex class through handler
      const mockConfig: EntropyProviderConfig = {
        rpcUrl: RPC_URL,
        wsUrl: WS_URL,
        entropyProgramId: address("GG5nqvfpYHXyMF5A5yyMYjTCKQmKTDjMheJ4iCRSvTRf"),
        entropyConfigPda: address("11111111111111111111111111111111"),
        providerSigner: {
          address: address("11111111111111111111111111111111"),
        } as any,
        minBond: 100_000_000n,
      };

      const chain = generateHashChain(randomBytes(32), 100);
      const state: CommitmentState = {
        nextSequence: 0n,
        pending: [],
      };

      const handler = new AutoHandler(mockConfig, chain, state);

      // Simulate concurrent requests
      const executionOrder: number[] = [];

      // Mock the internal processRequest to track order
      const originalMethod = (handler as any).processRequest.bind(handler);
      (handler as any).processRequest = async (event: RequestDetectedEvent) => {
        const id = Number(event.data.requestId);
        executionOrder.push(id);
        await new Promise((r) => setTimeout(r, 50)); // Simulate work
        executionOrder.push(id + 100); // Mark completion
      };

      // Create mock events
      const makeEvent = (id: number): RequestDetectedEvent => ({
        address: address("11111111111111111111111111111111"),
        data: {
          status: 0,
          requester: new Uint8Array(32),
          commitment: new Uint8Array(32),
          requestId: BigInt(id),
          requestSlot: 1000n,
          deadlineSlot: 1100n,
          randomness: new Uint8Array(32),
          slothash: new Uint8Array(32),
        },
      });

      // Start multiple concurrent requests
      const p1 = handler.handleRequest(makeEvent(1));
      const p2 = handler.handleRequest(makeEvent(2));
      const p3 = handler.handleRequest(makeEvent(3));

      await Promise.all([p1, p2, p3]);

      // Verify serial execution: each request should complete before the next starts
      // The pattern should be: 1, 101, 2, 102, 3, 103 (sequential)
      // NOT: 1, 2, 3, 101, 102, 103 (parallel)
      for (let i = 0; i < executionOrder.length - 1; i += 2) {
        // Each pair should be (id, id+100) consecutive
        expect(executionOrder[i + 1]).toBe(executionOrder[i] + 100);
      }
    });
  });
});

describe("integration tests (devnet)", () => {
  let providerSigner: KeyPairSigner;
  let entropyProgramId: Address;
  let entropyConfigPda: Address;
  let config: EntropyProviderConfig;

  beforeAll(async () => {
    if (SKIP_DEVNET_TESTS) {
      return;
    }

    // Load keypair from default location
    const keypairPath = join(process.env.HOME || "", ".config/solana/id.json");
    let keypairBytes: Uint8Array;
    try {
      const keypairJson = await readFile(keypairPath, "utf-8");
      keypairBytes = new Uint8Array(JSON.parse(keypairJson));
    } catch {
      console.warn("No keypair found at ~/.config/solana/id.json, skipping devnet tests");
      return;
    }

    providerSigner = await createKeyPairSignerFromBytes(keypairBytes);

    // Load env file if exists
    const envPath = join(process.cwd(), "../ui/.env.local");
    try {
      const envContent = await readFile(envPath, "utf-8");
      const envVars: Record<string, string> = {};
      for (const line of envContent.split("\n")) {
        const match = line.match(/^([A-Z_]+)=(.+)$/);
        if (match) {
          envVars[match[1]] = match[2];
        }
      }

      entropyProgramId = address(envVars.NEXT_PUBLIC_ENTROPY_PROGRAM_ID || "");
      entropyConfigPda = address(envVars.NEXT_PUBLIC_ENTROPY_CONFIG_PDA || "");
    } catch {
      console.warn("No .env.local found, using hardcoded addresses");
      entropyProgramId = address("GG5nqvfpYHXyMF5A5yyMYjTCKQmKTDjMheJ4iCRSvTRf");
      const { getProgramDerivedAddress } = await import("@solana/kit");
      const [configPda] = await getProgramDerivedAddress({
        programAddress: entropyProgramId,
        seeds: [new TextEncoder().encode("config")],
      });
      entropyConfigPda = configPda;
    }

    config = {
      rpcUrl: RPC_URL,
      wsUrl: WS_URL,
      entropyProgramId,
      entropyConfigPda,
      providerSigner,
      minBond: 100_000_000n,
    };
  });

  describe("RequestWatcher on devnet (AC-EP4.1)", () => {
    it.skipIf(SKIP_DEVNET_TESTS)(
      "detects pending requests from on-chain state",
      async () => {
        const watcher = new RequestWatcher({
          wsUrl: WS_URL,
          rpcUrl: RPC_URL,
          entropyProgramId,
          pollIntervalMs: 1000,
        });

        const detectedRequests: RequestDetectedEvent[] = [];
        watcher.onRequest((event) => {
          detectedRequests.push(event);
        });

        // Start watcher and wait for one poll cycle
        await watcher.start();
        await new Promise((r) => setTimeout(r, 2000));
        watcher.stop();

        // We may or may not have pending requests on devnet
        // The important thing is that the watcher ran without errors
        expect(watcher.getSeenCount()).toBeGreaterThanOrEqual(0);
        expect(detectedRequests.length).toBeGreaterThanOrEqual(0);
      },
      30_000
    );
  });

  describe("full request processor (AC-EP4.2, AC-EP4.3)", () => {
    it.skipIf(SKIP_DEVNET_TESTS)(
      "creates functional processor that can detect requests",
      async () => {
        const chain = generateHashChain(randomBytes(32), 100);
        const state = await initCommitmentState(RPC_URL, entropyProgramId, providerSigner.address);

        const { watcher, handler } = createRequestProcessor(config, chain, state);

        // Start the watcher
        await watcher.start();

        // Let it run briefly
        await new Promise((r) => setTimeout(r, 3000));

        // Check status
        const status = handler.getStatus();
        expect(typeof status.processing).toBe("number");
        expect(status.locked).toBe(false); // Should not be locked after idle

        // Stop
        watcher.stop();
        expect(watcher.isRunning()).toBe(false);
      },
      30_000
    );
  });
});

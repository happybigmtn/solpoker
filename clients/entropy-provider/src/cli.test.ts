/**
 * CLI Tests for Entropy Provider
 *
 * Tests AC-EP6.1, AC-EP6.2, AC-EP6.3:
 * - AC-EP6.1: `generate` creates chain file
 * - AC-EP6.2: `start` launches daemon (tested via config validation)
 * - AC-EP6.3: `status` outputs JSON with position and pending count
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadHashChain, generateHashChain, saveHashChain } from "./hash-chain.js";
import { saveProviderState, loadProviderState } from "./reliability.js";
import type { CommitmentState } from "./commit.js";
import type { HashChain } from "./hash-chain.js";

/**
 * Run CLI command and capture output
 */
async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn("npx", ["tsx", "src/main.ts", ...args], {
      cwd: join(import.meta.dirname, ".."),
      env: { ...process.env, NODE_ENV: "test" },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

describe("CLI: generate command (AC-EP6.1)", () => {
  let tempDir: string;
  let chainPath: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `entropy-provider-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    chainPath = join(tempDir, "test-chain.json");
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
  });

  it("creates a chain file with default depth", async () => {
    const result = await runCli(["generate", "-o", chainPath]);

    expect(result.code).toBe(0);
    expect(existsSync(chainPath)).toBe(true);

    const chain = await loadHashChain(chainPath);
    expect(chain.depth).toBe(10_000); // DEFAULT_CHAIN_DEPTH
    expect(chain.position).toBe(0);
    expect(chain.preimages.length).toBe(10_000);
  });

  it("creates a chain file with custom depth", async () => {
    const result = await runCli(["generate", "-o", chainPath, "-d", "100"]);

    expect(result.code).toBe(0);
    expect(existsSync(chainPath)).toBe(true);

    const chain = await loadHashChain(chainPath);
    expect(chain.depth).toBe(100);
    expect(chain.position).toBe(0);
    expect(chain.preimages.length).toBe(100);
  });

  it("creates a chain file with provided seed", async () => {
    const seed = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const result = await runCli(["generate", "-o", chainPath, "-d", "10", "-s", seed]);

    expect(result.code).toBe(0);
    expect(existsSync(chainPath)).toBe(true);

    // Generate with same seed and verify match
    const chain = await loadHashChain(chainPath);
    expect(chain.depth).toBe(10);
  });

  it("outputs chain information on success", async () => {
    const result = await runCli(["generate", "-o", chainPath, "-d", "50"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Generating hash chain");
    expect(result.stdout).toContain("depth 50");
    expect(result.stdout).toContain("Chain depth: 50");
    expect(result.stdout).toContain("Current position: 0");
    expect(result.stdout).toContain("Remaining entries: 50");
  });

  it("fails with invalid depth", async () => {
    const result = await runCli(["generate", "-o", chainPath, "-d", "invalid"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Invalid chain depth");
  });

  it("fails with invalid seed hex", async () => {
    const result = await runCli(["generate", "-o", chainPath, "-s", "not-valid-hex!"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Invalid seed hex");
  });
});

describe("CLI: start command (AC-EP6.2)", () => {
  let tempDir: string;
  let chainPath: string;
  let keypairPath: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `entropy-provider-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    chainPath = join(tempDir, "test-chain.json");
    keypairPath = join(tempDir, "keypair.json");

    // Create a test chain file
    const chain = generateHashChain(new Uint8Array(32), 10);
    await saveHashChain(chain, chainPath);

    // Create a test keypair file (64 bytes: 32 private + 32 public)
    const keypairBytes = new Uint8Array(64);
    for (let i = 0; i < 64; i++) {
      keypairBytes[i] = i;
    }
    await writeFile(keypairPath, JSON.stringify(Array.from(keypairBytes)));
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
  });

  it("requires --chain option", async () => {
    const result = await runCli(["start", "-k", keypairPath, "-p", "11111111111111111111111111111111"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--chain");
  });

  it("requires --keypair option", async () => {
    const result = await runCli(["start", "-c", chainPath, "-p", "11111111111111111111111111111111"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--keypair");
  });

  it("requires --program option", async () => {
    const result = await runCli(["start", "-c", chainPath, "-k", keypairPath]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--program");
  });

  it("fails if chain file does not exist", async () => {
    const result = await runCli([
      "start",
      "-c",
      join(tempDir, "nonexistent.json"),
      "-k",
      keypairPath,
      "-p",
      "11111111111111111111111111111111",
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Chain file not found");
  });

  it("fails if keypair file does not exist", async () => {
    const result = await runCli([
      "start",
      "-c",
      chainPath,
      "-k",
      join(tempDir, "nonexistent.json"),
      "-p",
      "11111111111111111111111111111111",
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Failed to load keypair");
  });

  // Note: We don't test actual daemon startup since it requires RPC connection.
  // The validation tests above verify AC-EP6.2's CLI behavior.
});

describe("CLI: status command (AC-EP6.3)", () => {
  let tempDir: string;
  let chainPath: string;
  let statePath: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `entropy-provider-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    chainPath = join(tempDir, "test-chain.json");
    statePath = join(tempDir, "provider-state.json");
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
  });

  it("outputs JSON with position and pending count when --json flag provided", async () => {
    // Create a chain file
    const chain = generateHashChain(new Uint8Array(32), 100);
    chain.position = 25; // Advance position
    await saveHashChain(chain, chainPath);

    // Create a state file with pending commitments
    const commitmentState: CommitmentState = {
      nextSequence: 5n,
      pending: [
        {
          sequence: 3n,
          address: "11111111111111111111111111111111" as any,
          hash: new Uint8Array(32),
          commitSlot: 1000n,
          signature: "sig1",
        },
        {
          sequence: 4n,
          address: "22222222222222222222222222222222" as any,
          hash: new Uint8Array(32),
          commitSlot: 1100n,
          signature: "sig2",
        },
      ],
    };
    await saveProviderState(statePath, chainPath, chain, commitmentState);

    const result = await runCli(["status", "-c", chainPath, "-s", statePath, "--json"]);

    expect(result.code).toBe(0);

    const status = JSON.parse(result.stdout);
    expect(status.position).toBe(25);
    expect(status.depth).toBe(100);
    expect(status.remaining).toBe(75);
    expect(status.pending).toBe(2);
    expect(status.lastActivity).toBeDefined();
  });

  it("outputs human-readable format by default", async () => {
    const chain = generateHashChain(new Uint8Array(32), 50);
    await saveHashChain(chain, chainPath);

    const result = await runCli(["status", "-c", chainPath]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Entropy Provider Status");
    expect(result.stdout).toContain("Chain position:");
    expect(result.stdout).toContain("Chain depth:");
    expect(result.stdout).toContain("Remaining:");
    expect(result.stdout).toContain("Pending commits:");
  });

  it("handles missing state file gracefully", async () => {
    const result = await runCli(["status", "-s", join(tempDir, "nonexistent.json"), "--json"]);

    expect(result.code).toBe(0);
    const status = JSON.parse(result.stdout);
    expect(status.position).toBe(0);
    expect(status.pending).toBe(0);
  });

  it("uses state file path from loaded state", async () => {
    // Create a chain file in a different location
    const chain = generateHashChain(new Uint8Array(32), 200);
    chain.position = 42;
    await saveHashChain(chain, chainPath);

    // Create state file that references the chain
    const commitmentState: CommitmentState = {
      nextSequence: 1n,
      pending: [],
    };
    await saveProviderState(statePath, chainPath, chain, commitmentState);

    // Only provide state path, let it find chain path
    const result = await runCli(["status", "-s", statePath, "--json"]);

    expect(result.code).toBe(0);
    const status = JSON.parse(result.stdout);
    expect(status.position).toBe(42);
    expect(status.depth).toBe(200);
  });
});

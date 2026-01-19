/**
 * Tests for PDA derivation utilities (AC-CI1.3, AC-CI1.4)
 *
 * Verifies that TypeScript PDA derivations match the expected addresses
 * using the same seeds as the Rust programs.
 */

import { describe, it, expect } from "vitest";
import { address } from "@solana/kit";
import {
  derivePokerConfigPda,
  deriveTablePda,
  deriveVaultPda,
  deriveStakingPoolPda,
  deriveStakerPositionPda,
  deriveStakeVaultPda,
  deriveRewardsVaultPda,
  deriveEntropyConfigPda,
  deriveCommitmentPda,
  deriveRequestPda,
} from "./pda.js";

// Test program IDs - using known deployed addresses
const POKER_PROGRAM_ID = address("3oG9MCSnE7UJDQKzEoJdmHrZ3qA7Y5ADdWbYqH1KpxLv");
const ENTROPY_PROGRAM_ID = address("GG5nqvfpYHXyMF5A5yyMYjTCKQmKTDjMheJ4iCRSvTRf");
const TEST_PROVIDER = address("H23jVpt1CPdGSoHPb3mE8nxsWYbWrZMCgkLT1qLGAJMG");
const TEST_STAKER = address("H23jVpt1CPdGSoHPb3mE8nxsWYbWrZMCgkLT1qLGAJMG");

describe("Poker Program PDA Derivations", () => {
  describe("derivePokerConfigPda", () => {
    it("should derive a valid PDA from 'config' seed", async () => {
      const [pda, bump] = await derivePokerConfigPda(POKER_PROGRAM_ID);

      // The PDA should be a valid 32-byte base58 address
      expect(pda).toBeDefined();
      expect(typeof pda).toBe("string");
      expect(pda.length).toBeGreaterThan(30);

      // Bump should be in valid range (0-255)
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);
    });

    it("should be deterministic", async () => {
      const [pda1] = await derivePokerConfigPda(POKER_PROGRAM_ID);
      const [pda2] = await derivePokerConfigPda(POKER_PROGRAM_ID);

      expect(pda1).toBe(pda2);
    });

    it("should produce different PDAs for different programs", async () => {
      const [pda1] = await derivePokerConfigPda(POKER_PROGRAM_ID);
      const [pda2] = await derivePokerConfigPda(ENTROPY_PROGRAM_ID);

      expect(pda1).not.toBe(pda2);
    });

    it("matches known config PDA", async () => {
      const [pda] = await derivePokerConfigPda(POKER_PROGRAM_ID);
      expect(pda).toBe("3KnseNHo2AF449D9z5WaXQ6Lnc77bAhddMbWe1fgbrKk");
    });
  });

  describe("deriveTablePda", () => {
    it("should derive different PDAs for different table IDs", async () => {
      const [pda1] = await deriveTablePda(POKER_PROGRAM_ID, 0n);
      const [pda2] = await deriveTablePda(POKER_PROGRAM_ID, 1n);
      const [pda3] = await deriveTablePda(POKER_PROGRAM_ID, 12345n);

      expect(pda1).not.toBe(pda2);
      expect(pda2).not.toBe(pda3);
    });

    it("should be deterministic for same table ID", async () => {
      const [pda1] = await deriveTablePda(POKER_PROGRAM_ID, 42n);
      const [pda2] = await deriveTablePda(POKER_PROGRAM_ID, 42n);

      expect(pda1).toBe(pda2);
    });

    it("should handle large table IDs", async () => {
      const largeId = 18446744073709551615n; // max u64
      const [pda, bump] = await deriveTablePda(POKER_PROGRAM_ID, largeId);

      expect(pda).toBeDefined();
      expect(bump).toBeGreaterThanOrEqual(0);
    });

    it("matches known table PDA for id 42", async () => {
      const [pda] = await deriveTablePda(POKER_PROGRAM_ID, 42n);
      expect(pda).toBe("2fZyXAiFNzzPdngpfmPXenWgD9pMge3FkqZkCie1ZU7g");
    });
  });

  describe("deriveVaultPda", () => {
    it("should derive vault PDA for table", async () => {
      const tableId = 123n;
      const [vaultPda] = await deriveVaultPda(POKER_PROGRAM_ID, tableId);
      const [tablePda] = await deriveTablePda(POKER_PROGRAM_ID, tableId);

      // Vault and table PDAs should be different
      expect(vaultPda).not.toBe(tablePda);
    });

    it("should be deterministic", async () => {
      const [pda1] = await deriveVaultPda(POKER_PROGRAM_ID, 99n);
      const [pda2] = await deriveVaultPda(POKER_PROGRAM_ID, 99n);

      expect(pda1).toBe(pda2);
    });

    it("matches known vault PDA for id 42", async () => {
      const [pda] = await deriveVaultPda(POKER_PROGRAM_ID, 42n);
      expect(pda).toBe("FyPb4QguPtpSwEzGKUUj1b2v1fjrZiARe7yUVxnTdVG6");
    });
  });

  describe("deriveStakingPoolPda", () => {
    it("should derive a valid staking pool PDA", async () => {
      const [pda, bump] = await deriveStakingPoolPda(POKER_PROGRAM_ID);

      expect(pda).toBeDefined();
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);
    });

    it("should be different from config PDA", async () => {
      const [poolPda] = await deriveStakingPoolPda(POKER_PROGRAM_ID);
      const [configPda] = await derivePokerConfigPda(POKER_PROGRAM_ID);

      expect(poolPda).not.toBe(configPda);
    });

    it("matches known staking pool PDA", async () => {
      const [pda] = await deriveStakingPoolPda(POKER_PROGRAM_ID);
      expect(pda).toBe("BXPYTtYpzWiVDAzRv6WAY4giaLfykBjPE4Ut7dGh2E2x");
    });
  });

  describe("deriveStakerPositionPda", () => {
    it("should derive different PDAs for different stakers", async () => {
      const staker1 = address("H23jVpt1CPdGSoHPb3mE8nxsWYbWrZMCgkLT1qLGAJMG");
      const staker2 = address("11111111111111111111111111111111");

      const [pda1] = await deriveStakerPositionPda(POKER_PROGRAM_ID, staker1);
      const [pda2] = await deriveStakerPositionPda(POKER_PROGRAM_ID, staker2);

      expect(pda1).not.toBe(pda2);
    });

    it("should be deterministic for same staker", async () => {
      const [pda1] = await deriveStakerPositionPda(POKER_PROGRAM_ID, TEST_STAKER);
      const [pda2] = await deriveStakerPositionPda(POKER_PROGRAM_ID, TEST_STAKER);

      expect(pda1).toBe(pda2);
    });

    it("matches known staker position PDA", async () => {
      const [pda] = await deriveStakerPositionPda(POKER_PROGRAM_ID, TEST_STAKER);
      expect(pda).toBe("5tKUkzAXpigMmEJPSwD9NErjdHK3kpax6bTFMg2uGuPK");
    });
  });

  describe("deriveStakeVaultPda", () => {
    it("should derive a valid stake vault PDA", async () => {
      const [pda, bump] = await deriveStakeVaultPda(POKER_PROGRAM_ID);

      expect(pda).toBeDefined();
      expect(bump).toBeGreaterThanOrEqual(0);
    });

    it("matches known stake vault PDA", async () => {
      const [pda] = await deriveStakeVaultPda(POKER_PROGRAM_ID);
      expect(pda).toBe("GHGU5mfoNaL7vWWJxs9UNhVJBvYgPUGUCzunoXGHr2rK");
    });
  });

  describe("deriveRewardsVaultPda", () => {
    it("should derive a valid rewards vault PDA", async () => {
      const [pda, bump] = await deriveRewardsVaultPda(POKER_PROGRAM_ID);

      expect(pda).toBeDefined();
      expect(bump).toBeGreaterThanOrEqual(0);
    });

    it("should be different from stake vault PDA", async () => {
      const [rewardsPda] = await deriveRewardsVaultPda(POKER_PROGRAM_ID);
      const [stakePda] = await deriveStakeVaultPda(POKER_PROGRAM_ID);

      expect(rewardsPda).not.toBe(stakePda);
    });

    it("matches known rewards vault PDA", async () => {
      const [pda] = await deriveRewardsVaultPda(POKER_PROGRAM_ID);
      expect(pda).toBe("GMS8P1oUhUbv8RgZ32MABWBCJKntxN26iEjmgFJe8TTv");
    });
  });
});

describe("Entropy Program PDA Derivations", () => {
  describe("deriveEntropyConfigPda", () => {
    it("should derive a valid entropy config PDA", async () => {
      const [pda, bump] = await deriveEntropyConfigPda(ENTROPY_PROGRAM_ID);

      expect(pda).toBeDefined();
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);
    });

    it("should be deterministic", async () => {
      const [pda1] = await deriveEntropyConfigPda(ENTROPY_PROGRAM_ID);
      const [pda2] = await deriveEntropyConfigPda(ENTROPY_PROGRAM_ID);

      expect(pda1).toBe(pda2);
    });

    it("matches known entropy config PDA", async () => {
      const [pda] = await deriveEntropyConfigPda(ENTROPY_PROGRAM_ID);
      expect(pda).toBe("4KoZtJGw1CPqY5diQFsqbt4FMHuz4iGU8Z9cEp9z34yJ");
    });
  });

  describe("deriveCommitmentPda", () => {
    it("should derive different PDAs for different sequences", async () => {
      const [pda1] = await deriveCommitmentPda(ENTROPY_PROGRAM_ID, TEST_PROVIDER, 0n);
      const [pda2] = await deriveCommitmentPda(ENTROPY_PROGRAM_ID, TEST_PROVIDER, 1n);
      const [pda3] = await deriveCommitmentPda(ENTROPY_PROGRAM_ID, TEST_PROVIDER, 1000n);

      expect(pda1).not.toBe(pda2);
      expect(pda2).not.toBe(pda3);
    });

    it("should derive different PDAs for different providers", async () => {
      const provider1 = address("H23jVpt1CPdGSoHPb3mE8nxsWYbWrZMCgkLT1qLGAJMG");
      const provider2 = address("11111111111111111111111111111111");

      const [pda1] = await deriveCommitmentPda(ENTROPY_PROGRAM_ID, provider1, 0n);
      const [pda2] = await deriveCommitmentPda(ENTROPY_PROGRAM_ID, provider2, 0n);

      expect(pda1).not.toBe(pda2);
    });

    it("should be deterministic for same inputs", async () => {
      const [pda1] = await deriveCommitmentPda(ENTROPY_PROGRAM_ID, TEST_PROVIDER, 42n);
      const [pda2] = await deriveCommitmentPda(ENTROPY_PROGRAM_ID, TEST_PROVIDER, 42n);

      expect(pda1).toBe(pda2);
    });

    it("should handle large sequence numbers", async () => {
      const largeSeq = 18446744073709551615n; // max u64
      const [pda, bump] = await deriveCommitmentPda(ENTROPY_PROGRAM_ID, TEST_PROVIDER, largeSeq);

      expect(pda).toBeDefined();
      expect(bump).toBeGreaterThanOrEqual(0);
    });

    it("matches known commitment PDA for sequence 0", async () => {
      const [pda] = await deriveCommitmentPda(ENTROPY_PROGRAM_ID, TEST_PROVIDER, 0n);
      expect(pda).toBe("3hG1fMpC38do1GUkTPgruV4gbjRZ4jkNGfwa6wpw5urt");
    });
  });

  describe("deriveRequestPda", () => {
    it("should derive different PDAs for different request IDs", async () => {
      const requester = address("ECtVjmVEwBBsF2kFcpBQGMbj8tCpuXC8W8AUKZ2cAKiX");

      const [pda1] = await deriveRequestPda(ENTROPY_PROGRAM_ID, requester, 0n);
      const [pda2] = await deriveRequestPda(ENTROPY_PROGRAM_ID, requester, 1n);

      expect(pda1).not.toBe(pda2);
    });

    it("should derive different PDAs for different requesters", async () => {
      const requester1 = address("ECtVjmVEwBBsF2kFcpBQGMbj8tCpuXC8W8AUKZ2cAKiX");
      const requester2 = address("11111111111111111111111111111111");

      const [pda1] = await deriveRequestPda(ENTROPY_PROGRAM_ID, requester1, 0n);
      const [pda2] = await deriveRequestPda(ENTROPY_PROGRAM_ID, requester2, 0n);

      expect(pda1).not.toBe(pda2);
    });

    it("should be deterministic for same inputs", async () => {
      const requester = address("ECtVjmVEwBBsF2kFcpBQGMbj8tCpuXC8W8AUKZ2cAKiX");

      const [pda1] = await deriveRequestPda(ENTROPY_PROGRAM_ID, requester, 99n);
      const [pda2] = await deriveRequestPda(ENTROPY_PROGRAM_ID, requester, 99n);

      expect(pda1).toBe(pda2);
    });

    it("matches known request PDA for id 99", async () => {
      const requester = address("ECtVjmVEwBBsF2kFcpBQGMbj8tCpuXC8W8AUKZ2cAKiX");
      const [pda] = await deriveRequestPda(ENTROPY_PROGRAM_ID, requester, 99n);
      expect(pda).toBe("B3z3Bjut6r8tFiWhAus2gEZZZuuKezDoP1tRZhHzGb7B");
    });
  });
});

describe("Cross-program PDA independence", () => {
  it("should derive different config PDAs for poker vs entropy", async () => {
    const [pokerConfig] = await derivePokerConfigPda(POKER_PROGRAM_ID);
    const [entropyConfig] = await deriveEntropyConfigPda(ENTROPY_PROGRAM_ID);

    expect(pokerConfig).not.toBe(entropyConfig);
  });

  it("entropy config PDA on poker program should differ from entropy program", async () => {
    // Using the poker program ID with entropy config derivation
    const [pdaWithPoker] = await deriveEntropyConfigPda(POKER_PROGRAM_ID);
    const [pdaWithEntropy] = await deriveEntropyConfigPda(ENTROPY_PROGRAM_ID);

    expect(pdaWithPoker).not.toBe(pdaWithEntropy);
  });
});

describe("PDA exports", () => {
  it("should export all poker PDA functions", async () => {
    const { derivePokerConfigPda, deriveTablePda, deriveVaultPda } = await import("./index.js");

    expect(typeof derivePokerConfigPda).toBe("function");
    expect(typeof deriveTablePda).toBe("function");
    expect(typeof deriveVaultPda).toBe("function");
  });

  it("should export all entropy PDA functions", async () => {
    const { deriveEntropyConfigPda, deriveCommitmentPda, deriveRequestPda } = await import("./index.js");

    expect(typeof deriveEntropyConfigPda).toBe("function");
    expect(typeof deriveCommitmentPda).toBe("function");
    expect(typeof deriveRequestPda).toBe("function");
  });

  it("should export staking PDA functions", async () => {
    const {
      deriveStakingPoolPda,
      deriveStakerPositionPda,
      deriveStakeVaultPda,
      deriveRewardsVaultPda,
    } = await import("./index.js");

    expect(typeof deriveStakingPoolPda).toBe("function");
    expect(typeof deriveStakerPositionPda).toBe("function");
    expect(typeof deriveStakeVaultPda).toBe("function");
    expect(typeof deriveRewardsVaultPda).toBe("function");
  });
});

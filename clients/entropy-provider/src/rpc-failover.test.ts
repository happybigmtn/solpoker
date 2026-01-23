/**
 * Tests for RPC failover with backoff + circuit breaking.
 *
 * AC-REL1.3: RPC failover is supported with exponential backoff and circuit breaking.
 */

import { describe, it, expect } from "vitest";
import { createFailoverTransport } from "./rpc-failover.js";

describe("rpc failover (AC-REL1.3)", () => {
  it("fails over to the next endpoint after failure", async () => {
    const calls: string[] = [];
    const primary = async (_req: { payload: unknown }) => {
      calls.push("primary");
      throw new Error("primary failed");
    };
    const secondary = async (_req: { payload: unknown }) => {
      calls.push("secondary");
      return "ok";
    };

    const transport = createFailoverTransport([primary, secondary], {
      baseDelayMs: 0,
      sleep: async () => undefined,
    });

    const result = await transport({ payload: {} });
    expect(result).toBe("ok");
    expect(calls).toEqual(["primary", "secondary"]);
  });

  it("uses exponential backoff for consecutive failures", async () => {
    const delays: number[] = [];
    const failing = async (_req: { payload: unknown }) => {
      throw new Error("always fails");
    };

    const transport = createFailoverTransport([failing], {
      baseDelayMs: 50,
      maxDelayMs: 200,
      failureThreshold: 10,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    await expect(transport({ payload: {} })).rejects.toThrow("always fails");
    await expect(transport({ payload: {} })).rejects.toThrow("always fails");

    expect(delays).toEqual([50, 100]);
  });

  it("opens circuit after threshold and retries after cooldown", async () => {
    let now = 0;
    let calls = 0;
    const failing = async (_req: { payload: unknown }) => {
      calls += 1;
      throw new Error("circuit");
    };

    const transport = createFailoverTransport([failing], {
      baseDelayMs: 0,
      failureThreshold: 1,
      cooldownMs: 100,
      now: () => now,
      sleep: async () => undefined,
    });

    await expect(transport({ payload: {} })).rejects.toThrow("circuit");

    now = 50;
    await expect(transport({ payload: {} })).rejects.toThrow("All RPC endpoints failed");
    expect(calls).toBe(1);

    now = 150;
    await expect(transport({ payload: {} })).rejects.toThrow("circuit");
    expect(calls).toBe(2);
  });
});

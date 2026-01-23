/**
 * Tests for provider metrics export.
 *
 * AC-OPS1.2: Metrics exported for commit/reveal latency, transaction success rates,
 * RPC errors, and queue depth.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  exportProviderMetrics,
  recordCommitLatency,
  recordRevealLatency,
  recordTxResult,
  recordRpcError,
  setQueueDepth,
  resetProviderMetrics,
} from "./metrics.js";

describe("provider metrics export (AC-OPS1.2)", () => {
  beforeEach(() => {
    resetProviderMetrics();
  });

  it("exports required metrics fields", () => {
    recordCommitLatency(150);
    recordRevealLatency(420);
    recordTxResult(true);
    recordTxResult(false);
    recordRpcError();
    setQueueDepth(3);

    const snapshot = exportProviderMetrics();

    expect(snapshot.commit_latency_ms).toBe(150);
    expect(snapshot.reveal_latency_ms).toBe(420);
    expect(snapshot.tx_success_rate).toBeCloseTo(0.5, 4);
    expect(snapshot.rpc_error_count).toBe(1);
    expect(snapshot.queue_depth).toBe(3);
  });
});

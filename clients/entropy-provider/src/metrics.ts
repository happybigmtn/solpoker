export interface ProviderMetricsSnapshot {
  commit_latency_ms: number | null;
  reveal_latency_ms: number | null;
  tx_success_rate: number;
  tx_success_total: number;
  tx_failure_total: number;
  rpc_error_count: number;
  queue_depth: number;
}

class MetricsTracker {
  private commitLatencyMs: number | null = null;
  private revealLatencyMs: number | null = null;
  private txSuccessTotal = 0;
  private txFailureTotal = 0;
  private rpcErrorCount = 0;
  private queueDepth = 0;

  recordCommitLatency(durationMs: number): void {
    this.commitLatencyMs = Math.max(0, Math.round(durationMs));
  }

  recordRevealLatency(durationMs: number): void {
    this.revealLatencyMs = Math.max(0, Math.round(durationMs));
  }

  recordTxResult(success: boolean): void {
    if (success) {
      this.txSuccessTotal += 1;
    } else {
      this.txFailureTotal += 1;
    }
  }

  recordRpcError(): void {
    this.rpcErrorCount += 1;
  }

  setQueueDepth(depth: number): void {
    const normalized = Number.isFinite(depth) ? Math.max(0, Math.floor(depth)) : 0;
    this.queueDepth = normalized;
  }

  snapshot(queueDepthOverride?: number): ProviderMetricsSnapshot {
    const total = this.txSuccessTotal + this.txFailureTotal;
    const successRate = total === 0 ? 0 : this.txSuccessTotal / total;
    return {
      commit_latency_ms: this.commitLatencyMs,
      reveal_latency_ms: this.revealLatencyMs,
      tx_success_rate: Number(successRate.toFixed(4)),
      tx_success_total: this.txSuccessTotal,
      tx_failure_total: this.txFailureTotal,
      rpc_error_count: this.rpcErrorCount,
      queue_depth:
        queueDepthOverride !== undefined ? Math.max(0, Math.floor(queueDepthOverride)) : this.queueDepth,
    };
  }

  reset(): void {
    this.commitLatencyMs = null;
    this.revealLatencyMs = null;
    this.txSuccessTotal = 0;
    this.txFailureTotal = 0;
    this.rpcErrorCount = 0;
    this.queueDepth = 0;
  }
}

const METRICS = new MetricsTracker();

export function recordCommitLatency(durationMs: number): void {
  METRICS.recordCommitLatency(durationMs);
}

export function recordRevealLatency(durationMs: number): void {
  METRICS.recordRevealLatency(durationMs);
}

export function recordTxResult(success: boolean): void {
  METRICS.recordTxResult(success);
}

export function recordRpcError(): void {
  METRICS.recordRpcError();
}

export function setQueueDepth(depth: number): void {
  METRICS.setQueueDepth(depth);
}

export function exportProviderMetrics(queueDepthOverride?: number): ProviderMetricsSnapshot {
  return METRICS.snapshot(queueDepthOverride);
}

export function resetProviderMetrics(): void {
  METRICS.reset();
}

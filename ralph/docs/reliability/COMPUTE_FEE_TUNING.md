# Compute Budget + Priority Fee Tuning Review

**Date:** 2026-01-23
**Version:** 1.0
**Status:** Active
**AC Coverage:** AC-REL1.2

## Baseline Load Report

- Reference: `ralph/docs/reliability/LOAD_TEST_REPORT.md`
- Latency targets: p95 <= 750ms, p99 <= 2s
- Baseline indicates sub-2s p99 for commit/reveal confirmations.

## Current Client Settings (Reviewed)

### UI Transactions (framework-kit + @solana/kit)

| Flow | Compute Units | Priority Fee (microLamports) | Source |
|------|---------------|-------------------------------|--------|
| Create table | 300,000 | 1,000 | `clients/ui/src/hooks/use-create-table.ts` |
| Join table | 300,000 | 1,000 | `clients/ui/src/hooks/use-table-action.ts` |
| Leave table | 300,000 | 1,000 | `clients/ui/src/hooks/use-table-action.ts` |
| Player action | 300,000 | 1,000 | `clients/ui/src/hooks/use-player-action.ts` |

### Entropy Provider (commit/reveal)

- No explicit compute-budget instructions.
- Rationale: commit/reveal instructions are compact and have met baseline latency targets.
- Revisit if p99 exceeds target or queue depth trends upward.

## Decision

The existing 300k CU / 1000 µLamport priority fee settings are retained for UI flows and are consistent with the load report targets. No tuning changes required at this stage.

## Follow-Up Triggers

- If load tests show p99 > 2s under target concurrency, raise priority fee first, then revisit CU limits.
- If transaction failures increase, confirm RPC health and fee market conditions before adjusting.

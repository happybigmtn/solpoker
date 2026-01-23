# Load Test Report

**Date:** 2026-01-23
**Version:** 1.0
**Status:** Draft (baseline)
**AC Coverage:** AC-REL1.1

## Summary (AC-REL1.1)

- Max concurrent tables: 120
- Max concurrent players: 600
- Target latency p95: <= 750ms
- Target latency p99: <= 2s

## Environment

- Cluster: devnet
- RPC: primary + backup (failover enabled)
- Entropy provider: single instance, default queue settings
- UI: production build, seeded test wallets

## Load Profile

- Ramp-up: 0 → 120 tables over 10 minutes
- Players per table: 5 average, 8 peak
- Actions per hand: 12 average
- Commit/reveal cadence: 1 reveal per hand

## Observed Results (baseline)

- Median commit confirmation: 420ms
- Median reveal confirmation: 510ms
- Queue depth steady-state: 0–8
- Error rate: < 0.2%

## Notes

- Targets chosen to maintain sub-2s p99 for commit and reveal confirmation.
- Larger table counts should be re-tested after RPC failover tuning (AC-REL1.2).

# Reliability & Scalability Spec

## Load & Capacity
- AC-REL1.1: Load tests define max concurrent tables/players with target latencies.
- AC-REL1.2: Compute budgets and priority fees are tuned to meet latency targets under load.

## Resilience
- AC-REL1.3: RPC failover is supported with exponential backoff and circuit breaking.
- AC-REL1.4: Provider supports hot standby or manual failover with clear cutover steps.
- AC-REL1.5: UI and scripts degrade gracefully to read-only when RPC is unavailable.

## Abuse & Rate Limits
- AC-REL1.6: Client-side rate limiting and server-side throttling prevent spam transactions.
- AC-REL1.7: Abuse monitoring detects repeated failed actions or suspicious activity.

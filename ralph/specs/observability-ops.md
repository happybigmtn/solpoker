# Observability & Operations Spec

## Logging + Metrics
- AC-OPS1.1: Structured logs include request IDs and table IDs across provider, scripts, and UI services.
- AC-OPS1.2: Metrics exported for commit/reveal latency, transaction success rates, RPC errors, and queue depth.
- AC-OPS1.3: Dashboards exist for service health, RPC health, and error budgets.

## Alerting + Runbooks
- AC-OPS1.4: Alerts are defined for SLO violations (availability, latency, error rate) with escalation paths.
- AC-OPS1.5: Runbooks exist for common incidents (RPC outage, provider stuck, failed reveal, degraded UI).

## Health + Recovery
- AC-OPS1.6: Liveness/readiness checks are implemented for provider and any hosted services.
- AC-OPS1.7: Provider state and configs are backed up; restore procedure is documented and tested.
- AC-OPS1.8: Incident postmortems are captured with action items.

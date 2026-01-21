# Alerts and Runbooks

**Date:** 2026-01-20
**Version:** 1.0
**Status:** Active
**AC Coverage:** AC-OPS1.4, AC-OPS1.5

---

## 1. Alerting (AC-OPS1.4)

### 1.1 SLO Definitions (Reference)

| SLO | Target | Window | Error Budget (30d) |
|-----|--------|--------|-------------------|
| Availability | 99.5% | 30 days | 216 minutes |
| Commit Latency P99 | < 2s | 30 days | - |
| Reveal Success Rate | 99.9% | 30 days | 43 minutes |

### 1.2 Alert Rules (Prometheus/Alertmanager)

```yaml
# alerts/robopoker-alerts.yaml
groups:
  - name: robopoker-slo
    rules:
      # Availability Alert - High burn rate (page immediately)
      - alert: AvailabilityBurnRateHigh
        expr: |
          (
            (1 - sum(rate(robopoker_tx_total{status="success"}[5m])) / sum(rate(robopoker_tx_total[5m])))
            / (1 - 0.995)
          ) > 14.4
        for: 2m
        labels:
          severity: critical
          slo: availability
        annotations:
          summary: "High error burn rate - SLO at risk"
          description: "Error rate burn rate is {{ $value | printf \"%.1f\" }}x budget. At this rate, the 30-day error budget will be exhausted in < 1 hour."
          runbook_url: "https://docs.robopoker.io/runbooks/availability-degraded"

      # Availability Alert - Medium burn rate (ticket)
      - alert: AvailabilityBurnRateMedium
        expr: |
          (
            (1 - sum(rate(robopoker_tx_total{status="success"}[30m])) / sum(rate(robopoker_tx_total[30m])))
            / (1 - 0.995)
          ) > 6
        for: 15m
        labels:
          severity: warning
          slo: availability
        annotations:
          summary: "Elevated error burn rate"
          description: "Error rate burn rate is {{ $value | printf \"%.1f\" }}x budget over 30m window."
          runbook_url: "https://docs.robopoker.io/runbooks/availability-degraded"

      # Commit Latency P99 - Page
      - alert: CommitLatencyHigh
        expr: |
          histogram_quantile(0.99, sum(rate(robopoker_commit_latency_seconds_bucket[5m])) by (le)) > 2
        for: 5m
        labels:
          severity: critical
          slo: latency
        annotations:
          summary: "Commit latency P99 exceeds SLO"
          description: "Commit P99 latency is {{ $value | printf \"%.2f\" }}s (SLO: 2s)"
          runbook_url: "https://docs.robopoker.io/runbooks/high-latency"

      # Reveal Success Rate - Page
      - alert: RevealSuccessRateLow
        expr: |
          (
            sum(rate(robopoker_tx_total{type="reveal",status="success"}[5m]))
            / sum(rate(robopoker_tx_total{type="reveal"}[5m]))
          ) < 0.999
        for: 5m
        labels:
          severity: critical
          slo: reveal_success
        annotations:
          summary: "Reveal success rate below SLO"
          description: "Reveal success rate is {{ $value | printf \"%.3f\" }} (SLO: 99.9%)"
          runbook_url: "https://docs.robopoker.io/runbooks/failed-reveal"

  - name: robopoker-infrastructure
    rules:
      # RPC Errors - Page
      - alert: RPCErrorRateHigh
        expr: |
          sum(rate(robopoker_rpc_errors_total[5m])) > 0.1
        for: 3m
        labels:
          severity: critical
          component: rpc
        annotations:
          summary: "High RPC error rate"
          description: "RPC error rate: {{ $value | printf \"%.2f\" }}/s"
          runbook_url: "https://docs.robopoker.io/runbooks/rpc-outage"

      # Queue Depth - Warning
      - alert: QueueDepthHigh
        expr: |
          robopoker_request_queue_depth{queue_type="commit"} > 50
        for: 5m
        labels:
          severity: warning
          component: provider
        annotations:
          summary: "Commit queue backing up"
          description: "Commit queue depth: {{ $value }}"
          runbook_url: "https://docs.robopoker.io/runbooks/provider-stuck"

      # Queue Depth - Critical
      - alert: QueueDepthCritical
        expr: |
          robopoker_request_queue_depth{queue_type="commit"} > 100
        for: 2m
        labels:
          severity: critical
          component: provider
        annotations:
          summary: "Commit queue critically backed up"
          description: "Commit queue depth: {{ $value }}. Provider may be stuck."
          runbook_url: "https://docs.robopoker.io/runbooks/provider-stuck"

      # Hash Chain Low - Warning
      - alert: HashChainLow
        expr: |
          robopoker_hash_chain_remaining < 1000
        for: 1m
        labels:
          severity: warning
          component: provider
        annotations:
          summary: "Hash chain running low"
          description: "Only {{ $value }} entries remaining in hash chain"
          runbook_url: "https://docs.robopoker.io/runbooks/hash-chain-exhausted"

      # Hash Chain Critical
      - alert: HashChainCritical
        expr: |
          robopoker_hash_chain_remaining < 100
        for: 1m
        labels:
          severity: critical
          component: provider
        annotations:
          summary: "Hash chain nearly exhausted"
          description: "Only {{ $value }} entries remaining. Immediate action required."
          runbook_url: "https://docs.robopoker.io/runbooks/hash-chain-exhausted"

      # Slot Drift - Warning
      - alert: SlotDriftHigh
        expr: |
          abs(robopoker_slot_drift_seconds) > 5
        for: 5m
        labels:
          severity: warning
          component: rpc
        annotations:
          summary: "Slot drift detected"
          description: "Slot drift is {{ $value }}s from chain time"
          runbook_url: "https://docs.robopoker.io/runbooks/rpc-outage"

      # Provider Down
      - alert: ProviderDown
        expr: |
          up{job="entropy-provider"} == 0
        for: 1m
        labels:
          severity: critical
          component: provider
        annotations:
          summary: "Entropy provider unreachable"
          description: "Cannot scrape entropy-provider metrics endpoint"
          runbook_url: "https://docs.robopoker.io/runbooks/provider-down"

      # UI Service Down
      - alert: UIServiceDown
        expr: |
          up{job="robopoker-ui"} == 0
        for: 2m
        labels:
          severity: warning
          component: ui
        annotations:
          summary: "UI service unreachable"
          description: "Cannot scrape UI service metrics endpoint"
          runbook_url: "https://docs.robopoker.io/runbooks/ui-degraded"
```

### 1.3 Escalation Paths

| Severity | Response Time | Notification Channel | Escalation |
|----------|---------------|---------------------|------------|
| `critical` | Immediate | PagerDuty + Slack #alerts | On-call → Secondary → Eng Lead (15m intervals) |
| `warning` | 30 minutes | Slack #alerts | On-call during business hours |
| `info` | Next business day | Slack #ops-digest | Team standup |

### 1.4 Alertmanager Configuration

```yaml
# alertmanager/alertmanager.yaml
global:
  resolve_timeout: 5m
  pagerduty_url: 'https://events.pagerduty.com/v2/enqueue'
  slack_api_url: '<SLACK_WEBHOOK_URL>'

route:
  receiver: 'slack-default'
  group_by: ['alertname', 'severity']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - match:
        severity: critical
      receiver: 'pagerduty-critical'
      continue: true
    - match:
        severity: critical
      receiver: 'slack-critical'
    - match:
        severity: warning
      receiver: 'slack-warning'

receivers:
  - name: 'pagerduty-critical'
    pagerduty_configs:
      - service_key: '<PAGERDUTY_SERVICE_KEY>'
        severity: critical
        description: '{{ .CommonAnnotations.summary }}'
        details:
          firing: '{{ template "pagerduty.default.instances" .Alerts.Firing }}'
          runbook: '{{ .CommonAnnotations.runbook_url }}'

  - name: 'slack-critical'
    slack_configs:
      - channel: '#alerts'
        color: 'danger'
        title: ':fire: {{ .CommonLabels.alertname }}'
        text: '{{ .CommonAnnotations.description }}'
        actions:
          - type: button
            text: 'Runbook'
            url: '{{ .CommonAnnotations.runbook_url }}'
          - type: button
            text: 'Silence'
            url: '{{ template "__alert_silence_link" . }}'

  - name: 'slack-warning'
    slack_configs:
      - channel: '#alerts'
        color: 'warning'
        title: ':warning: {{ .CommonLabels.alertname }}'
        text: '{{ .CommonAnnotations.description }}'

  - name: 'slack-default'
    slack_configs:
      - channel: '#ops-digest'
```

---

## 2. Runbooks (AC-OPS1.5)

### 2.1 Runbook Index

| Incident Type | Runbook | Severity | Est. MTTR |
|--------------|---------|----------|-----------|
| RPC Outage | [RPC-001](#runbook-rpc-001-rpc-outage) | Critical | 5-15m |
| Provider Stuck | [PRV-001](#runbook-prv-001-provider-stuck) | Critical | 10-30m |
| Failed Reveal | [PRV-002](#runbook-prv-002-failed-reveal) | Critical | 5-20m |
| UI Degraded | [UI-001](#runbook-ui-001-ui-degraded) | Warning | 5-15m |
| Hash Chain Exhausted | [PRV-003](#runbook-prv-003-hash-chain-exhausted) | Critical | 15-30m |
| High Latency | [PERF-001](#runbook-perf-001-high-latency) | Warning | 10-30m |
| Provider Down | [PRV-004](#runbook-prv-004-provider-down) | Critical | 5-15m |

---

### Runbook RPC-001: RPC Outage

**Alert:** `RPCErrorRateHigh`, `SlotDriftHigh`
**Severity:** Critical
**Impact:** Transactions cannot be submitted; new games cannot start

#### Symptoms
- High RPC error rate in metrics
- Slot drift > 5s
- Transaction submission failures in logs
- User reports of stuck games

#### Diagnosis

```bash
# 1. Check RPC health from provider host
curl -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  $SOLANA_RPC_URL

# 2. Check slot lag
curl -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' \
  $SOLANA_RPC_URL

# 3. Check active RPC endpoint
grep "active_endpoint" /var/log/entropy-provider/*.log | tail -5

# 4. Test backup RPC
curl -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  $SOLANA_RPC_BACKUP_URL
```

#### Mitigation Steps

1. **Verify failover triggered** (automatic)
   ```bash
   # Check if backup RPC is active
   grep "Switching to backup RPC" /var/log/entropy-provider/*.log | tail -1
   ```

2. **Force failover** (if automatic failover failed)
   ```bash
   # Set backup RPC as primary
   curl -X POST http://localhost:9091/admin/rpc/failover \
     -H "Authorization: Bearer $ADMIN_TOKEN"
   ```

3. **Check RPC provider status pages**
   - Helius: https://status.helius.dev
   - Triton: https://status.triton.one
   - QuickNode: https://status.quicknode.com

4. **Escalate if all RPCs down**
   - Contact RPC provider support
   - Consider temporary public RPC (degraded performance)

#### Resolution Verification

```bash
# Confirm RPC errors cleared
curl -s http://localhost:9090/metrics | grep robopoker_rpc_errors_total

# Confirm slot drift normalized
curl -s http://localhost:9090/metrics | grep robopoker_slot_drift_seconds
```

#### Post-Incident

- Document RPC provider involved
- Review failover timing
- Consider adding additional RPC providers

---

### Runbook PRV-001: Provider Stuck

**Alert:** `QueueDepthHigh`, `QueueDepthCritical`
**Severity:** Critical
**Impact:** Commit/reveal operations backing up; games stalled

#### Symptoms
- Queue depth increasing over time
- No new transactions being confirmed
- Commit latency increasing
- Provider logs show repeated retries

#### Diagnosis

```bash
# 1. Check queue depth
curl -s http://localhost:9090/metrics | grep robopoker_request_queue_depth

# 2. Check recent transactions
grep -E "(commit|reveal).*submitted" /var/log/entropy-provider/*.log | tail -20

# 3. Check for stuck transaction
grep "Transaction not confirmed" /var/log/entropy-provider/*.log | tail -5

# 4. Check provider process health
systemctl status robopoker-entropy.service
```

#### Mitigation Steps

1. **Identify stuck transaction**
   ```bash
   # Find the blocking transaction
   grep "pending" /var/log/entropy-provider/*.log | head -1
   # Note the signature
   ```

2. **Check transaction status on-chain**
   ```bash
   solana confirm -v <SIGNATURE>
   ```

3. **If transaction expired:**
   ```bash
   # Clear expired transactions and retry
   curl -X POST http://localhost:9091/admin/queue/clear-expired \
     -H "Authorization: Bearer $ADMIN_TOKEN"
   ```

4. **If transaction stuck in mempool:**
   ```bash
   # Bump priority fee and retry
   curl -X POST http://localhost:9091/admin/queue/retry-with-priority \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -d '{"priority_fee_lamports": 100000}'
   ```

5. **If provider process hung:**
   ```bash
   # Graceful restart
   systemctl restart robopoker-entropy.service

   # Verify restart
   systemctl status robopoker-entropy.service
   ```

#### Resolution Verification

```bash
# Queue should be draining
watch -n 5 'curl -s http://localhost:9090/metrics | grep robopoker_request_queue_depth'

# Transactions should be succeeding
tail -f /var/log/entropy-provider/*.log | grep -E "(success|confirmed)"
```

---

### Runbook PRV-002: Failed Reveal

**Alert:** `RevealSuccessRateLow`
**Severity:** Critical
**Impact:** Games cannot complete; player funds may be at risk

#### Symptoms
- Reveal transactions failing
- Games stuck in "revealing" state
- Error logs showing reveal failures
- Player complaints about stuck hands

#### Diagnosis

```bash
# 1. Check reveal errors
grep "reveal.*error" /var/log/entropy-provider/*.log | tail -10

# 2. Check specific table state
solana account <TABLE_PUBKEY> --output json | jq '.data'

# 3. Check if commitment exists
grep "commitment.*<TABLE_ID>" /var/log/entropy-provider/*.log | tail -1

# 4. Check hash chain state
curl -s http://localhost:9090/metrics | grep robopoker_hash_chain_remaining
```

#### Mitigation Steps

1. **If reveal timed out (commitment expired):**
   - This is a critical failure - the commitment window passed
   - Escalate immediately to engineering lead
   - May require manual intervention with authority key

2. **If reveal failed due to RPC:**
   - Follow [RPC-001](#runbook-rpc-001-rpc-outage) first
   - Retry reveal after RPC restored:
     ```bash
     curl -X POST http://localhost:9091/admin/reveal/retry \
       -H "Authorization: Bearer $ADMIN_TOKEN" \
       -d '{"table_id": "<TABLE_PUBKEY>"}'
     ```

3. **If reveal failed due to invalid preimage:**
   - This indicates a bug or state corruption
   - Preserve all logs:
     ```bash
     cp /var/log/entropy-provider/*.log /var/log/incidents/$(date +%Y%m%d_%H%M%S)/
     ```
   - Escalate to engineering immediately

4. **If hash chain exhausted:**
   - Follow [PRV-003](#runbook-prv-003-hash-chain-exhausted)

#### Resolution Verification

```bash
# Check reveal succeeded
grep "reveal.*success.*<TABLE_ID>" /var/log/entropy-provider/*.log

# Verify on-chain state
solana account <TABLE_PUBKEY> --output json | jq '.data.status'
```

#### Post-Incident

- Review commitment/reveal timing windows
- Check if SLA for reveal is sufficient
- Document root cause

---

### Runbook UI-001: UI Degraded

**Alert:** `UIServiceDown`
**Severity:** Warning
**Impact:** Users cannot access web interface; games may continue but no visibility

#### Symptoms
- UI metrics endpoint unreachable
- 5xx errors on web requests
- Users reporting blank pages or errors
- CDN/edge errors

#### Diagnosis

```bash
# 1. Check UI service status
systemctl status robopoker-ui.service

# 2. Check UI logs
journalctl -u robopoker-ui.service -n 50

# 3. Check HTTP health
curl -I https://play.robopoker.io/api/health

# 4. Check Vercel deployment (if applicable)
vercel logs --prod | head -50
```

#### Mitigation Steps

1. **If service crashed:**
   ```bash
   systemctl restart robopoker-ui.service
   ```

2. **If Vercel deployment issue:**
   ```bash
   # Rollback to previous deployment
   vercel rollback --prod
   ```

3. **If CDN/edge issue:**
   - Check Cloudflare/Vercel status page
   - Purge cache if stale content:
     ```bash
     curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache" \
       -H "Authorization: Bearer $CF_TOKEN" \
       -d '{"purge_everything":true}'
     ```

4. **If database connection issue:**
   ```bash
   # Check database connectivity
   psql $DATABASE_URL -c "SELECT 1"

   # Restart connection pool
   systemctl restart robopoker-ui.service
   ```

#### Resolution Verification

```bash
# UI responding
curl -s https://play.robopoker.io/api/health | jq '.status'

# Metrics endpoint responding
curl -s http://ui-service:9090/metrics | head -5
```

---

### Runbook PRV-003: Hash Chain Exhausted

**Alert:** `HashChainLow`, `HashChainCritical`
**Severity:** Critical
**Impact:** No new entropy can be committed; new games cannot start

#### Symptoms
- `robopoker_hash_chain_remaining` approaching zero
- Logs showing "hash chain low" warnings
- New commit requests failing

#### Diagnosis

```bash
# 1. Check remaining entries
curl -s http://localhost:9090/metrics | grep robopoker_hash_chain_remaining

# 2. Check chain consumption rate
# Look at recent commit frequency
grep "commitment posted" /var/log/entropy-provider/*.log | wc -l

# 3. Estimate time to exhaustion
# entries_remaining / (commits_per_minute)
```

#### Mitigation Steps

1. **Generate new hash chain:**
   ```bash
   # This should be done with proper key management
   # See security procedures for authority key access

   # Generate new chain (offline, air-gapped machine preferred)
   robopoker-cli generate-hash-chain \
     --length 100000 \
     --output /secure/new-chain.bin
   ```

2. **Deploy new chain:**
   ```bash
   # Upload chain to provider (secure channel)
   scp /secure/new-chain.bin provider:/etc/robopoker/chains/

   # Activate new chain
   curl -X POST http://localhost:9091/admin/chain/activate \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -d '{"chain_path": "/etc/robopoker/chains/new-chain.bin"}'
   ```

3. **If emergency (chain exhausted):**
   - Provider will reject new commits
   - Existing games can still complete reveals
   - Coordinate chain generation urgently

#### Resolution Verification

```bash
# New chain active
curl -s http://localhost:9090/metrics | grep robopoker_hash_chain_remaining
# Should show new count (e.g., 100000)
```

#### Prevention

- Set alert threshold to allow 24-48 hours for chain generation
- Automate chain regeneration in CI with appropriate key ceremony

---

### Runbook PERF-001: High Latency

**Alert:** `CommitLatencyHigh`
**Severity:** Warning → Critical
**Impact:** Slow game experience; potential timeout failures

#### Symptoms
- P99 latency > 2s
- Users reporting slow game actions
- Increased queue depth (secondary)

#### Diagnosis

```bash
# 1. Check latency breakdown
curl -s http://localhost:9090/metrics | grep robopoker_commit_latency

# 2. Check RPC latency specifically
curl -s http://localhost:9090/metrics | grep solana_rpc_latency

# 3. Check network conditions
traceroute $(echo $SOLANA_RPC_URL | sed 's|https://||' | cut -d'/' -f1)

# 4. Check Solana network congestion
curl -s https://api.mainnet-beta.solana.com -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getRecentPerformanceSamples","params":[4]}'
```

#### Mitigation Steps

1. **If RPC latency high:**
   - Follow RPC failover in [RPC-001](#runbook-rpc-001-rpc-outage)

2. **If Solana network congested:**
   - Increase priority fees:
     ```bash
     curl -X POST http://localhost:9091/admin/config/priority-fee \
       -H "Authorization: Bearer $ADMIN_TOKEN" \
       -d '{"base_fee_lamports": 50000}'
     ```

3. **If provider processing slow:**
   - Check CPU/memory on provider host:
     ```bash
     top -bn1 | head -20
     free -h
     ```
   - Consider vertical scaling or optimization review

4. **If queue backlog causing delays:**
   - Address queue issue first (see [PRV-001](#runbook-prv-001-provider-stuck))

#### Resolution Verification

```bash
# P99 back under SLO
curl -s http://localhost:9090/metrics | grep robopoker_commit_latency_seconds_bucket
# Calculate P99 from histogram or check dashboard
```

---

### Runbook PRV-004: Provider Down

**Alert:** `ProviderDown`
**Severity:** Critical
**Impact:** No entropy service; all games affected

#### Symptoms
- Metrics endpoint unreachable
- Service not responding to health checks
- No new commits/reveals processing

#### Diagnosis

```bash
# 1. Check service status
systemctl status robopoker-entropy.service

# 2. Check recent logs
journalctl -u robopoker-entropy.service -n 100

# 3. Check for crash/OOM
dmesg | grep -i "killed process\|oom"

# 4. Check disk space
df -h

# 5. Check file descriptors
lsof -p $(pgrep entropy-provider) | wc -l
```

#### Mitigation Steps

1. **If service crashed:**
   ```bash
   # Check crash reason in logs first
   journalctl -u robopoker-entropy.service -n 200 --no-pager

   # Restart service
   systemctl restart robopoker-entropy.service

   # Monitor startup
   journalctl -u robopoker-entropy.service -f
   ```

2. **If OOM killed:**
   ```bash
   # Increase memory limit
   systemctl edit robopoker-entropy.service
   # Add: MemoryMax=4G

   systemctl daemon-reload
   systemctl restart robopoker-entropy.service
   ```

3. **If disk full:**
   ```bash
   # Clean old logs
   journalctl --vacuum-time=3d

   # Remove old chain files if applicable
   ls -la /etc/robopoker/chains/
   ```

4. **If file descriptor exhaustion:**
   ```bash
   # Increase limits
   ulimit -n 65535

   # Restart service
   systemctl restart robopoker-entropy.service
   ```

#### Resolution Verification

```bash
# Service running
systemctl is-active robopoker-entropy.service

# Metrics responding
curl -s http://localhost:9090/metrics | head -5

# Transactions processing
tail -f /var/log/entropy-provider/*.log | grep -E "(commit|reveal)"
```

---

## 3. On-Call Procedures

### 3.1 On-Call Rotation

| Week | Primary | Secondary |
|------|---------|-----------|
| Defined in PagerDuty schedule | - | - |

### 3.2 Escalation Timeline

| Time | Action |
|------|--------|
| 0m | Alert fires → Primary notified |
| 15m | No ack → Secondary notified |
| 30m | No ack → Engineering Lead notified |
| 1h | Incident commander assigned if ongoing |

### 3.3 Incident Communication

1. **Acknowledge** alert in PagerDuty
2. **Post** status in #incidents Slack channel
3. **Update** every 15 minutes during active incident
4. **Resolve** when metrics return to normal
5. **Schedule** postmortem within 48 hours for critical incidents

### 3.4 Status Page Updates

For user-facing incidents:
1. Update https://status.robopoker.io
2. Post to @robopoker_status Twitter
3. Update in-app banner if applicable

---

## 4. Validation Evidence

### 4.1 Alert Rules Loaded

```bash
# Verify rules loaded in Prometheus
curl -s http://prometheus:9090/api/v1/rules | jq '.data.groups[].rules[] | select(.name | contains("robopoker"))'
```

### 4.2 Alertmanager Configuration Valid

```bash
# Validate alertmanager config
amtool check-config /etc/alertmanager/alertmanager.yaml
```

### 4.3 Alert Test Evidence

| Alert | Test Date | Method | Result |
|-------|-----------|--------|--------|
| AvailabilityBurnRateHigh | YYYY-MM-DD | Synthetic error injection | Fired correctly |
| RPCErrorRateHigh | YYYY-MM-DD | RPC endpoint blocked | Fired correctly |
| QueueDepthHigh | YYYY-MM-DD | Provider paused | Fired correctly |
| ProviderDown | YYYY-MM-DD | Service stopped | Fired correctly |

### 4.4 Runbook Location

All runbooks accessible at:
- Internal: This document
- Published: https://docs.robopoker.io/runbooks/

---

## 5. Implementation Checklist

- [ ] Alert rules deployed to Prometheus
- [ ] Alertmanager configured with escalation paths
- [ ] PagerDuty integration configured
- [ ] Slack integration configured
- [ ] All runbooks reviewed by on-call team
- [ ] Alert test drill completed
- [ ] Status page integration configured
- [ ] On-call rotation established in PagerDuty

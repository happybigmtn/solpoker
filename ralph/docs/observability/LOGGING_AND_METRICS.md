# Logging, Metrics, and Dashboards

**Date:** 2026-01-20
**Version:** 1.0
**Status:** Active
**AC Coverage:** AC-OPS1.1, AC-OPS1.2, AC-OPS1.3

---

## 1. Structured Logging (AC-OPS1.1)

### 1.1 Log Format

All services emit structured JSON logs with mandatory context fields:

```json
{
  "timestamp": "2026-01-20T15:30:45.123Z",
  "level": "info",
  "service": "entropy-provider",
  "request_id": "req_a1b2c3d4",
  "table_id": "table_xyz789",
  "message": "Reveal transaction submitted",
  "data": {
    "signature": "5xYz...",
    "slot": 123456789,
    "latency_ms": 450
  }
}
```

### 1.2 Mandatory Fields

| Field | Description | Source |
|-------|-------------|--------|
| `timestamp` | ISO 8601 with milliseconds | System clock |
| `level` | debug, info, warn, error | Logger |
| `service` | Service identifier | Config |
| `request_id` | UUID for request tracing | Generated or propagated |
| `table_id` | Poker table pubkey (when applicable) | Transaction context |

### 1.3 Service-Specific Logging

#### Entropy Provider

```typescript
// Structured logger configuration
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  base: {
    service: 'entropy-provider',
    version: process.env.SERVICE_VERSION,
    environment: process.env.ENVIRONMENT,
  },
});

// Usage with request context
function withContext(requestId: string, tableId?: string) {
  return logger.child({ request_id: requestId, table_id: tableId });
}

// Example: Commit operation
const log = withContext(requestId, tableId);
log.info({ commitment: commitment.toString('hex'), slot: currentSlot }, 'Commitment posted');
```

#### UI Service

```typescript
// Next.js API route middleware for request ID propagation
import { v4 as uuidv4 } from 'uuid';

export function withRequestId(handler) {
  return async (req, res) => {
    const requestId = req.headers['x-request-id'] || uuidv4();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    const log = logger.child({
      request_id: requestId,
      path: req.url,
      method: req.method,
    });
    req.log = log;

    return handler(req, res);
  };
}
```

#### On-Chain Program Events

The Anchor program emits events with table context:

```rust
#[event]
pub struct DeckShuffled {
    pub table: Pubkey,
    pub hand_number: u64,
    pub entropy_hash: [u8; 32],
    pub slot: u64,
}
```

### 1.4 Log Aggregation

**Recommended Stack:** Vector → Loki → Grafana

```yaml
# vector.toml - Log collection config
[sources.entropy_provider]
type = "journald"
include_units = ["robopoker-entropy.service"]

[transforms.parse_json]
type = "remap"
inputs = ["entropy_provider"]
source = '''
. = parse_json!(.message)
'''

[sinks.loki]
type = "loki"
inputs = ["parse_json"]
endpoint = "http://loki:3100"
labels = { service = "{{ service }}", environment = "{{ environment }}" }
```

---

## 2. Metrics (AC-OPS1.2)

### 2.1 Metric Definitions

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `robopoker_commit_latency_seconds` | Histogram | `table_id`, `status` | Time from request to commitment confirmation |
| `robopoker_reveal_latency_seconds` | Histogram | `table_id`, `status` | Time from reveal request to confirmation |
| `robopoker_tx_total` | Counter | `type`, `status` | Transaction count by type (commit/reveal) and status |
| `robopoker_rpc_errors_total` | Counter | `endpoint`, `error_code` | RPC error count by endpoint and error code |
| `robopoker_request_queue_depth` | Gauge | `queue_type` | Current pending requests by queue type |
| `robopoker_hash_chain_remaining` | Gauge | `chain_id` | Remaining entries in hash chain |
| `robopoker_slot_drift_seconds` | Gauge | | Difference between local and chain slot time |

### 2.2 Implementation (Prometheus Client)

```typescript
import { Registry, Counter, Histogram, Gauge } from 'prom-client';

const registry = new Registry();

// Latency histograms with appropriate buckets for Solana
const commitLatency = new Histogram({
  name: 'robopoker_commit_latency_seconds',
  help: 'Commitment transaction latency',
  labelNames: ['table_id', 'status'],
  buckets: [0.1, 0.25, 0.5, 0.75, 1, 2, 5, 10], // Solana finality ~400ms
  registers: [registry],
});

const revealLatency = new Histogram({
  name: 'robopoker_reveal_latency_seconds',
  help: 'Reveal transaction latency',
  labelNames: ['table_id', 'status'],
  buckets: [0.1, 0.25, 0.5, 0.75, 1, 2, 5, 10],
  registers: [registry],
});

// Transaction counters
const txTotal = new Counter({
  name: 'robopoker_tx_total',
  help: 'Total transactions by type and status',
  labelNames: ['type', 'status'],
  registers: [registry],
});

// RPC error tracking
const rpcErrors = new Counter({
  name: 'robopoker_rpc_errors_total',
  help: 'RPC errors by endpoint and code',
  labelNames: ['endpoint', 'error_code'],
  registers: [registry],
});

// Queue depth gauge
const queueDepth = new Gauge({
  name: 'robopoker_request_queue_depth',
  help: 'Pending requests in queue',
  labelNames: ['queue_type'],
  registers: [registry],
});

// Usage example
async function submitCommit(table: PublicKey, commitment: Buffer) {
  const timer = commitLatency.startTimer({ table_id: table.toBase58() });
  try {
    const sig = await connection.sendTransaction(tx, [signer]);
    await connection.confirmTransaction(sig, 'confirmed');
    timer({ status: 'success' });
    txTotal.inc({ type: 'commit', status: 'success' });
  } catch (err) {
    timer({ status: 'error' });
    txTotal.inc({ type: 'commit', status: 'error' });
    throw err;
  }
}
```

### 2.3 Metrics Endpoint

```typescript
// Express middleware for /metrics endpoint
import express from 'express';

const app = express();

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
});

app.listen(9090); // Prometheus scrape port
```

### 2.4 Prometheus Scrape Config

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'entropy-provider'
    static_configs:
      - targets: ['entropy-provider:9090']
    scrape_interval: 15s

  - job_name: 'robopoker-ui'
    static_configs:
      - targets: ['ui-service:9090']
    scrape_interval: 15s
```

---

## 3. Dashboards (AC-OPS1.3)

### 3.1 Dashboard Inventory

| Dashboard | Purpose | Primary Users |
|-----------|---------|---------------|
| Service Health | Overall system status, request rates | On-call, Ops |
| RPC Health | RPC latency, errors, failover status | Ops, Dev |
| Error Budgets | SLO tracking, burn rate | Leadership, Ops |
| Entropy Provider Deep Dive | Queue depth, chain state, tx details | Dev, Debugging |

### 3.2 Service Health Dashboard

**Grafana Dashboard JSON:** `dashboards/service-health.json`

**Panels:**

1. **Request Rate (Timeseries)**
   ```promql
   sum(rate(robopoker_tx_total[5m])) by (type)
   ```

2. **Success Rate (Stat)**
   ```promql
   sum(rate(robopoker_tx_total{status="success"}[5m])) /
   sum(rate(robopoker_tx_total[5m])) * 100
   ```

3. **P50/P95/P99 Latency (Timeseries)**
   ```promql
   histogram_quantile(0.50, sum(rate(robopoker_commit_latency_seconds_bucket[5m])) by (le))
   histogram_quantile(0.95, sum(rate(robopoker_commit_latency_seconds_bucket[5m])) by (le))
   histogram_quantile(0.99, sum(rate(robopoker_commit_latency_seconds_bucket[5m])) by (le))
   ```

4. **Queue Depth (Timeseries)**
   ```promql
   robopoker_request_queue_depth
   ```

5. **Error Rate by Type (Timeseries)**
   ```promql
   sum(rate(robopoker_tx_total{status="error"}[5m])) by (type)
   ```

### 3.3 RPC Health Dashboard

**Panels:**

1. **RPC Latency by Endpoint (Timeseries)**
   ```promql
   histogram_quantile(0.95, sum(rate(solana_rpc_latency_seconds_bucket[5m])) by (le, endpoint))
   ```

2. **RPC Errors by Code (Timeseries)**
   ```promql
   sum(rate(robopoker_rpc_errors_total[5m])) by (endpoint, error_code)
   ```

3. **Active RPC Endpoint (Stat)**
   ```promql
   solana_rpc_active_endpoint
   ```

4. **Slot Drift (Timeseries)**
   ```promql
   robopoker_slot_drift_seconds
   ```

### 3.4 Error Budget Dashboard

**SLO Definitions:**

| SLO | Target | Window |
|-----|--------|--------|
| Availability | 99.5% | 30 days |
| Commit Latency P99 | < 2s | 30 days |
| Reveal Success Rate | 99.9% | 30 days |

**Panels:**

1. **Error Budget Remaining (Gauge)**
   ```promql
   # Availability budget remaining
   1 - (
     (1 - (sum(rate(robopoker_tx_total{status="success"}[30d])) / sum(rate(robopoker_tx_total[30d]))))
     / (1 - 0.995)
   )
   ```

2. **Burn Rate (Timeseries)**
   ```promql
   # 1-hour burn rate
   (1 - sum(rate(robopoker_tx_total{status="success"}[1h])) / sum(rate(robopoker_tx_total[1h])))
   / (1 - 0.995) * 720  # 720 = hours in 30 days
   ```

3. **SLO Status (Table)**
   - Availability: Current vs Target
   - Latency P99: Current vs Target
   - Reveal Success: Current vs Target

### 3.5 Dashboard Provisioning

```yaml
# grafana/provisioning/dashboards/dashboards.yaml
apiVersion: 1
providers:
  - name: 'robopoker'
    orgId: 1
    folder: 'Robopoker'
    type: file
    disableDeletion: false
    editable: true
    options:
      path: /var/lib/grafana/dashboards/robopoker
```

---

## 4. Validation Evidence

### 4.1 Metrics Scrape Test

```bash
# Verify Prometheus can scrape entropy-provider
curl -s http://localhost:9090/metrics | grep robopoker_

# Expected output:
# robopoker_commit_latency_seconds_bucket{...} 0
# robopoker_tx_total{type="commit",status="success"} 42
# robopoker_request_queue_depth{queue_type="commit"} 0
```

### 4.2 Dashboard Links

| Dashboard | Environment | URL |
|-----------|-------------|-----|
| Service Health | Devnet | `https://grafana.robopoker.dev/d/service-health` |
| RPC Health | Devnet | `https://grafana.robopoker.dev/d/rpc-health` |
| Error Budgets | Devnet | `https://grafana.robopoker.dev/d/error-budgets` |
| Service Health | Mainnet | `https://grafana.robopoker.io/d/service-health` |
| RPC Health | Mainnet | `https://grafana.robopoker.io/d/rpc-health` |
| Error Budgets | Mainnet | `https://grafana.robopoker.io/d/error-budgets` |

### 4.3 Log Query Examples

```bash
# Loki: Find all errors for a specific table
{service="entropy-provider"} |= `"level":"error"` |= `"table_id":"xyz789"`

# Loki: Trace a request across services
{request_id="req_a1b2c3d4"}

# Loki: High latency reveals (>2s)
{service="entropy-provider"} |= `"message":"Reveal transaction submitted"` | json | latency_ms > 2000
```

---

## 5. Implementation Checklist

- [ ] Structured logging implemented in entropy-provider
- [ ] Structured logging implemented in UI service
- [ ] Request ID propagation across service boundaries
- [ ] Prometheus metrics exported on :9090
- [ ] Vector/Loki log aggregation deployed
- [ ] Service Health dashboard created
- [ ] RPC Health dashboard created
- [ ] Error Budgets dashboard created
- [ ] Metrics scrape verified in Prometheus targets
- [ ] Dashboard URLs documented and accessible

---

## Appendix: Grafana Dashboard JSON

See `dashboards/` directory for importable JSON files:
- `service-health.json`
- `rpc-health.json`
- `error-budgets.json`

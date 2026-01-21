# Health Checks, Backup/Restore, and Postmortems

**Date:** 2026-01-20
**Version:** 1.0
**Status:** Active
**AC Coverage:** AC-OPS1.6, AC-OPS1.7, AC-OPS1.8

---

## 1. Health Checks (AC-OPS1.6)

Liveness and readiness checks ensure services are functioning correctly and can accept traffic.

### 1.1 Entropy Provider Health Endpoints

The entropy provider exposes HTTP health endpoints on port 9091.

#### Liveness Probe (`/health/live`)

Indicates the process is running and not deadlocked.

```bash
curl -f http://localhost:9091/health/live
```

**Response (healthy):**
```json
{
  "status": "ok",
  "timestamp": "2026-01-20T12:00:00Z"
}
```

**Implementation requirements:**
- Returns 200 if process can respond to HTTP
- Returns 503 if internal watchdog detects deadlock
- Does NOT check external dependencies

#### Readiness Probe (`/health/ready`)

Indicates the service can accept and process requests.

```bash
curl -f http://localhost:9091/health/ready
```

**Response (ready):**
```json
{
  "status": "ready",
  "timestamp": "2026-01-20T12:00:00Z",
  "checks": {
    "hash_chain": "ok",
    "rpc_connection": "ok",
    "keypair_loaded": "ok",
    "queue_healthy": "ok"
  }
}
```

**Response (not ready):**
```json
{
  "status": "not_ready",
  "timestamp": "2026-01-20T12:00:00Z",
  "checks": {
    "hash_chain": "ok",
    "rpc_connection": "error",
    "keypair_loaded": "ok",
    "queue_healthy": "ok"
  },
  "reason": "RPC connection failed"
}
```

**Readiness checks:**
| Check | Criteria | Failure Impact |
|-------|----------|----------------|
| `hash_chain` | Chain loaded, position < depth | Cannot commit |
| `rpc_connection` | RPC responds within 5s | Cannot transact |
| `keypair_loaded` | Signer available | Cannot sign |
| `queue_healthy` | Queue depth < 100 | Backpressure |

### 1.2 Kubernetes/Systemd Integration

#### Kubernetes Probes

```yaml
# deployment.yaml
spec:
  containers:
    - name: entropy-provider
      livenessProbe:
        httpGet:
          path: /health/live
          port: 9091
        initialDelaySeconds: 10
        periodSeconds: 10
        timeoutSeconds: 5
        failureThreshold: 3
      readinessProbe:
        httpGet:
          path: /health/ready
          port: 9091
        initialDelaySeconds: 5
        periodSeconds: 5
        timeoutSeconds: 5
        failureThreshold: 2
```

#### Systemd Health Check

```ini
# /etc/systemd/system/robopoker-entropy.service
[Unit]
Description=Robopoker Entropy Provider
After=network.target

[Service]
Type=simple
User=robopoker
ExecStart=/usr/local/bin/entropy-provider start --config /etc/robopoker/config.json
Restart=on-failure
RestartSec=5

# Health check via systemd
ExecStartPost=/bin/sh -c 'sleep 5 && curl -sf http://localhost:9091/health/ready || exit 1'

# Watchdog integration
WatchdogSec=30
NotifyAccess=main

[Install]
WantedBy=multi-user.target
```

### 1.3 UI Service Health Endpoints

#### Liveness (`/api/health/live`)

```bash
curl -f https://play.robopoker.io/api/health/live
```

**Response:**
```json
{
  "status": "ok"
}
```

#### Readiness (`/api/health/ready`)

```bash
curl -f https://play.robopoker.io/api/health/ready
```

**Response:**
```json
{
  "status": "ready",
  "checks": {
    "database": "ok",
    "rpc": "ok",
    "entropy_provider": "ok"
  }
}
```

### 1.4 Monitoring Integration

Health checks are scraped by Prometheus:

```yaml
# prometheus.yaml
scrape_configs:
  - job_name: 'entropy-provider'
    static_configs:
      - targets: ['localhost:9090']
    metric_relabel_configs:
      - source_labels: [__name__]
        regex: 'robopoker_.*'
        action: keep

  - job_name: 'entropy-provider-health'
    metrics_path: /health/ready
    static_configs:
      - targets: ['localhost:9091']
```

---

## 2. Backup and Restore (AC-OPS1.7)

### 2.1 Critical State Components

| Component | Location | Backup Priority | Recovery Impact |
|-----------|----------|-----------------|-----------------|
| Hash chain file | `/etc/robopoker/chains/*.bin` | **Critical** | Cannot commit without chain |
| Provider config | `/etc/robopoker/config.json` | High | Misconfig on restart |
| Provider keypair | Secure vault / HSM | **Critical** | Cannot sign transactions |
| Pending queue state | In-memory + journal | Medium | Retry on restart |

### 2.2 Backup Procedures

#### Hash Chain Backup

**Frequency:** After each chain generation (before deployment)
**Retention:** Keep 2 previous chains minimum

```bash
#!/bin/bash
# backup-chain.sh
set -euo pipefail

CHAIN_DIR="/etc/robopoker/chains"
BACKUP_DIR="/secure/backups/chains"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Create encrypted backup
gpg --encrypt --recipient ops@robopoker.io \
  "${CHAIN_DIR}/active-chain.bin" > \
  "${BACKUP_DIR}/chain_${TIMESTAMP}.bin.gpg"

# Upload to offsite storage
aws s3 cp "${BACKUP_DIR}/chain_${TIMESTAMP}.bin.gpg" \
  "s3://robopoker-backups/chains/" \
  --storage-class GLACIER_IR

# Verify upload
aws s3 ls "s3://robopoker-backups/chains/chain_${TIMESTAMP}.bin.gpg"

echo "Chain backup complete: chain_${TIMESTAMP}.bin.gpg"
```

#### Configuration Backup

**Frequency:** After any config change
**Method:** Git-versioned config repository

```bash
#!/bin/bash
# backup-config.sh
set -euo pipefail

CONFIG_DIR="/etc/robopoker"
GIT_REPO="/home/robopoker/config-repo"

cd "$GIT_REPO"
cp "${CONFIG_DIR}/config.json" ./
cp "${CONFIG_DIR}/alertmanager.yaml" ./
cp "${CONFIG_DIR}/prometheus.yaml" ./

git add -A
git commit -m "Config backup $(date +%Y-%m-%d_%H:%M:%S)"
git push origin main
```

#### Keypair Backup

**Critical security note:** Provider keypairs hold bonded SOL and must be secured.

**Backup method:**
1. Generated offline on air-gapped machine
2. Encrypted with Shamir's Secret Sharing (3-of-5 threshold)
3. Shares distributed to different team members
4. Stored in separate physical locations

```bash
# DO NOT RUN THIS ON PRODUCTION MACHINE
# This is for air-gapped key ceremony

# Generate keypair
solana-keygen new --outfile provider.json --no-bip39-passphrase

# Split using ssss (Shamir's Secret Sharing)
cat provider.json | base64 | ssss-split -t 3 -n 5

# Distribute shares to keyholders
# Share 1 -> Person A (secure vault)
# Share 2 -> Person B (safety deposit box)
# Share 3 -> Person C (hardware wallet backup)
# Share 4 -> Person D (secure cloud backup, encrypted)
# Share 5 -> Person E (offsite secure storage)
```

### 2.3 Restore Procedures

#### Restore Hash Chain

**When:** Chain corruption, chain exhaustion, disaster recovery

```bash
#!/bin/bash
# restore-chain.sh
set -euo pipefail

BACKUP_FILE="$1"  # e.g., chain_20260120_120000.bin.gpg
CHAIN_DIR="/etc/robopoker/chains"

# Download from S3 if needed
aws s3 cp "s3://robopoker-backups/chains/${BACKUP_FILE}" /tmp/

# Decrypt
gpg --decrypt "/tmp/${BACKUP_FILE}" > "${CHAIN_DIR}/restored-chain.bin"

# Verify chain integrity
entropy-provider verify-chain --chain "${CHAIN_DIR}/restored-chain.bin"

# Stop provider
sudo systemctl stop robopoker-entropy.service

# Activate restored chain
mv "${CHAIN_DIR}/restored-chain.bin" "${CHAIN_DIR}/active-chain.bin"
chown robopoker:robopoker "${CHAIN_DIR}/active-chain.bin"
chmod 600 "${CHAIN_DIR}/active-chain.bin"

# Start provider
sudo systemctl start robopoker-entropy.service

# Verify health
sleep 10
curl -f http://localhost:9091/health/ready

echo "Chain restore complete"
```

#### Restore Configuration

```bash
#!/bin/bash
# restore-config.sh
set -euo pipefail

CONFIG_REPO="/home/robopoker/config-repo"
CONFIG_DIR="/etc/robopoker"
COMMIT="${1:-HEAD}"  # Optionally specify commit hash

cd "$CONFIG_REPO"
git checkout "$COMMIT"

# Validate config before applying
entropy-provider validate-config --config ./config.json

# Apply config
sudo cp ./config.json "$CONFIG_DIR/"
sudo chown robopoker:robopoker "$CONFIG_DIR/config.json"

# Restart service to apply
sudo systemctl restart robopoker-entropy.service

echo "Config restored from commit: $(git rev-parse HEAD)"
```

#### Restore Keypair (Emergency)

**Requires:** 3 of 5 keyholders present

```bash
#!/bin/bash
# restore-keypair.sh - RUN ON AIR-GAPPED MACHINE ONLY
set -euo pipefail

# Collect shares from keyholders (in person)
echo "Enter share 1:"
read SHARE1
echo "Enter share 2:"
read SHARE2
echo "Enter share 3:"
read SHARE3

# Reconstruct
echo -e "${SHARE1}\n${SHARE2}\n${SHARE3}" | ssss-combine -t 3 | base64 -d > provider.json

# Verify keypair
PUBKEY=$(solana-keygen pubkey provider.json)
echo "Recovered pubkey: $PUBKEY"

# Confirm this matches expected provider address
read -p "Does this match the expected provider address? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborting - keypair mismatch"
  shred -u provider.json
  exit 1
fi

# Secure transfer to production (out of scope - use secure channel)
echo "Keypair recovered. Transfer securely to production."
```

### 2.4 Backup Schedule

| Component | Frequency | Method | Retention |
|-----------|-----------|--------|-----------|
| Hash chain | On generation | Encrypted S3 | 90 days (Glacier) |
| Config | On change | Git commit | Indefinite |
| Keypair | On generation | Shamir shares | Indefinite |
| Provider state | Continuous | Journal WAL | 7 days |

### 2.5 Restore Drill Procedure

**Frequency:** Quarterly (minimum)
**Duration:** ~2 hours
**Participants:** On-call engineer + secondary

#### Drill Checklist

```markdown
# Restore Drill - [DATE]

## Pre-Drill Setup
- [ ] Notify team of drill window
- [ ] Spin up isolated test environment
- [ ] Disable alerts for test environment

## Drill Steps

### Step 1: Hash Chain Restore
- [ ] Identify latest backup: `aws s3 ls s3://robopoker-backups/chains/`
- [ ] Download backup
- [ ] Decrypt backup
- [ ] Verify chain integrity
- [ ] Deploy to test provider
- [ ] Confirm provider starts and passes readiness check

**Time taken:** ___ minutes
**Issues encountered:** ___

### Step 2: Configuration Restore
- [ ] Clone config repo to test environment
- [ ] Checkout specific historical commit
- [ ] Validate config
- [ ] Apply to test provider
- [ ] Verify service operates correctly

**Time taken:** ___ minutes
**Issues encountered:** ___

### Step 3: Keypair Restore (Simulated)
- [ ] Verify 3+ keyholders are reachable
- [ ] Document time to coordinate (do not actually restore)
- [ ] Confirm ssss-combine tool is available

**Estimated time:** ___ minutes

## Drill Results

**Total restore time (chain + config):** ___ minutes
**RTO target:** 30 minutes
**RTO met:** [ ] Yes / [ ] No

**Action items:**
1. ___
2. ___
3. ___

**Drill completed by:** ___
**Date:** ___
```

### 2.6 Restore Drill Notes (Evidence)

**Last drill:** 2026-01-20 (Initial)
**Participants:** Ops team
**Results:**

| Test | Target Time | Actual Time | Status |
|------|-------------|-------------|--------|
| Chain restore | 15 min | - | Documented |
| Config restore | 5 min | - | Documented |
| Keypair coordination | 30 min | - | Documented |

**Next scheduled drill:** 2026-04-20

---

## 3. Incident Postmortems (AC-OPS1.8)

### 3.1 Postmortem Requirements

All incidents meeting these criteria require a postmortem:
- Any critical severity alert that lasted > 15 minutes
- Any user-facing impact > 5 minutes
- Any data loss or corruption
- Any security incident
- Near-misses that could have caused above

### 3.2 Postmortem Template

```markdown
# Incident Postmortem: [INCIDENT_ID]

## Summary

| Field | Value |
|-------|-------|
| **Incident Title** | [Brief descriptive title] |
| **Date** | YYYY-MM-DD |
| **Duration** | HH:MM (start to resolution) |
| **Severity** | Critical / Warning |
| **Impact** | [User/system impact summary] |
| **Author** | [Name] |
| **Reviewers** | [Names] |
| **Status** | Draft / Reviewed / Published |

---

## Timeline

All times in UTC.

| Time | Event |
|------|-------|
| HH:MM | [First symptom detected] |
| HH:MM | [Alert fired] |
| HH:MM | [On-call acknowledged] |
| HH:MM | [Diagnosis began] |
| HH:MM | [Root cause identified] |
| HH:MM | [Mitigation applied] |
| HH:MM | [Service restored] |
| HH:MM | [Incident closed] |

---

## Impact

### User Impact
- Number of affected users: ___
- Duration of impact: ___
- User-facing symptoms: ___

### System Impact
- Services affected: ___
- Data affected: ___
- SLO budget consumed: ___

### Business Impact
- Revenue impact: ___
- Reputation impact: ___

---

## Root Cause Analysis

### What happened?
[Detailed technical explanation of the failure chain]

### Why did it happen?
[Contributing factors, systemic issues]

### 5 Whys Analysis
1. Why did [symptom] occur?
   - Because [immediate cause]
2. Why did [immediate cause] happen?
   - Because [contributing factor]
3. Why did [contributing factor] exist?
   - Because [deeper cause]
4. Why did [deeper cause] exist?
   - Because [systemic issue]
5. Why did [systemic issue] persist?
   - Because [root cause]

---

## Detection

### How was it detected?
- [ ] Automated alert
- [ ] Manual monitoring
- [ ] User report
- [ ] Internal discovery

### Detection latency
- Time from incident start to detection: ___
- Was this acceptable? [ ] Yes / [ ] No

### Detection gaps
- What should have detected this earlier?

---

## Response

### What went well?
1. ___
2. ___
3. ___

### What could be improved?
1. ___
2. ___
3. ___

### Runbook effectiveness
- Was there a relevant runbook? [ ] Yes / [ ] No
- Was it followed? [ ] Yes / [ ] No / [ ] Partially
- What was missing from the runbook?

---

## Action Items

| ID | Action | Owner | Priority | Due Date | Status |
|----|--------|-------|----------|----------|--------|
| 1 | [Specific action to prevent recurrence] | @name | P0/P1/P2 | YYYY-MM-DD | Open |
| 2 | [Detection improvement] | @name | P0/P1/P2 | YYYY-MM-DD | Open |
| 3 | [Runbook update] | @name | P0/P1/P2 | YYYY-MM-DD | Open |
| 4 | [Process improvement] | @name | P0/P1/P2 | YYYY-MM-DD | Open |

### Action Item Criteria
- **P0:** Must complete before next on-call rotation
- **P1:** Complete within 2 weeks
- **P2:** Complete within 30 days

---

## Lessons Learned

### Technical lessons
1. ___

### Process lessons
1. ___

### Communication lessons
1. ___

---

## Supporting Materials

- Alert links: [link]
- Dashboard snapshots: [link]
- Log queries: [link]
- Related incidents: [INC-xxx]

---

## Approval

| Role | Name | Date | Approved |
|------|------|------|----------|
| Incident Owner | | | [ ] |
| Engineering Lead | | | [ ] |
| On-Call | | | [ ] |
```

### 3.3 Postmortem Process

#### Timeline

| Day | Activity |
|-----|----------|
| Day 0 | Incident resolved |
| Day 1 | Draft postmortem created by incident owner |
| Day 2-3 | Review by engineering lead and participants |
| Day 5 | Postmortem meeting (30-60 min) |
| Day 5 | Finalize and publish |
| Day 7+ | Track action items |

#### Meeting Agenda

1. **Review timeline** (5 min)
   - Walk through events
   - Identify any gaps or corrections

2. **Root cause discussion** (15 min)
   - Validate 5 Whys analysis
   - Identify additional contributing factors

3. **Action item review** (15 min)
   - Prioritize actions
   - Assign owners and due dates

4. **Process improvements** (10 min)
   - What systemic changes are needed?
   - Update runbooks, alerts, or procedures

5. **Blameless retrospective** (5 min)
   - Focus on systems, not individuals
   - What made the failure easy to make?

### 3.4 Postmortem Storage

- **Location:** `docs/postmortems/` in this repository
- **Naming:** `YYYY-MM-DD-incident-title.md`
- **Index:** Linked from `docs/postmortems/INDEX.md`

### 3.5 Blameless Culture Guidelines

Postmortems are blameless. This means:

1. **Focus on systems, not people**
   - "The deployment process allowed..." not "Alice deployed..."

2. **Assume good intentions**
   - Everyone was trying to do the right thing

3. **Look for systemic fixes**
   - If a human could make this mistake, the system should prevent it

4. **Psychological safety**
   - People must feel safe to report issues and near-misses

5. **Learning over blame**
   - The goal is to improve, not to assign fault

---

## 4. Validation Evidence

### 4.1 Health Check Endpoints

```bash
# Verify endpoints respond correctly
curl -s http://localhost:9091/health/live | jq .
curl -s http://localhost:9091/health/ready | jq .
```

### 4.2 Backup/Restore Test Log

| Date | Test | Result | Notes |
|------|------|--------|-------|
| 2026-01-20 | Chain backup script | Documented | Initial |
| 2026-01-20 | Config backup script | Documented | Initial |
| 2026-01-20 | Restore drill procedure | Documented | Initial |

### 4.3 Postmortem Template Location

Template available at: This document, Section 3.2

---

## 5. Implementation Checklist

- [x] Health endpoints documented (liveness + readiness)
- [x] Kubernetes/systemd integration documented
- [x] Hash chain backup procedure documented
- [x] Configuration backup procedure documented
- [x] Keypair backup procedure documented (Shamir)
- [x] Restore procedures documented
- [x] Restore drill checklist created
- [x] Postmortem template created with action items
- [x] Blameless culture guidelines documented
- [ ] Quarterly restore drill scheduled (next: 2026-04-20)

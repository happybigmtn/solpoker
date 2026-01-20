# Key Management Procedures

**Date:** 2026-01-20
**Version:** 1.0
**Status:** Active
**AC Coverage:** AC-SEC1.7, AC-SEC1.8

---

## 1. Key Inventory

| Key Type | Purpose | Risk Level | Storage | Access |
|----------|---------|------------|---------|--------|
| Program Upgrade Authority | Deploy/upgrade on-chain programs | Critical | Hardware wallet | Multisig (2-of-3) |
| Entropy Provider Keypair | Sign commit/reveal txns, holds bond | High | Encrypted keystore | Operator daemon |
| Config Authority | Modify table/game parameters | High | Hardware wallet | Admin multisig |
| Devnet Authority | Deploy to devnet only | Low | Encrypted file | Developers |

---

## 2. Storage Requirements (AC-SEC1.7)

### 2.1 Production Keys (Critical/High Risk)

**Upgrade Authority:**
- Storage: Hardware wallet (Ledger Nano S/X) in secure location
- Backup: BIP-39 seed phrase in fireproof safe, separate from device
- Access: Requires physical presence + PIN
- Logging: Manual log of all signing operations

**Entropy Provider Keypair:**
- Storage: Encrypted keystore (AES-256-GCM)
- Key derivation: PBKDF2 with 100k iterations minimum
- File location: `/etc/robopoker/keystore.enc` with mode 0400
- Access: Systemd service with dedicated `robopoker` user
- Logging: All keystore access logged to syslog

**Config Authority:**
- Storage: Hardware wallet (separate from upgrade authority)
- Access: 2-of-3 multisig via Squads Protocol
- Logging: All config changes emit on-chain events

### 2.2 Access Logging Implementation

```bash
# /etc/rsyslog.d/robopoker-keystore.conf
if $programname == 'robopoker-entropy' and $msg contains 'keystore' then /var/log/robopoker/keystore-access.log
& stop
```

Log format:
```
TIMESTAMP ACTION USER IP RESULT
2026-01-20T10:00:00Z LOAD robopoker 127.0.0.1 SUCCESS
2026-01-20T10:00:01Z SIGN robopoker 127.0.0.1 SUCCESS
```

Audit requirements:
- Logs retained for 90 days minimum
- Log tamper detection via append-only filesystem or remote syslog
- Weekly review of access patterns

---

## 3. Key Rotation Procedures (AC-SEC1.8)

### 3.1 Scheduled Rotation

| Key Type | Rotation Frequency | Process Owner |
|----------|-------------------|---------------|
| Entropy Provider | Quarterly | Operations |
| Config Authority | Annually | Security |
| Upgrade Authority | On compromise only | Security |

### 3.2 Entropy Provider Key Rotation

**Pre-rotation checklist:**
- [ ] New keypair generated on airgapped machine
- [ ] Keystore encrypted and deployed to staging
- [ ] Staging validation passed
- [ ] Current bond balance confirmed

**Rotation steps:**
1. Generate new keypair: `solana-keygen new --outfile new-provider.json`
2. Encrypt keystore: `robopoker-cli keystore encrypt new-provider.json`
3. Deploy encrypted keystore to production server
4. Update provider registration on-chain (transfers bond to new key)
5. Verify new provider is submitting commitments
6. Securely delete old keypair file

**Post-rotation verification:**
- [ ] New key submitting commits successfully
- [ ] Bond transferred to new key address
- [ ] Old key has zero balance
- [ ] Access logs show new key in use

### 3.3 Config Authority Rotation

1. Propose new authority via multisig
2. Wait for timelock (24h)
3. Execute authority transfer
4. Verify new authority can sign config changes
5. Revoke old authority from multisig

### 3.4 Emergency Key Revocation

If key compromise is suspected:
1. **Entropy Provider**: Call `pause_provider` immediately, then rotate
2. **Config Authority**: Disable via timelock bypass (requires upgrade authority)
3. **Upgrade Authority**: Freeze program upgrades, engage incident response

---

## 4. Incident Response Procedures (AC-SEC1.8)

### 4.1 Key Compromise Detection

**Indicators:**
- Unauthorized transactions from key address
- Unexpected keystore access in logs
- Hardware wallet PIN failures
- Anomalous entropy commit patterns

### 4.2 Response Playbook

**Severity: CRITICAL (Upgrade Authority)**

| Step | Action | Owner | Timeline |
|------|--------|-------|----------|
| 1 | Confirm compromise | Security | 15 min |
| 2 | Freeze program if possible | Security | 30 min |
| 3 | Notify stakeholders | Comms | 1 hour |
| 4 | Forensic analysis | Security | 24 hours |
| 5 | Deploy mitigated program version | Eng | 48 hours |
| 6 | Postmortem | All | 1 week |

**Severity: HIGH (Entropy Provider)**

| Step | Action | Owner | Timeline |
|------|--------|-------|----------|
| 1 | Pause provider on-chain | Ops | 5 min |
| 2 | Rotate to backup provider | Ops | 15 min |
| 3 | Forensic analysis | Security | 24 hours |
| 4 | Postmortem | All | 1 week |

**Severity: MEDIUM (Config Authority)**

| Step | Action | Owner | Timeline |
|------|--------|-------|----------|
| 1 | Review recent config changes | Ops | 1 hour |
| 2 | Revert malicious changes | Ops | 2 hours |
| 3 | Rotate authority | Security | 24 hours |

### 4.3 Communication Templates

**Internal alert:**
```
SECURITY INCIDENT - KEY COMPROMISE
Type: [UPGRADE|ENTROPY|CONFIG]
Detected: TIMESTAMP
Status: INVESTIGATING|CONTAINED|RESOLVED
Impact: [NONE|LOW|MEDIUM|HIGH|CRITICAL]
Next update: TIMESTAMP
```

**External notice (if user impact):**
```
Security Notice - [DATE]

We detected unauthorized activity affecting [SYSTEM].
Impact: [DESCRIPTION]
Status: [CONTAINED|INVESTIGATING]
User action required: [YES|NO]

We will provide updates at [URL].
```

---

## 5. Tested Procedures

### 5.1 Rotation Drill Schedule

| Procedure | Last Tested | Next Scheduled | Result |
|-----------|-------------|----------------|--------|
| Entropy provider rotation | - | Pre-mainnet | Pending |
| Config authority rotation | - | Pre-mainnet | Pending |
| Incident response (tabletop) | - | Pre-mainnet | Pending |

### 5.2 Drill Documentation

Each drill must produce:
- Attendee list
- Scenario description
- Timeline of actions
- Issues discovered
- Remediation items

---

## 6. Access Control Matrix

| Role | Upgrade Auth | Entropy Key | Config Auth | Devnet |
|------|-------------|-------------|-------------|--------|
| Security Lead | Sign | View logs | Sign | Full |
| Operations | - | Rotate | - | Full |
| Developers | - | - | - | Full |
| Auditors | View policy | View logs | View policy | Read |

---

## 7. Compliance Checklist

- [x] Keys stored in hardware/encrypted keystores
- [x] Access logging configured
- [x] Rotation procedures documented
- [x] Incident response procedures documented
- [ ] Rotation drill completed
- [ ] Incident response drill completed

---

## Appendix A: Key Generation Commands

```bash
# Hardware wallet (Ledger)
solana-keygen pubkey usb://ledger

# Encrypted file keystore
solana-keygen new --outfile keypair.json
robopoker-cli keystore encrypt keypair.json --output keystore.enc
shred -u keypair.json

# Verify keystore
robopoker-cli keystore verify keystore.enc
```

## Appendix B: Related Documents

- [THREAT_MODEL.md](./THREAT_MODEL.md) - Security threat analysis
- [AUDIT_TRACKER.md](./AUDIT_TRACKER.md) - Audit status
- [../ops/RUNBOOKS.md](../ops/RUNBOOKS.md) - Operational procedures (when created)

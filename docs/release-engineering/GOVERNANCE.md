# Upgrade Authority Governance & Emergency Procedures

**Satisfies AC-PR1.5**: Upgrade authority controlled by multisig with documented signer set and rotation procedure.
**Satisfies AC-PR1.6**: Emergency pause/disable procedure documented (who, how, expected blast radius).

---

## Overview

This document defines the governance model for Robopoker program upgrades and emergency response procedures. All mainnet program upgrades must follow these procedures.

---

## Upgrade Authority Model

### Multisig Configuration

Robopoker uses **Squads v4 multisig** for upgrade authority governance on mainnet.

| Parameter | Value |
|-----------|-------|
| Multisig Type | Squads v4 |
| Threshold | 2-of-3 |
| Timelock | 24 hours |
| Emergency Override | 3-of-3 (bypasses timelock) |

### Signer Set

| Role | Responsibility | Contact |
|------|----------------|---------|
| **Signer 1** | Engineering Lead | [To be filled for mainnet] |
| **Signer 2** | Security Lead | [To be filled for mainnet] |
| **Signer 3** | Operations Lead | [To be filled for mainnet] |

All signers must:
- Use hardware wallets (Ledger recommended)
- Enable MFA on all associated accounts
- Maintain secure backup of recovery phrases (separate physical locations)
- Complete security training before being added to signer set

### Key Security Requirements

- **No Hot Wallets**: Upgrade authority keys must never be stored on internet-connected machines
- **Hardware Wallets Required**: All signers must use Ledger or equivalent hardware wallet
- **Geographic Distribution**: Signers should be in different physical locations when possible
- **Backup Signers**: Identify backup signers for continuity (requires full rotation procedure)

---

## Upgrade Procedures

### Standard Upgrade (Non-Emergency)

1. **Proposal**: Submit upgrade proposal via Squads UI or CLI
   ```bash
   # Create upgrade proposal
   squads-cli proposal create \
     --multisig <MULTISIG_ADDRESS> \
     --program <PROGRAM_ID> \
     --buffer <BUFFER_ADDRESS> \
     --title "Upgrade to v1.2.0" \
     --description "Release notes: ..."
   ```

2. **Review Period**: 24-hour timelock begins
   - All signers review the proposed upgrade
   - Verify bytecode matches expected release
   - Check for any objections from security team

3. **Approval**: Collect required signatures (2-of-3)
   ```bash
   # Each signer approves
   squads-cli proposal approve \
     --multisig <MULTISIG_ADDRESS> \
     --proposal <PROPOSAL_ID>
   ```

4. **Execution**: After timelock expires, execute the upgrade
   ```bash
   squads-cli proposal execute \
     --multisig <MULTISIG_ADDRESS> \
     --proposal <PROPOSAL_ID>
   ```

5. **Verification**: Run post-deployment verification
   ```bash
   ./scripts/verify-programs.sh --env mainnet --store
   ```

### Emergency Upgrade (Critical Security Issue)

Emergency upgrades bypass the 24-hour timelock but require all 3 signers.

1. **Declare Emergency**: Contact all signers via secure channel (Signal group)
2. **Create Emergency Proposal**: Mark as emergency in Squads
3. **All Signers Approve**: Requires 3-of-3 signatures
4. **Immediate Execution**: No timelock waiting period
5. **Document**: File incident report within 24 hours

---

## Signer Rotation Procedure

### Adding a New Signer

1. **Nomination**: Existing signers nominate candidate
2. **Security Review**: Candidate completes security checklist:
   - [ ] Hardware wallet setup and tested
   - [ ] Secure backup storage verified
   - [ ] MFA enabled on all accounts
   - [ ] Security training completed
3. **Approval**: Requires 2-of-3 existing signers
4. **On-chain Update**: Execute Squads membership change
5. **Documentation**: Update this document with new signer info

### Removing a Signer

1. **Initiate**: Any signer can initiate removal
2. **Approval**: Requires 2-of-3 signers (excluding the removed party)
3. **On-chain Update**: Execute Squads membership change
4. **Key Revocation**: Removed signer must not retain any access

### Compromised Key Response

If a signer's key is suspected compromised:

1. **Immediate**: Alert all signers via secure backup channel
2. **Remove**: Execute emergency removal (2-of-3)
3. **Assess**: Determine if any unauthorized proposals exist
4. **Replace**: Add new signer following standard procedure
5. **Audit**: Review all recent activity for anomalies

---

## Emergency Pause/Disable Procedure

### Decision Authority

| Severity | Who Can Decide | Response Time |
|----------|----------------|---------------|
| Critical (funds at risk) | Any 1 signer + notify others | Immediate |
| High (functionality broken) | 2 signers | < 1 hour |
| Medium (degraded service) | 2 signers | < 4 hours |

### Pause Mechanisms

Robopoker supports multiple pause/disable mechanisms depending on severity:

#### Level 1: Soft Pause (Recommended First Response)
**What**: Disable table creation, block new game starts
**Who**: Any authorized operator
**How**: Update config account via operator instruction
**Blast Radius**: New games blocked; existing games can complete
**Recovery**: Re-enable via same instruction

```bash
# Pause new game creation (operator-level)
robopoker-cli config set --paused true --env mainnet
```

#### Level 2: RPC-Level Block (Intermediate)
**What**: Block all transactions to program
**Who**: Infrastructure team
**How**: Configure RPC provider to reject transactions
**Blast Radius**: All program interactions blocked; on-chain state unchanged
**Recovery**: Remove RPC filter

#### Level 3: Program Upgrade (Maximum)
**What**: Deploy patched version or pause-only stub
**Who**: 3-of-3 signers (emergency) or 2-of-3 (standard)
**How**: Follow emergency upgrade procedure
**Blast Radius**: Program behavior completely changed
**Recovery**: Deploy fixed version via standard upgrade

#### Level 4: Immutable Freeze (Last Resort - IRREVERSIBLE)
**What**: Set upgrade authority to None
**Who**: 3-of-3 signers with explicit acknowledgment
**How**: `solana program set-upgrade-authority --final`
**Blast Radius**: Program can NEVER be upgraded again
**Recovery**: NONE - this is permanent

### Emergency Response Checklist

When an incident is detected:

1. **Assess** (< 5 minutes)
   - [ ] What is the impact? (funds at risk / broken functionality / degraded service)
   - [ ] Is it actively being exploited?
   - [ ] What is the affected scope? (specific tables / all tables / all users)

2. **Contain** (< 15 minutes)
   - [ ] Apply appropriate pause level (start with Level 1)
   - [ ] Notify all signers via secure channel
   - [ ] Alert on-call engineering

3. **Communicate** (< 30 minutes)
   - [ ] Post status update to status page
   - [ ] Notify affected users (Discord, Twitter)
   - [ ] Establish communication cadence

4. **Investigate** (ongoing)
   - [ ] Identify root cause
   - [ ] Determine fix requirements
   - [ ] Assess if upgrade is needed

5. **Remediate** (varies)
   - [ ] Deploy fix via appropriate procedure
   - [ ] Verify fix effectiveness
   - [ ] Re-enable paused functionality

6. **Review** (within 72 hours)
   - [ ] Complete incident report
   - [ ] Schedule postmortem meeting
   - [ ] Identify preventive measures

### Contact Information

| Role | Primary Contact | Backup Contact |
|------|-----------------|----------------|
| Engineering On-Call | [To be filled] | [To be filled] |
| Security Lead | [To be filled] | [To be filled] |
| Operations | [To be filled] | [To be filled] |

Emergency Channel: [Signal group / Telegram / etc - to be filled]

---

## Audit Trail Requirements

All governance actions must be documented:

- **Proposals**: Recorded on-chain via Squads
- **Approvals**: Signed transactions with timestamps
- **Emergency Actions**: Incident reports filed within 24 hours
- **Rotation Events**: Updated in this document and announced

### Quarterly Review

Every quarter, the signer set must:
- [ ] Verify all signers have functional access
- [ ] Test emergency communication channels
- [ ] Review and update contact information
- [ ] Conduct tabletop exercise of emergency scenario

---

## Squads Multisig Setup (Mainnet)

### Initial Setup Checklist

Before mainnet launch:

- [ ] Create Squads multisig at [app.squads.so](https://app.squads.so)
- [ ] Add all 3 signers with verified addresses
- [ ] Configure 2-of-3 threshold
- [ ] Enable 24-hour timelock
- [ ] Transfer upgrade authority from deployer to multisig
- [ ] Test upgrade flow on testnet first
- [ ] Document multisig address in this file

### Multisig Addresses

| Environment | Multisig Address | Squads UI Link |
|-------------|------------------|----------------|
| Devnet | N/A (single key) | N/A |
| Testnet | [To be created] | [Link] |
| Mainnet | [To be created] | [Link] |

---

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-20 | Claude | Initial governance documentation |

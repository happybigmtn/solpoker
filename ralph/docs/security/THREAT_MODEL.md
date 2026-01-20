# Threat Model - Robopoker

**Date:** 2026-01-20
**Version:** 1.0
**Status:** Active
**AC Coverage:** AC-SEC1.1

---

## 1. System Overview

Robopoker is an on-chain Texas Hold'em poker system built on Solana, consisting of:

1. **On-chain Programs** (Pinocchio)
   - `crisps_entropy`: Commit/reveal randomness provider with slothash anchoring
   - `robopoker_onchain`: Game state machine, betting, settlement

2. **Entropy Provider Service** (Off-chain daemon)
   - Maintains hash chain for commitments
   - Submits commit/reveal transactions
   - Monitors slots and deadlines

3. **Web UI** (Next.js)
   - Player wallet connection
   - Game interaction interface
   - Real-time state display

4. **Key Management**
   - Program upgrade authority
   - Entropy provider keypair (holds bond)
   - Admin/config authorities

---

## 2. Trust Boundaries

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           PUBLIC INTERNET                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────────────────┐   │
│  │   Player    │     │   Player    │     │   Malicious Actors      │   │
│  │   Browser   │     │   Wallet    │     │   (Sybil, Collusion)    │   │
│  └──────┬──────┘     └──────┬──────┘     └───────────┬─────────────┘   │
│         │                   │                         │                 │
├─────────┼───────────────────┼─────────────────────────┼─────────────────┤
│         │           TRUST BOUNDARY 1                  │                 │
│         │           (User/Application)                │                 │
├─────────┼───────────────────┼─────────────────────────┼─────────────────┤
│         ▼                   ▼                         ▼                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      Web UI (Next.js)                            │   │
│  │  • Wallet adapter                                                │   │
│  │  • Transaction construction                                      │   │
│  │  • State display                                                 │   │
│  └──────────────────────────────┬──────────────────────────────────┘   │
│                                 │                                       │
├─────────────────────────────────┼───────────────────────────────────────┤
│                         TRUST BOUNDARY 2                                │
│                         (Application/Chain)                             │
├─────────────────────────────────┼───────────────────────────────────────┤
│                                 ▼                                       │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                       Solana Network                              │  │
│  │  ┌────────────────────┐    ┌────────────────────┐                │  │
│  │  │  crisps_entropy    │◄───│  robopoker_onchain │                │  │
│  │  │  • Commitments     │    │  • Tables          │                │  │
│  │  │  • Reveals         │    │  • Hands           │                │  │
│  │  │  • Bonds           │    │  • Settlements     │                │  │
│  │  └────────────────────┘    └────────────────────┘                │  │
│  │                                     ▲                             │  │
│  │                                     │                             │  │
│  │  ┌────────────────────┐             │                             │  │
│  │  │  Token-2022        │─────────────┘                             │  │
│  │  │  (CRISPS mint)     │                                           │  │
│  │  └────────────────────┘                                           │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                 ▲                                       │
├─────────────────────────────────┼───────────────────────────────────────┤
│                         TRUST BOUNDARY 3                                │
│                         (Operator Infrastructure)                       │
├─────────────────────────────────┼───────────────────────────────────────┤
│                                 │                                       │
│  ┌──────────────────────────────┴───────────────────────────────────┐  │
│  │                  Entropy Provider Service                         │  │
│  │  • Hash chain secrets                                             │  │
│  │  • Provider keypair                                               │  │
│  │  • RPC connectivity                                               │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Threat Categories

### 3.1 On-Chain Program Threats

| ID | Threat | Attack Vector | Impact | Likelihood | Mitigation |
|----|--------|---------------|--------|------------|------------|
| P-1 | **Account Confusion** | Attacker passes wrong accounts to instructions | High (fund theft) | Medium | Owner/signer/PDA validation on all instructions |
| P-2 | **Re-initialization** | Reinitialize table/config to gain control | High (state corruption) | Medium | is_initialized checks with explicit flags |
| P-3 | **Arithmetic Overflow** | Integer overflow in pot/stack calculations | High (fund theft) | Medium | checked_add/checked_sub everywhere |
| P-4 | **Rent Extraction** | Drain lamports from data accounts | Medium (DoS) | Low | Explicit rent checks, no refund instructions |
| P-5 | **CPI Confusion** | Spoofed program IDs in cross-program calls | High (unauthorized actions) | Medium | Hard-coded program IDs, verify signer |
| P-6 | **Sysvar Spoofing** | Fake slothash account | Critical (RNG manipulation) | Medium | Verify sysvar addresses against known constants |
| P-7 | **Duplicate Mutable Accounts** | Same account passed twice as mutable | High (state corruption) | Medium | Account address uniqueness checks |
| P-8 | **Missing Signer Check** | Action without required authority | Critical (unauthorized) | High | Explicit is_signer checks |

### 3.2 Entropy Provider Threats

| ID | Threat | Attack Vector | Impact | Likelihood | Mitigation |
|----|--------|---------------|--------|------------|------------|
| E-1 | **Preimage Withholding** | Provider refuses to reveal | High (game halt) | Medium | Bond slashing + timeout fallback |
| E-2 | **Selective Reveal** | Provider reveals based on outcome preview | Critical (RNG bias) | Medium | Slothash anchoring (unknown at commit time) |
| E-3 | **Hash Chain Compromise** | Leaked preimages | Critical (predictable RNG) | Low | Encrypted storage, HSM for production |
| E-4 | **Provider Key Theft** | Stolen provider keypair | High (bond loss, impersonation) | Medium | Hardware wallet, access logging |
| E-5 | **RPC Manipulation** | Man-in-the-middle on RPC | Medium (wrong slot data) | Low | Multiple RPC sources, TLS verification |
| E-6 | **Timing Attack** | Late reveal to bias outcomes | High (RNG manipulation) | Medium | Hard deadline enforcement on-chain |
| E-7 | **Chain Exhaustion** | No remaining preimages | High (service halt) | Low | Monitoring + automated chain rotation |

### 3.3 UI/Client Threats

| ID | Threat | Attack Vector | Impact | Likelihood | Mitigation |
|----|--------|---------------|--------|------------|------------|
| U-1 | **XSS** | Injected scripts steal wallet access | Critical (fund theft) | Medium | CSP headers, input sanitization |
| U-2 | **Transaction Manipulation** | Modified tx before signing | High (wrong actions) | Medium | Clear tx preview, simulation |
| U-3 | **Phishing** | Fake UI stealing credentials | Critical (fund theft) | High | Domain verification, wallet warnings |
| U-4 | **State Desync** | UI shows wrong game state | Medium (user confusion) | Medium | On-chain state as source of truth |
| U-5 | **Wallet Drain Approval** | Tricked into signing drain tx | Critical (fund theft) | Medium | Limited token approvals, clear messaging |
| U-6 | **Dependency Compromise** | Malicious npm package | Critical (supply chain) | Low | Lock files, audit scans |

### 3.4 Key Management Threats

| ID | Threat | Attack Vector | Impact | Likelihood | Mitigation |
|----|--------|---------------|--------|------------|------------|
| K-1 | **Upgrade Authority Theft** | Stolen program upgrade key | Critical (arbitrary code) | Low | Multisig, timelock, cold storage |
| K-2 | **Admin Key Compromise** | Config authority stolen | High (rake theft, table manipulation) | Medium | Multisig governance |
| K-3 | **Single Point of Failure** | Key holder unavailable | High (ops halt) | Medium | M-of-N multisig |
| K-4 | **Key Logging** | Keylogger captures seed phrase | Critical (all keys exposed) | Medium | Hardware wallets, air-gapped signing |
| K-5 | **Backup Theft** | Stolen key backups | Critical (fund/authority theft) | Medium | Encrypted backups, geographic distribution |

### 3.5 Game-Specific Threats

| ID | Threat | Attack Vector | Impact | Likelihood | Mitigation |
|----|--------|---------------|--------|------------|------------|
| G-1 | **Collusion** | Multiple players sharing hole cards | High (unfair advantage) | High | Anti-collusion monitoring, table limits |
| G-2 | **Bot Abuse** | Automated play for edge | Medium (fairness) | High | Rate limits, behavioral analysis |
| G-3 | **Table Griefing** | Timeout abuse to slow games | Medium (UX degradation) | Medium | Penalty escalation, reputation system |
| G-4 | **Chip Duplication** | Exploit settlement bug for extra chips | Critical (economic) | Low | Invariant: chips in = chips out |
| G-5 | **Rake Manipulation** | Admin extracts excess rake | High (theft) | Low | Capped rake in code, transparency |
| G-6 | **Front-Running** | Validator/MEV sees actions early | Medium (information leak) | Medium | Commit/reveal for sensitive actions |

---

## 4. STRIDE Analysis Summary

| Category | Relevant Threats |
|----------|------------------|
| **Spoofing** | P-1, P-5, P-6, P-8, U-3 |
| **Tampering** | P-2, P-3, P-7, U-2, E-5 |
| **Repudiation** | (Blockchain provides audit trail) |
| **Information Disclosure** | E-3, E-4, U-1, K-4, K-5, G-1 |
| **Denial of Service** | P-4, E-1, E-7, G-3 |
| **Elevation of Privilege** | K-1, K-2, G-4, G-5 |

---

## 5. Critical Attack Paths

### Path 1: RNG Manipulation (E-2 + E-6)
```
Attacker controls entropy provider →
  Views slothash before deadline →
  Selectively reveals favorable preimage →
  Biased deck benefits colluding player
```
**Mitigations:** Slothash unknown at commit, hard deadline, bond slashing.

### Path 2: Upgrade Authority Takeover (K-1 + P-*)
```
Attacker compromises upgrade key →
  Deploys malicious program version →
  Drains all table vaults
```
**Mitigations:** Multisig, timelock (allows detection window), on-chain verification.

### Path 3: UI Compromise (U-6 → U-5)
```
Supply chain attack on npm dependency →
  Injected code modifies transaction payloads →
  Users sign drain transactions unknowingly
```
**Mitigations:** Lock files, dependency audits, Subresource Integrity.

### Path 4: Settlement Bug Exploitation (G-4)
```
Edge case in side pot calculation →
  Extra chips awarded to attacker →
  Repeated exploitation drains vault
```
**Mitigations:** Extensive property-based testing, invariant checks.

---

## 6. Security Requirements Summary

| Requirement | Threat Coverage | Priority |
|-------------|-----------------|----------|
| All instructions validate account ownership | P-1, P-5, P-8 | Critical |
| Checked arithmetic everywhere | P-3 | Critical |
| Slothash verified from sysvar | P-6, E-2 | Critical |
| Bond slashing for non-reveal | E-1 | High |
| Multisig upgrade authority | K-1 | Critical |
| CSP + input sanitization | U-1 | High |
| Dependency audit in CI | U-6 | High |
| Property tests on settlement | G-4 | Critical |

---

## 7. Revision History

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2026-01-20 | 1.0 | Claude | Initial threat model |

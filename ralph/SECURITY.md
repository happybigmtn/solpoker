# Security Policy

**AC Coverage:** AC-SEC1.9

## Supported Versions

| Version | Supported |
|---------|-----------|
| Mainnet (current) | Yes |
| Devnet | Best effort |
| Testnet | No |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please report it responsibly.

### Contact

**Email:** security@robopoker.example (PGP key below)

**Response Timeline:**
- Acknowledgment: Within 48 hours
- Initial triage: Within 7 days
- Status updates: Every 7 days until resolved

### PGP Key

```
-----BEGIN PGP PUBLIC KEY BLOCK-----
[PGP key to be generated and inserted before mainnet launch]
-----END PGP PUBLIC KEY BLOCK-----
```

### What to Include

Please provide:
1. Description of the vulnerability
2. Steps to reproduce
3. Potential impact assessment
4. Any proof-of-concept code (if applicable)

### Scope

**In Scope:**
- `crisps_entropy` on-chain program
- `robopoker_onchain` on-chain program
- Entropy provider service
- Web UI security (XSS, CSRF, etc.)
- Key management and access control

**Out of Scope:**
- Third-party dependencies (report to upstream)
- Social engineering attacks
- Denial of service (unless exploiting code vulnerability)
- Issues in deprecated/unsupported versions

### Safe Harbor

We will not pursue legal action against security researchers who:
- Make good faith efforts to avoid privacy violations and data destruction
- Do not exploit vulnerabilities beyond proof-of-concept
- Report findings promptly and do not disclose publicly until we've had reasonable time to address
- Do not demand payment or make threats

### Bug Bounty

We offer bounties for responsibly disclosed vulnerabilities:

| Severity | Bounty Range |
|----------|--------------|
| Critical | $5,000 - $25,000 |
| High | $1,000 - $5,000 |
| Medium | $250 - $1,000 |
| Low | Recognition |

Severity is determined by:
- Impact on user funds
- Exploitability (authentication required, complexity)
- Affected user count

**Payment:** USDC on Solana (or SOL if preferred)

### Disclosure Timeline

1. **Day 0**: Vulnerability reported
2. **Day 7**: Initial triage complete
3. **Day 30**: Fix developed and tested (target)
4. **Day 45**: Fix deployed to mainnet (target)
5. **Day 90**: Public disclosure (coordinated with reporter)

We may request extensions for complex issues. We will credit reporters in public disclosures unless anonymity is preferred.

## Security Documentation

- [Threat Model](docs/security/THREAT_MODEL.md)
- [Audit Status](docs/security/AUDIT_TRACKER.md)
- [Key Management](docs/security/KEY_MANAGEMENT.md)

## Acknowledgments

We thank the following researchers for responsible disclosures:

*No disclosures yet.*

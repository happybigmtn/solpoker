# Security Assurance Spec

## Threat Modeling + Audit
- AC-SEC1.1: Threat model covers on-chain program, entropy provider, UI, and key management.
- AC-SEC1.2: External or independent audit completed; all Critical/High findings resolved or formally accepted.
- AC-SEC1.3: Security findings are tracked with owners, remediation plans, and verification evidence.

## Testing & Verification
- AC-SEC1.4: Property tests or fuzzing cover core invariants (chip conservation, pot/rake accounting, action legality).
- AC-SEC1.5: Static analysis and linting are run in CI for both Rust and TypeScript.
- AC-SEC1.6: Dependency audit scans run in CI with documented patch policy for vulnerabilities.

## Key Management + Disclosure
- AC-SEC1.7: Production keys are stored in hardware or encrypted keystores with access logging.
- AC-SEC1.8: Key rotation and incident response procedures are documented and tested.
- AC-SEC1.9: Responsible disclosure policy and contact channel are published.

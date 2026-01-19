# solpoker

Solana-first on-chain poker stack using Pinocchio programs, a deterministic core engine, Token-2022 CRISPS currency, and an entropy-style RNG provider.

## Workspace

- `crates/robopoker-core`: deterministic poker rules + card evaluation core
- `programs/`: on-chain programs (Pinocchio)
- `clients/`: generated SDKs
- `ralph/`: specs + implementation plan
- `PLAN.md`: high-level architecture and milestones

## Status

This repo has been trimmed to only include code relevant to the on-chain program. Training, analysis, and hosting components from the original robopoker project have been removed.

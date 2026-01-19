# Devnet Deployment Spec

## Program Deployment
- AC-D1.1: Both programs (poker + entropy) build successfully via `cargo build-sbf` with no errors or warnings.
- AC-D1.2: Both programs deploy to Solana devnet and return valid program IDs.
- AC-D1.3: Deployed programs are verified (bytecode matches local build).

## Configuration Initialization
- AC-D2.1: Entropy config PDA is initialized with a valid provider address and bond parameters.
- AC-D2.2: Poker config PDA is initialized with CRISPS mint address, entropy program reference, buy-in bounds, and action timeout.
- AC-D2.3: Config accounts are readable via RPC and deserialize to expected state.

## Token Setup
- AC-D3.1: CRISPS mint is created as a Token-2022 mint with 9 decimals.
- AC-D3.2: Mint authority is set to a known keypair or PDA for devnet testing.
- AC-D3.3: Test accounts can receive minted CRISPS via airdrop/faucet mechanism.

## Deployment Automation
- AC-D4.1: A single command deploys both programs, initializes configs, and creates the mint.
- AC-D4.2: Deployed addresses are written to environment file for client consumption.
- AC-D4.3: Re-running deployment is idempotent (does not fail or corrupt state).

## Devnet Verification
- AC-D5.1: A table can be created on devnet and is visible via RPC.
- AC-D5.2: A player can join the table with a CRISPS buy-in on devnet.
- AC-D5.3: The full hand lifecycle completes on devnet (deal → actions → settle).

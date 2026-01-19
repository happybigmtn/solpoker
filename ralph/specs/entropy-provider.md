# Entropy Provider Service Spec

## Hash Chain Management
- AC-EP1.1: The provider generates a hash chain of configurable depth (default 10,000) from a seed.
- AC-EP1.2: The hash chain is persisted to disk and can be loaded across restarts.
- AC-EP1.3: The chain head (commitment) matches on-chain verification when posted.
- AC-EP1.4: Chain position advances correctly after each reveal; old preimages are consumed.

## Commitment Flow
- AC-EP2.1: The provider posts a `commit` transaction with the current chain head and required bond.
- AC-EP2.2: Commitment transactions confirm on-chain and create valid Commitment accounts.
- AC-EP2.3: The provider tracks pending commitments awaiting reveal.

## Reveal Flow
- AC-EP3.1: The provider monitors the target slot for each commitment.
- AC-EP3.2: The provider reveals the preimage after the target slot has passed.
- AC-EP3.3: The reveal completes before the deadline slot to avoid slashing.
- AC-EP3.4: Revealed preimage XOR slothash produces the expected randomness on-chain.

## Request Handling
- AC-EP4.1: The provider subscribes to entropy request account changes via WebSocket.
- AC-EP4.2: New requests trigger automatic commitment if none pending.
- AC-EP4.3: The provider handles multiple concurrent requests without race conditions.

## Reliability
- AC-EP5.1: The provider reconnects automatically after RPC disconnection.
- AC-EP5.2: The provider persists state on graceful shutdown (SIGTERM/SIGINT).
- AC-EP5.3: The provider resumes pending operations after restart.
- AC-EP5.4: The provider logs all commit/reveal activity with timestamps.

## CLI
- AC-EP6.1: CLI command generates a new hash chain and saves to file.
- AC-EP6.2: CLI command starts the provider daemon with specified config.
- AC-EP6.3: CLI command reports current provider status (chain position, pending ops).

## Perceptual Quality
- AC-PQ.EP1: The provider operates silently when healthy; only errors surface to logs.
- AC-PQ.EP2: Status output is concise and actionable (chain depth, pending, last activity).

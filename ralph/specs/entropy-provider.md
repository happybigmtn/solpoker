# Entropy Provider Spec

## Hash Chain Management
- AC-EP1.1: Generate a hash chain from a seed with configurable depth.
- AC-EP1.2: Persist the chain to disk and load it on restart.
- AC-EP1.3: Commitment derived from the chain head matches on-chain verification.
- AC-EP1.4: Chain position advances as preimages are revealed.

## Commitment Flow (On-Chain)
- AC-EP2.1: Provider posts commit transactions with chain head and bond; PDAs and instruction data match the on-chain program.
- AC-EP2.2: Commitment transactions confirm on-chain and create valid Commitment accounts.
- AC-EP2.3: Provider tracks pending commitments awaiting reveal and persists this state.

## Reveal Flow + Randomness
- AC-EP3.1: Provider monitors target slot for each commitment.
- AC-EP3.2: Provider reveals preimage after the target slot has passed.
- AC-EP3.3: Reveal completes before the deadline slot to avoid slashing.
- AC-EP3.4: Randomness derivation matches preimage XOR slothash and is deterministic.

## Request Subscription
- AC-EP4.1: Provider subscribes to entropy request account changes via WebSocket (or equivalent polling).
- AC-EP4.2: Provider auto-commits when new requests arrive.
- AC-EP4.3: Concurrent requests are handled safely (mutex/throttling) without race conditions.

## Reliability + Logging
- AC-EP5.1: Provider reconnects automatically after RPC disconnection with backoff.
- AC-EP5.2: Provider persists state on graceful shutdown.
- AC-EP5.3: Provider resumes pending operations after restart.
- AC-EP5.4: Log entries include timestamps and operation types for commit/reveal/connection events.

## CLI + Ops
- AC-EP6.1: `generate` command creates a valid hash chain file.
- AC-EP6.2: `start` command launches provider daemon with specified config (RPC/WS, program ID, keypair, state paths).
- AC-EP6.3: `status` command reports chain position, remaining capacity, and pending commitments.

## Perceptual Quality
- AC-PQ.EP1: Default logging is quiet when healthy (warn level) but surfaces warnings on degradation and errors on failure.
- AC-PQ.EP2: Status output is actionable (includes remaining chain capacity and pending count).

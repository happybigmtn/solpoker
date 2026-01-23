# On-Chain Poker (CRISPS + Entropy RNG) — Acceptance Criteria

## Core Architecture
- AC-POK1.1: The repo contains a dedicated on-chain-ready core crate that is deterministic (no runtime RNG) and can run in `no_std` contexts.
- AC-POK1.2: All on-chain-facing game state serialization uses fixed-size layouts (no variable-length vectors in account data).
- AC-POK1.3: Chips and pot values use `u64` across on-chain paths.
- AC-POK1.4: Pinocchio program crates exist for entropy and poker, each with a valid entrypoint and instruction router.
- AC-POK1.5: Account layouts are size-optimized (largest-to-smallest field ordering, bitflags where appropriate) and account byte sizes are documented.
- AC-POK1.6: Program logic avoids heap allocation and uses explicit, fixed-size buffers for instruction data and state transitions.

## Entropy (Self-Hosted, Entropy-Style)
- AC-POK2.1: The entropy program accepts provider commitments that are verifiable via a hash chain (preimage reveals validate the chain).
- AC-POK2.2: Randomness is derived from a revealed preimage and a slot-derived slothash and is verifiable on-chain.
- AC-POK2.3: Providers post a bond; failure to reveal within the configured window triggers a slash or forfeiture.
- AC-POK2.4: The poker program can request and finalize randomness via CPI to the entropy program.
- AC-POK2.5: A single-provider mode is supported and documented; provider identity is stored in config and enforced.

## Privacy (Practical Hybrid)
- AC-POK2.6: Hole cards are private off-chain via provider encryption; on-chain stores ciphertexts or their hashes.
- AC-POK2.7: Provider reveals the seed at showdown; the program verifies the commitment and deck derivation.
- AC-POK2.8: Revealed hole cards must match the derived deck order for the hand to settle.

## CRISPS Token & Escrow
- AC-POK3.1: CRISPS mint is defined as Token-2022 and its mint authority is controlled by a known authority (PDA or fixed key) recorded in config.
- AC-POK3.2: Each table uses a PDA-owned vault token account (Token-2022) to escrow player buy-ins.
- AC-POK3.3: Join/leave flows correctly debit/credit player token accounts and the table vault.

## Rake + Staking (Integrated)
- AC-POK3.4: Standard rake is charged per hand and accumulated in a staking rewards pool.
- AC-POK3.5: Stakers can deposit/withdraw CRISPS into a staking pool managed by the poker program.
- AC-POK3.6: Rake distributions are proportional to staked balances and are claimable via an on-chain instruction.

## Table Lifecycle & Seating (Multiplayer)
- AC-POK4.1: Tables support MAX_SEATS = 10 with a defined empty seat state.
- AC-POK4.2: A table can be created, joined, and left without corrupting other seat state.
- AC-POK4.3: A hand can be started only when the table meets minimum active players.
- AC-POK4.4: Action timeouts are enforced via slot-based deadlines with deterministic fallback actions.

## Betting & Turn Order
- AC-POK5.1: Betting rounds enforce turn order, legal action sets, and stake matching for all active seats.
- AC-POK5.2: Raise bounds, call amounts, and all-in logic are enforced deterministically.
- AC-POK5.3: The program prevents illegal actions (out-of-turn, insufficient stack, invalid raise).

## Settlement & Payouts
- AC-POK6.1: Showdown evaluation uses deterministic hand strength rules and produces correct side-pot payouts.
- AC-POK6.2: Total payouts equal total risked chips across all players (no mint/burn unless specified).

## Security & Invariants
- AC-POK7.1: All instructions validate account owners, signer status, and expected program IDs.
- AC-POK7.2: All PDA derivations are verified on-chain and mismatches fail.
- AC-POK7.3: Duplicate mutable account inputs are rejected.
- AC-POK7.4: All arithmetic uses checked math and fails on overflow/underflow.

## Testing & SDK
- AC-POK8.1: Each instruction has at least one unit test that asserts success and a relevant failure mode.
- AC-POK8.2: A full-hand integration test covers join -> start -> actions -> settle for 3+ players.
- AC-POK8.3: A typed client SDK is generated from IDL and can build valid instructions for core flows.

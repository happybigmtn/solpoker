# Robopoker On-Chain Migration Plan (Pinocchio + CRISPS + Entropy-Style RNG)

Date: 2026-01-19

## 1) Goals (What we are building)
- Fully on-chain multiplayer Texas Hold'em game state machine.
- Deterministic, verifiable randomness modeled after regolith-labs/entropy (commit/reveal + slothash), but implemented in-house (no external VRF provider).
- CRISPS Token-2022 mint used as the in-game currency and escrowed in program-owned vaults.
- Pinocchio programs for minimal binary size and compute efficiency.
- Typed client SDK generated from IDL (Shank -> Codama) with @solana/kit-first usage.

## 2) Non-Goals (Initial scope)
- No on-chain training/solver (MCCFR stays off-chain; only rules/settlement on-chain).
- No privacy-preserving ZK poker in v1 (we will use commit/reveal + encryption or commitments, not full ZK).
- No third-party VRF provider integrations.

## 3) Architecture Overview
### Programs
1) `crisps_entropy` (Pinocchio)
   - Provides randomness commitments and reveals, using slothash anchoring.
   - Maintains provider bonds and penalizes non-reveal.

2) `robopoker_onchain` (Pinocchio)
   - Core game logic: table creation, joining/leaving, hand lifecycle, betting rounds, settlement.
   - Consumes randomness from `crisps_entropy` to derive deck order.

3) Token Program (Token-2022)
   - CRISPS mint, mint authority held by PDA (or fixed authority if we want fixed supply).
   - Associated Token Accounts (ATAs) for players and table vaults.

### Off-chain Services
1) Entropy Provider Service (self-hosted)
   - Maintains hash chain for commitments.
   - Submits commit transactions and later reveals preimages.
   - Monitors slothash slots and reveal windows.

2) Game Coordinator (optional)
   - Watches on-chain tables, posts prompts, and optionally submits timeout actions.

## 4) Core Code Refactor (On-chain Friendly)
### New Crates / Workspace Layout
- `crates/robopoker-core`: minimal deterministic poker engine (no RNG, no dynamic allocs where possible).
- `programs/crisps-entropy`: entropy/VRF-style program (Pinocchio).
- `programs/robopoker-onchain`: game program (Pinocchio).
- `clients/ts/robopoker-onchain`: Codama-generated client.

### Core Engine Changes
- Replace `rand` usage in `Deck` with deterministic shuffle from a seed.
- Replace `Chips` (i16) with `u64`.
- Replace variable-length collections in on-chain paths with fixed-size arrays (e.g., MAX_SEATS).
- Make all game state serialization explicit and fixed-size.

## 5) Randomness Design (Entropy-style, self-hosted)
### Protocol Summary
1) Provider precomputes hash chain: H^n(seed).
2) Provider commits chain head on-chain with a chosen reveal window.
3) For each hand, players optionally commit their own secrets; final randomness mixes:
   - provider preimage (revealed later),
   - slothash from a chosen slot,
   - XOR or hash of all player reveals.
4) Provider reveals preimage after the slothash slot has passed.
5) `crisps_entropy` verifies preimage and derives randomness via:
   - `R = hash(preimage || slothash || player_entropy)`.

### Privacy (Practical Hybrid)
- Provider derives deck from the seed and encrypts hole cards off-chain for each player.
- Ciphertexts (or hashes) are stored on-chain; players decrypt locally.
- At showdown, provider reveals the seed; the program verifies the commitment and deck.

### Liveness / Withholding Resistance
- Provider posts a bond; failure to reveal within window burns/slashes bond.
- Tables may specify a maximum reveal window; after timeout, table can advance using fallback (e.g., player entropy only) or cancel hand.
- Single provider enforced for v1.

### On-chain Accounts (Entropy)
- `EntropyConfig`: admin, provider registry, bond requirements.
- `ProviderState`: current chain head, commitment slot, reveal deadline, bond vault.

## 6) Game Program State Model
### Fixed Parameters
- `MAX_SEATS`: 10 (fixed to keep account size bounded).
- `MAX_ACTIONS_PER_ROUND`: cap to prevent infinite loops.

### Accounts
- `GameConfig`: global settings (CRISPS mint, fee/rake, entropy program, max seats).
- `Table`: table metadata, seat array, current hand state, pot, board, dealer/button, RNG pointer.
- `TableVault`: PDA token account holding escrowed CRISPS.

### Seat Structure (fixed array element)
- `player: Pubkey`
- `stack: u64`
- `stake: u64`
- `spent: u64`
- `state: u8` (betting/shoving/folding/empty)
- `commitment: [u8; 32]` (optional)
- `hole_cards: [u8; 2]` (encrypted or revealed)

### Board / Deck
- `board_len: u8` and `board_cards: [u8; 5]`
- `deck_cursor: u8` and `deck_seed: [u8; 32]`
- Derived deck order via deterministic shuffle from `deck_seed`.

## 7) Instruction Set (Robopoker)
1) `init_config`
2) `create_table`
3) `join_table`
4) `leave_table`
5) `start_hand`
6) `commit_player_entropy`
7) `reveal_player_entropy`
8) `request_entropy` (CPI into entropy program)
9) `finalize_entropy` (derive deck seed)
10) `deal_flop` / `deal_turn` / `deal_river`
11) `player_action` (fold/check/call/raise/shove)
12) `settle_hand`
13) `timeout_action` (auto-fold/check to enforce liveness)

## 8) CRISPS Token Plan
- Mint CRISPS via Token-2022.
- Store mint pubkey in `GameConfig`.
- Table vaults are ATAs owned by PDA (table) to escrow buy-ins.
- Optional metadata setup using Metaplex Token Metadata (name/symbol/icon).

## 9) Rake + Staking (Integrated)
- Standard rake per hand is accumulated into a staking rewards pool.
- Stakers deposit/withdraw CRISPS directly in the poker program.
- Rewards are claimable proportionally by staked balance.

## 10) Testing Strategy
- Unit tests: LiteSVM or Mollusk per instruction (success + failure cases).
- Integration tests: full hand flow for 3-6 players, including side pots and timeouts.
- Compute profiling: CU benchmarks for `player_action` and `settle_hand`.

## 11) Security Checklist (must-pass)
- Owner, signer, PDA, and program-ID validation for all instructions.
- No re-initialization of tables or seats.
- Duplicate account prevention for mutable accounts.
- Checked math for all stack/pot operations.
- Timeout rules to prevent griefing.

## 12) Milestones
1) Core crate extraction + deterministic deck.
2) Entropy program + provider service.
3) Robopoker program (table lifecycle + betting).
4) Settlement + side pots + payouts.
5) CRISPS mint + vault escrow flows.
6) Tests + benchmarking + basic client SDK.

## 13) Open Decisions / Clarifications
- None (current decisions locked in for v1)

# Sprint Plan (2026-01-20)

## Assumptions + Stack
- Each task is atomic and intended to be a single, reviewable commit.
- Validation can be tests or scripted checks when unit tests are not feasible.
- Solana stack: use `@solana/kit` for all new client/tx work, framework-kit (`@solana/client` + `@solana/react-hooks`) for UI, and confine any legacy web3.js usage behind a compat adapter.
- Programs: Pinocchio for on-chain efficiency and explicit layout control.
- Testing strategy: LiteSVM/Mollusk for unit tests; Surfpool for integration tests when cluster realism is needed.

---

## Sprint 1: Core Program Scaffolding
Goal: Deterministic core crate + program shells compile and deploy locally.
Demo: `cargo build-sbf` succeeds; programs deploy to local validator and accept a smoke initialize instruction.

Tasks:
- [ ] Enforce deterministic core crate (`no_std`, no RNG) and fixed-size serialization. Validation: unit tests for deterministic state transitions.
- [ ] Document account layouts + byte sizes; add size assertions in tests. Validation: size assertion tests.
- [ ] Create Pinocchio program crates with entrypoints and instruction routers. Validation: local deploy + smoke instruction.
- [ ] Add checked math helpers and explicit fixed-size buffers for instruction/state transitions. Validation: overflow/underflow failure tests.

## Sprint 2: Entropy On-Chain + Privacy
Goal: Entropy commit/reveal works on-chain and privacy flow is verifiable.
Demo: Poker program finalizes randomness via CPI and verifies seed reveal at showdown.

Tasks:
- [ ] Implement commitment verification with hash-chain preimage checks (AC-2.1). Validation: unit tests for commit/reveal correctness.
- [ ] Derive randomness from preimage + slothash and enforce bond slashing (AC-2.2, AC-2.3). Validation: tests for slothash mix + slash on missed reveal.
- [ ] Add poker CPI request/finalize + single-provider enforcement (AC-2.4, AC-2.5). Validation: CPI integration test.
- [ ] Implement hole-card privacy (ciphertext/hash) + seed reveal verification (AC-2.6 to AC-2.8). Validation: deck derivation + reveal checks.

## Sprint 3: Token + Escrow + Staking
Goal: CRISPS mint and escrow flows are correct on-chain.
Demo: Local tests show join/leave and staking deposit/withdraw/claim with correct balances.

Tasks:
- [ ] Create Token-2022 CRISPS mint and record authority in config (AC-3.1). Validation: mint authority tests.
- [ ] Create table vault (PDA-owned Token-2022 ATA) and escrow buy-ins (AC-3.2, AC-3.3). Validation: token balance tests.
- [ ] Implement rake pool sweep and staking deposit/withdraw/claim (AC-3.4 to AC-3.6). Validation: staking tests + proportional distribution checks.

## Sprint 4: Table Lifecycle + Betting + Settlement
Goal: Full hand progression works with legal action enforcement and correct payouts.
Demo: Integration test runs join -> start -> actions -> settle for 3+ players.

Tasks:
- [ ] Implement table create/join/leave with seat state transitions (AC-4.1, AC-4.2). Validation: lifecycle tests.
- [ ] Enforce start-hand requirements and timeouts with deterministic fallback (AC-4.3, AC-4.4). Validation: timeout tests.
- [ ] Implement betting rounds with turn order and legal action sets (AC-5.1 to AC-5.3). Validation: illegal action failure tests.
- [ ] Implement showdown + side-pot payout logic (AC-6.1, AC-6.2). Validation: side-pot payout tests.

## Sprint 5: Security + Testing + SDK Generation
Goal: Program invariants are enforced and SDK is generated with tests.
Demo: Full test suite passes and SDK builds valid instructions for core flows.

Tasks:
- [ ] Validate owners/signers/PDAs, reject duplicate mutable accounts, and enforce checked math (AC-7.1 to AC-7.4). Validation: negative tests + overflow tests.
- [ ] Add per-instruction unit tests with success + failure cases (AC-8.1). Validation: LiteSVM/Mollusk tests.
- [ ] Add full-hand integration test for 3+ players (AC-8.2). Validation: integration test.
- [ ] Generate typed SDK from IDL with instruction builders (AC-8.3). Validation: SDK smoke tests.

## Sprint 6: Entropy Provider Service
Goal: Provider reliably commits/reveals and handles concurrency.
Demo: Provider fulfills requests against local validator end-to-end.

Tasks:
- [ ] Hash chain generation + persistence (AC-EP1.1 to AC-EP1.4). Validation: unit tests.
- [ ] Commit flow + pending tracking (AC-EP2.1 to AC-EP2.3). Validation: integration test.
- [ ] Slot monitoring + reveal pipeline + randomness validation (AC-EP3.1 to AC-EP3.4). Validation: deadline + randomness tests.
- [ ] Request subscription + concurrency handling (AC-EP4.1 to AC-EP4.3). Validation: multi-request simulation.
- [ ] Reliability + logging (AC-EP5.1 to AC-EP5.4). Validation: disconnect/restart tests.
- [ ] CLI commands (AC-EP6.1 to AC-EP6.3) and UX quality (AC-PQ.EP1 to AC-PQ.EP2). Validation: CLI smoke tests + log review.

## Sprint 7: Client Integration + UI Wiring
Goal: UI builds/sends real transactions and renders tables/cards.
Demo: UI connects wallet, lists tables, creates/joins table, and sends actions.

Tasks:
- [ ] PDA helpers + instruction builders in TS SDK (AC-CI1.1 to AC-CI1.4). Validation: TS unit tests.
- [ ] Transaction wiring + signing + status surfacing (AC-CI2.1 to AC-CI2.4, AC-PQ.CI1). Validation: hook tests.
- [ ] Action wiring (fold/check/call/raise/shove/join/leave) (AC-CI3.1 to AC-CI3.7). Validation: hook tests.
- [ ] Error handling + simulation surfacing (AC-CI4.1 to AC-CI4.4, AC-PQ.CI2). Validation: error mapping tests.
- [ ] Table discovery + card rendering (AC-CI5.1 to AC-CI6.4, AC-PQ.CI3). Validation: component tests.

## Sprint 8: UX Polish + Devnet Deployment
Goal: UX/perf/accessibility are solid and devnet demo is ready.
Demo: Devnet hand completes with a real wallet and provider.

Tasks:
- [ ] Framework-kit + wallet standard + App Router structure (AC-1.1 to AC-1.5). Validation: UI smoke tests.
- [ ] Keyboard-first UX (palette + shortcuts + raise input) (AC-2.1 to AC-2.4). Validation: component tests.
- [ ] Layout + state messaging + performance constraints (AC-3.1 to AC-4.10). Validation: render tests + bundle check.
- [ ] Accessibility/forms/typography/navigation/touch/assets/hydration/theming (AC-5.1 to AC-11.1). Validation: lint + manual keyboard walkthrough.
- [ ] UI perceptual quality (AC-PQ.1 to AC-PQ.3). Validation: manual QA.
- [ ] Deploy script builds + deploys programs, initializes configs, creates CRISPS mint + metadata (AC-D1.1 to AC-D3.4, AC-D4.1). Validation: run `./scripts/deploy-devnet.sh` + RPC verification.
- [ ] Idempotency + env output for clients (AC-D4.2 to AC-D4.3). Validation: re-run deploy script + `./scripts/verify-programs.sh`.
- [ ] Devnet table lifecycle via scripts/RPC (AC-D5.1 to AC-D5.3). Validation: lifecycle script + RPC inspection.
- [ ] Devnet demo readiness (provider + UI) (AC-D6.1 to AC-D6.6). Validation: run provider + UI, update devnet status doc.

---

## Subagent Review Prompt
If you were to break this project down into sprints and tasks, how would you do it (timeline info does not need to be included and doesn't matter) - every task/ticket should be an atomic, committable piece of work with tests (and if tests don't make sense another form of validation that it was completed successfully). Every sprint should result in a demoable piece of software that can be run, tested, and build on top of previous work/sprints. Be exhaustive, be clear, be technical, always focus on small atomic tasks that compose up into a clear goal for the sprint. Once you're done, provide this prompt to a subagent to review your work and suggest improvements. When you're done reviewing the suggested improvements, write your tasks/tickets, sprint plans, etc., to a markdown file.

## Incorporated Improvements (Post-Review)
- Added explicit AC references to each sprint task to ensure traceability to specs.
- Split security/invariants into a dedicated sprint with explicit negative tests and checked math coverage (AC-7.4).
- Kept devnet verification tasks grouped with deployment to enforce end-to-end demo readiness.

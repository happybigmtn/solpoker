# Sprint Plan

## Assumptions + Stack
- Each task is atomic and intended to be a single, reviewable commit.
- Validation can be tests or scripted checks when unit tests are not feasible.
- Solana stack: use `@solana/kit` for all new client/tx work, framework-kit (`@solana/client` + `@solana/react-hooks`) for UI, and confine any legacy web3.js usage behind a compat layer.
- Testing strategy: LiteSVM/Mollusk for unit tests; Surfpool for integration tests when cluster realism is needed.

---

## Sprint 1: Core Program Scaffolding
Goal: Deterministic core crate + program shells compile and deploy locally.
Demo: `cargo build-sbf` succeeds; programs deploy to local validator and accept a no-op/initialize instruction.

Tasks:
- [ ] Enforce deterministic core crate (`no_std`, no RNG) and fixed-size serialization. Validation: unit tests for deterministic state transitions.
- [ ] Define and document account layouts + byte sizes. Validation: size assertions in tests.
- [ ] Ensure Pinocchio program crates exist with entrypoints and instruction routers. Validation: local deploy + smoke instruction.
- [ ] Add checked math helpers and guardrails for overflow/underflow. Validation: unit tests for overflow failure paths.

## Sprint 2: Config + Token Foundations
Goal: Config PDAs and token primitives are correct on-chain.
Demo: Local validator initializes poker + entropy configs and creates CRISPS mint/vault accounts.

Tasks:
- [ ] Implement poker + entropy config PDA derivations and on-chain verification. Validation: unit tests against known seeds/bumps.
- [ ] Implement config init instructions with provider identity + bond params. Validation: LiteSVM tests for config fields.
- [ ] Create CRISPS mint + vault flows (Token-2022). Validation: tests assert mint authority and vault ownership.
- [ ] Add basic ownership/signer checks for all config instructions. Validation: failure-mode tests.

## Sprint 3: Table Lifecycle + Escrow
Goal: Tables can be created, joined, and left safely with escrowed tokens.
Demo: Local test creates a table and processes join/leave with correct balances.

Tasks:
- [ ] Create table instruction + state layout; enforce seat count. Validation: unit tests for layout + invariants.
- [ ] Join/leave instructions with token transfers to/from vault. Validation: balance assertions.
- [ ] Enforce action timeouts via slot-based deadlines. Validation: timeout path test.
- [ ] Add PDA verification + owner checks for table/vault accounts. Validation: negative tests.

## Sprint 4: Betting, Privacy, Settlement
Goal: Full hand plays through with deterministic rules and correct payouts.
Demo: Integration test runs join → start → actions → settle for 3+ players.

Tasks:
- [ ] Implement betting rounds with turn-order + legal action sets. Validation: unit tests for illegal actions.
- [ ] Enforce raise bounds/call amounts/all-in logic. Validation: edge-case tests.
- [ ] Add hole-card privacy flow (hash/ciphertext) and showdown seed reveal verification. Validation: tests for deck derivation.
- [ ] Implement deterministic showdown + side-pot payout logic. Validation: payout invariants.

## Sprint 5: Entropy Provider Service
Goal: Provider generates, commits, reveals, and recovers reliably.
Demo: Provider fulfills requests against local validator end-to-end.

Tasks:
- [ ] Hash chain generation + persistence. Validation: unit tests for chain depth + reload.
- [ ] Commitment posting + pending tracking. Validation: integration test for Commitment account creation.
- [ ] Slot monitoring + reveal flow with deadline guard. Validation: test reveals before deadline.
- [ ] Request subscription + concurrency handling. Validation: multi-request simulation test.
- [ ] Reliability: reconnect, resume, logging. Validation: disconnect/restart tests.
- [ ] CLI: generate chain, run daemon, status. Validation: CLI smoke tests.

## Sprint 6: SDK + Client Wiring
Goal: Typed SDK and UI can build/send core transactions.
Demo: UI connects wallet, lists tables, creates and joins a table.

Tasks:
- [ ] SDK PDA helpers + instruction builders with tests. Validation: TS unit tests for vectors.
- [ ] Error decoding + retry classification utilities. Validation: unit tests.
- [ ] Wallet Standard connection via framework-kit in UI. Validation: connect/disconnect flow.
- [ ] Join/leave/create transactions wired in UI with status feedback. Validation: hook tests + UI smoke.

## Sprint 7: Gameplay UI + UX/Perf
Goal: In-hand actions, command palette, and table view are production-ready.
Demo: Local hand progresses with action history, keyboard shortcuts, and visible board.

Tasks:
- [ ] Table view + subscriptions to on-chain state. Validation: UI updates on state changes.
- [ ] Action controls with keyboard shortcuts + raise input. Validation: component tests for shortcuts.
- [ ] Action history + inline transaction feedback. Validation: UI tests for logs/status.
- [ ] Accessibility sweep: focus, labels, aria-live, skip links. Validation: lint + manual keyboard walkthrough.
- [ ] Performance: Suspense boundaries, dynamic imports, bundle hygiene. Validation: build size check + render smoke.

## Sprint 8: Devnet Deployment + Demo Readiness
Goal: Devnet demo works end-to-end with provider + UI.
Demo: Devnet hand completes with a real wallet.

Tasks:
- [ ] Deployment script: programs + configs + mint + metadata. Validation: script success + idempotency.
- [ ] Env output for SDK/UI (program IDs, mint). Validation: UI loads with env.
- [ ] Provider runs against devnet and fulfills requests. Validation: commit/reveal observed on devnet.
- [ ] UI devnet verification: connect, balances, join, actions, settle, leave. Validation: checklist in devnet status doc.

---

## Subagent Review Prompt
If you were to break this project down into sprints and tasks, how would you do it (timeline info does not need to be included and doesn't matter) - every task/ticket should be an atomic, committable piece of work with tests (and if tests don't make sense another form of validation that it was completed successfully). Every sprint should result in a demoable piece of software that can be run, tested, and build on top of previous work/sprints. Be exhaustive, be clear, be technical, always focus on small atomic tasks that compose up into a clear goal for the sprint. Once you're done, provide this prompt to a subagent to review your work and suggest improvements. When you're done reviewing the suggested improvements, write your tasks/tickets, sprint plans, etc., to a markdown file.

## Incorporated Improvements (Post-Review)
- Separated on-chain correctness (program scaffolding, escrow, betting) from off-chain provider/service work to keep sprints demoable.
- Added explicit validation steps for each task (tests or scripts).
- Added a dedicated UI performance and accessibility sweep before devnet launch.

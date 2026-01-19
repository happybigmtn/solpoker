# Sprint Plan

## Assumptions
- Local validation can be tests or scripted checks when unit tests are not feasible.
- Each task is atomic and should be deliverable as a single commit.

---

## Sprint 1: Program + PDA Foundations
Goal: Programs compile and core config/state can be initialized locally.
Demo: Local validator with both programs deployed and config accounts initialized.

Tasks:
- [ ] Build both programs with `cargo build-sbf` and resolve warnings. Validation: build succeeds cleanly.
- [ ] Implement/verify config PDA derivations for poker + entropy programs. Validation: Rust unit tests for PDA seeds and bumps.
- [ ] Implement config initialization instructions. Validation: LiteSVM/Mollusk tests assert config fields.
- [ ] Implement CRISPS mint + vault setup in program layer. Validation: test asserts Token-2022 mint and vault account owners.

## Sprint 2: Gameplay Flow (On-Chain)
Goal: Full hand lifecycle works end-to-end in local tests.
Demo: Local test executes create table -> join -> actions -> settle.

Tasks:
- [ ] Table creation instruction + account layout. Validation: unit tests confirm table state fields.
- [ ] Join/leave instructions with token transfers. Validation: tests assert vault/player balances.
- [ ] Start hand instruction with entropy commitment wiring. Validation: test verifies commitment linkage.
- [ ] Player action instruction (fold/check/call/raise/shove). Validation: tests assert stack/pot updates.
- [ ] Settle instruction and payout distribution. Validation: tests assert final stacks and pot zeroed.

## Sprint 3: Entropy Provider Service
Goal: Provider can generate, commit, reveal, and recover reliably.
Demo: Provider runs against local validator and fulfills entropy requests.

Tasks:
- [ ] Hash chain generation + persistence to disk. Validation: unit tests for chain length and reload.
- [ ] Commit transaction builder + submission. Validation: integration test posts commitment on local validator.
- [ ] Slot monitoring + reveal flow with deadline guard. Validation: test reveals before deadline.
- [ ] Request subscription + concurrency handling. Validation: test with multiple requests in flight.
- [ ] Reliability: reconnect, resume pending ops, structured logging. Validation: simulate disconnect + restart.
- [ ] CLI commands: generate chain, run daemon, show status. Validation: CLI smoke tests.

## Sprint 4: Client SDK + UI Foundation
Goal: UI can connect wallet, list tables, and create/join tables using SDK.
Demo: UI connects wallet and shows table list with create/join flows on local validator.

Tasks:
- [ ] TypeScript SDK: PDA helpers + instruction builders. Validation: TS unit tests with known vectors.
- [ ] Wallet Standard integration via framework-kit. Validation: UI connects/disconnects wallet.
- [ ] Lobby: table list + create table form wired to SDK. Validation: UI flow creates table.
- [ ] Join/leave table UI wiring with transaction status. Validation: UI reflects pending/confirmed/failed.
- [ ] Keyboard shortcuts + command palette for actions. Validation: component tests for shortcuts.

## Sprint 5: Gameplay UI + Table View
Goal: UI supports in-hand actions and renders table state.
Demo: Local hand plays through with visible board, actions, and settlement.

Tasks:
- [ ] Table page with subscriptions to on-chain state. Validation: UI updates on simulated state changes.
- [ ] Seat layout + board rendering from revealed seed. Validation: unit tests for card derivation.
- [ ] Action history panel + status toasts. Validation: UI displays action log updates.
- [ ] Raise amount input and keyboard controls. Validation: input tests for min/max/confirm.
- [ ] Accessibility pass: focus states, labels, aria-live updates. Validation: lint + manual keyboard walkthrough.

## Sprint 6: Devnet Deployment + Verification
Goal: Devnet demo works end-to-end with provider + UI.
Demo: Devnet hand completes via UI with real wallet.

Tasks:
- [ ] Devnet deploy script (programs + configs + mint + metadata). Validation: script succeeds and is idempotent.
- [ ] Env output for UI + SDK (program IDs, mint). Validation: UI reads env and loads.
- [ ] Run provider against devnet and fulfill requests. Validation: commitment + reveal observed on devnet.
- [ ] UI devnet verification: connect wallet, balances, join, actions, settle, leave. Validation: checklist in docs.
- [ ] Capture devnet verification notes + risks. Validation: updated devnet assessment doc.

---

## Subagent Review Prompt
If you were to break this project down into sprints and tasks, how would you do it (timeline info does not need included and doesnt matter) - every task/ticket should be an atomic, committable peice of work with tests (and if tests don't make sense another form of validatattion that it was completed successfully), every sprint should result in a demoable peice of software that can be run, tested, and build ontop of previous work/sprints. Be exhaustive, be clear, be technical, always focus on small atomic tasks that compose up into a clear goal for the sprint. Once you're done, provide this prompt to a subagent to review your work and suggest improvements. When you're done reviewing the suggest improvements write your tasks/tickets, sprint plans, etc to a md file.

## Incorporated Improvements (Post-Review)
- Split devnet deployment into script/idempotency tasks vs. UI verification tasks to keep commits atomic.
- Added explicit validation notes for each task (tests or scripted checks).
- Added a dedicated accessibility validation task in the UI sprint.

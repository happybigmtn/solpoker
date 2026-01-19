# Client Integration Spec

## PDA Derivation
- AC-CI1.1: TypeScript client exports functions to derive all program PDAs (config, table, vault, staking pool, staker position).
- AC-CI1.2: TypeScript client exports functions to derive all entropy PDAs (config, commitment, request).
- AC-CI1.3: Derived PDAs match the Rust program derivations exactly.
- AC-CI1.4: PDA derivation functions have unit tests verifying correctness.

## Transaction Building
- AC-CI2.1: UI builds player action transactions using SDK instruction builders (not mocked).
- AC-CI2.2: UI builds join/leave table transactions using SDK instruction builders.
- AC-CI2.3: Transactions are signed via connected wallet and sent to RPC.
- AC-CI2.4: Transaction confirmation is awaited and status is surfaced to user.

## Action Wiring
- AC-CI3.1: Fold action sends a `player_action` transaction with FOLD type.
- AC-CI3.2: Check action sends a `player_action` transaction with CHECK type.
- AC-CI3.3: Call action sends a `player_action` transaction with CALL type.
- AC-CI3.4: Raise action sends a `player_action` transaction with RAISE type and specified amount.
- AC-CI3.5: Shove action sends a `player_action` transaction with ALL_IN type.
- AC-CI3.6: Join table action sends a `join_table` transaction with buy-in amount.
- AC-CI3.7: Leave table action sends a `leave_table` transaction.

## Error Handling
- AC-CI4.1: Transaction failures surface user-readable error messages.
- AC-CI4.2: Program errors are decoded from transaction logs and displayed.
- AC-CI4.3: Network errors trigger retry with user feedback.
- AC-CI4.4: Simulation errors are surfaced before signing where possible.

## Table Management
- AC-CI5.1: UI can fetch all table accounts via `getProgramAccounts`.
- AC-CI5.2: UI displays table list with blinds, player count, and join option.
- AC-CI5.3: UI can create a new table with specified blinds.
- AC-CI5.4: Created table redirects to the table view.

## Card Visualization
- AC-CI6.1: Cards render with correct suit and rank based on card index.
- AC-CI6.2: Unrevealed cards display a card back.
- AC-CI6.3: Board cards update as streets are dealt (flop, turn, river).
- AC-CI6.4: Player hole cards display when revealed at showdown.

## Perceptual Quality
- AC-PQ.CI1: Transaction submission feels immediate; no visible delay before pending state.
- AC-PQ.CI2: Error messages are clear, specific, and suggest a next action.
- AC-PQ.CI3: Card rendering is visually clean and suit colors are distinct.

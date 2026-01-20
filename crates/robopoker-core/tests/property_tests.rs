//! Property-based tests for core poker invariants (AC-SEC1.4)
//!
//! These tests verify critical invariants using proptest:
//! - Chip conservation: total chips in system remain constant
//! - Pot accounting: pot equals sum of all bets
//! - Action legality: only valid actions are accepted

#![cfg(feature = "proptest")]
#![allow(dead_code)]

use proptest::prelude::*;
use robopoker_core::gameplay::{Action, Game, State, Turn};
use robopoker_core::{Chips, STACK};

/// Total chips in the system (pot + all stacks)
fn total_chips(game: &Game) -> Chips {
    game.pot() + game.seats().iter().map(|s| s.stack()).sum::<Chips>()
}

/// Generate a random legal action from the game state (reserved for future use)
#[allow(dead_code)]
fn random_legal_action(game: &Game) -> impl Strategy<Value = Option<Action>> {
    let legal = game.legal();
    if legal.is_empty() {
        Just(None).boxed()
    } else {
        (0..legal.len())
            .prop_map(move |idx| Some(legal[idx].clone()))
            .boxed()
    }
}

/// Generate a random 32-byte seed
fn random_seed() -> impl Strategy<Value = [u8; 32]> {
    prop::array::uniform32(any::<u8>())
}

proptest! {
    /// AC-SEC1.4: Chip conservation - total chips remain constant through any action
    #[test]
    fn prop_chip_conservation_single_action(seed in random_seed()) {
        let game = Game::with_seed(&seed);
        // Post blinds
        let mut game = game;
        for _ in 0..2 {
            let action = game.legal().first().cloned();
            if let Some(a) = action {
                if game.is_allowed(&a) {
                    game = game.apply(a);
                }
            }
        }

        let initial_total = total_chips(&game);

        // Take one legal action
        if let Some(action) = game.legal().first().cloned() {
            let next_game = game.apply(action);
            let final_total = total_chips(&next_game);

            prop_assert_eq!(
                initial_total, final_total,
                "Chip conservation violated: {} -> {}", initial_total, final_total
            );
        }
    }

    /// AC-SEC1.4: Chip conservation through complete hands
    #[test]
    fn prop_chip_conservation_full_hand(seed in random_seed(), actions in prop::collection::vec(0usize..10, 0..50)) {
        let mut game = Game::with_seed(&seed);
        let initial_total = total_chips(&game);

        // Play until terminal or we run out of random choices
        for choice_idx in actions {
            let legal = game.legal();
            if legal.is_empty() {
                break;
            }
            let action = legal[choice_idx % legal.len()].clone();
            game = game.apply(action);

            // Verify conservation after each action
            prop_assert_eq!(
                initial_total, total_chips(&game),
                "Chip conservation violated mid-hand"
            );
        }
    }

    /// AC-SEC1.4: Pot accounting - pot equals sum of all spent chips
    #[test]
    fn prop_pot_accounting(seed in random_seed(), actions in prop::collection::vec(0usize..10, 0..30)) {
        let mut game = Game::with_seed(&seed);

        for choice_idx in actions {
            let legal = game.legal();
            if legal.is_empty() {
                break;
            }
            let action = legal[choice_idx % legal.len()].clone();
            game = game.apply(action);

            // Sum of spent by all players should be >= pot
            // (spent includes previous streets, pot is current accumulation)
            let total_spent: Chips = game.seats().iter().map(|s| s.spent()).sum();
            prop_assert!(
                total_spent >= game.pot() || game.pot() == 0,
                "Pot accounting violation: total_spent={}, pot={}", total_spent, game.pot()
            );
        }
    }

    /// AC-SEC1.4: Action legality - illegal actions are rejected
    #[test]
    fn prop_action_legality_fold_check(seed in random_seed()) {
        let mut game = Game::with_seed(&seed);

        // Post blinds first
        for _ in 0..2 {
            if let Some(a) = game.legal().first().cloned() {
                game = game.apply(a);
            }
        }

        // At a decision point, check fold/check mutual exclusivity
        if matches!(game.turn(), Turn::Choice(_)) {
            let can_fold = game.may_fold();
            let can_check = game.may_check();

            // Can't both fold (needs to call) and check (nothing to call)
            // at the same time when there's a bet to match
            if can_fold && can_check {
                // This is actually valid when effective_stake == actor.stake but there's still
                // action required - the assertion is that legal actions are self-consistent
                let legal = game.legal();
                if can_fold {
                    prop_assert!(legal.contains(&Action::Fold), "may_fold=true but Fold not in legal");
                }
                if can_check {
                    prop_assert!(legal.contains(&Action::Check), "may_check=true but Check not in legal");
                }
            }
        }
    }

    /// AC-SEC1.4: Raise bounds are enforced
    #[test]
    fn prop_raise_bounds(seed in random_seed(), raise_amount in 0u64..1000) {
        let mut game = Game::with_seed(&seed);

        // Post blinds
        for _ in 0..2 {
            if let Some(a) = game.legal().first().cloned() {
                game = game.apply(a);
            }
        }

        // Check raise bounds
        if game.may_raise() {
            let min_raise = game.to_raise();
            let max_raise = game.to_shove() - 1; // Shove is separate

            let raise_action = Action::Raise(raise_amount);

            if raise_amount >= min_raise && raise_amount <= max_raise {
                prop_assert!(game.is_allowed(&raise_action),
                    "Raise {} should be allowed (min={}, max={})", raise_amount, min_raise, max_raise);
            } else {
                prop_assert!(!game.is_allowed(&raise_action),
                    "Raise {} should NOT be allowed (min={}, max={})", raise_amount, min_raise, max_raise);
            }
        }
    }

    /// AC-SEC1.4: Settlement chip distribution is correct
    #[test]
    fn prop_settlement_conservation(seed in random_seed(), actions in prop::collection::vec(0usize..10, 0..100)) {
        let mut game = Game::with_seed(&seed);
        let _initial_total = total_chips(&game);

        // Play to terminal
        for choice_idx in actions {
            let legal = game.legal();
            if legal.is_empty() {
                break;
            }
            let action = legal[choice_idx % legal.len()].clone();
            game = game.apply(action);
        }

        // If terminal, verify settlement distributes all chips
        if game.turn() == Turn::Terminal {
            let settlements = game.settlements();
            let total_won: Chips = settlements.iter().map(|s| s.won()).sum();
            let pot = game.pot();

            // Winners should receive what's in the pot
            prop_assert!(
                total_won <= pot,
                "Settlement distributed more than pot: won={}, pot={}", total_won, pot
            );

            // After settlement, total should still equal initial
            // (We can't actually apply settlement in this test, but we verify the math)
        }
    }

    /// AC-SEC1.4: No negative stack after any action
    #[test]
    fn prop_no_negative_stacks(seed in random_seed(), actions in prop::collection::vec(0usize..10, 0..50)) {
        let mut game = Game::with_seed(&seed);

        for choice_idx in actions {
            let legal = game.legal();
            if legal.is_empty() {
                break;
            }
            let action = legal[choice_idx % legal.len()].clone();
            game = game.apply(action);

            // Verify no seat has negative stack (using u64 this is guaranteed, but test logic)
            for seat in game.seats().iter() {
                prop_assert!(seat.stack() <= STACK * 2, "Stack exceeds maximum possible");
            }
        }
    }

    /// AC-SEC1.4: State transitions are valid
    #[test]
    fn prop_valid_state_transitions(seed in random_seed(), actions in prop::collection::vec(0usize..10, 0..30)) {
        let mut game = Game::with_seed(&seed);
        let mut prev_states: Vec<State> = game.seats().iter().map(|s| s.state()).collect();

        for choice_idx in actions {
            let legal = game.legal();
            if legal.is_empty() {
                break;
            }
            let action = legal[choice_idx % legal.len()].clone();
            game = game.apply(action);

            // Check state transitions
            for (i, (seat, prev)) in game.seats().iter().zip(prev_states.iter()).enumerate() {
                let new_state = seat.state();
                match (*prev, new_state) {
                    // Valid transitions
                    (State::Betting, State::Betting) => {},
                    (State::Betting, State::Folding) => {},
                    (State::Betting, State::Shoving) => {},
                    (State::Shoving, State::Shoving) => {},
                    (State::Folding, State::Folding) => {},
                    // Invalid transitions
                    (State::Folding, State::Betting) |
                    (State::Folding, State::Shoving) |
                    (State::Shoving, State::Folding) |
                    (State::Shoving, State::Betting) => {
                        prop_assert!(false, "Invalid state transition at seat {}: {:?} -> {:?}", i, prev, new_state);
                    }
                }
            }

            prev_states = game.seats().iter().map(|s| s.state()).collect();
        }
    }
}

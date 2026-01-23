#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

pub mod cards;
pub mod gameplay;

/// Chips and pot values use u64 across on-chain paths (AC-POK1.3)
pub type Chips = u64;
pub type Utility = f32;
pub type Probability = f32;

// game tree parameters (kept for rules/logic)
pub const N: usize = 2;
pub const STACK: Chips = 100;
pub const B_BLIND: Chips = 2;
pub const S_BLIND: Chips = 1;

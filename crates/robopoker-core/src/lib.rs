pub mod cards;
pub mod gameplay;

/// dimensional analysis types
pub type Chips = i16;
pub type Utility = f32;
pub type Probability = f32;

// game tree parameters (kept for rules/logic)
pub const N: usize = 2;
pub const STACK: Chips = 100;
pub const B_BLIND: Chips = 2;
pub const S_BLIND: Chips = 1;

/// trait for random generation, mainly (strictly?) for testing
pub trait Arbitrary {
    fn random() -> Self;
}

use super::*;
use crate::Chips;

/// Public profit/loss information visible to all players.
/// Represents chip movements and player state without revealing hole cards.
#[derive(Debug, Clone)]
pub struct PnL {
    reward: Chips,
    risked: Chips,
    status: State,
}

impl PnL {
    pub fn new(reward: Chips, risked: Chips, status: State) -> Self {
        Self {
            reward,
            risked,
            status,
        }
    }
    pub fn add(&mut self, amount: Chips) {
        self.reward += amount;
    }
    /// Returns the net profit (reward - risked). With u64 Chips, this saturates at 0 for losses.
    pub fn won(&self) -> Chips {
        self.reward().saturating_sub(self.risked())
    }
    pub fn reward(&self) -> Chips {
        self.reward
    }
    pub fn risked(&self) -> Chips {
        self.risked
    }
    pub fn status(&self) -> State {
        self.status
    }
}

impl core::fmt::Display for PnL {
    fn fmt(&self, f: &mut core::fmt::Formatter) -> core::fmt::Result {
        write!(f, "{:+}", self.won())
    }
}

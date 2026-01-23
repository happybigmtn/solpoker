use super::card::Card;
use super::hand::Hand;
use super::hole::Hole;
use super::street::Street;

/// Deck extends much of Hand functionality, with ability to remove cards from itself.
/// For on-chain determinism (AC-POK1.1), the deck uses seeded shuffling via `shuffle_with_seed`.
/// The seed comes externally from the entropy program.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Deck {
    hand: Hand,
    /// Index into the shuffled order for dealing
    cursor: u8,
    /// Number of cards in the shuffled order array
    count: u8,
    /// Shuffled card indices (max 52 cards)
    order: [u8; 52],
}

impl Default for Deck {
    fn default() -> Self {
        Self::new()
    }
}

impl Deck {
    /// Create a new unshuffled deck. Call `shuffle_with_seed` before dealing.
    pub fn new() -> Self {
        let mut order = [0u8; 52];
        let hand = Hand::from(Hand::mask());
        let count = hand.size() as u8;
        for i in 0..52 {
            order[i] = i as u8;
        }
        Self {
            hand,
            cursor: 0,
            count,
            order,
        }
    }

    /// Deterministically shuffle the deck using a 32-byte seed (AC-POK1.1).
    /// Uses a simple Fisher-Yates shuffle with seed-derived random values.
    /// The same seed always produces the same shuffle order.
    pub fn shuffle_with_seed(&mut self, seed: &[u8; 32]) {
        let n = self.hand.size();
        if n == 0 {
            return;
        }

        // Build array of card indices from current hand
        let mut indices = [0u8; 52];
        let mut count = 0usize;
        let mut hand_bits = u64::from(self.hand);
        while hand_bits > 0 {
            let card_idx = hand_bits.trailing_zeros() as u8;
            indices[count] = card_idx;
            count += 1;
            hand_bits &= hand_bits - 1;
        }

        // Fisher-Yates shuffle using seed bytes as entropy source
        // We cycle through seed bytes and combine them for larger ranges
        let mut seed_idx = 0usize;
        for i in (1..count).rev() {
            // Get a random index in [0, i] using seed bytes
            let rand_val = {
                let b0 = seed[seed_idx % 32] as u32;
                let b1 = seed[(seed_idx + 1) % 32] as u32;
                seed_idx += 2;
            (b0 | (b1 << 8)) as usize
            };
            let j = rand_val % (i + 1);

            // Swap
            indices.swap(i, j);
        }

        // Copy shuffled indices to order array
        for i in 0..count {
            self.order[i] = indices[i];
        }
        self.count = count as u8;
        self.cursor = 0;
    }

    pub fn contains(&self, card: &Card) -> bool {
        self.hand.contains(card)
    }

    /// Draw the next card from the shuffled deck.
    /// Panics if deck is empty or cursor has exceeded available cards.
    pub fn draw(&mut self) -> Card {
        assert!(self.hand.size() > 0, "deck is empty");
        assert!(self.cursor < self.count, "cursor {} >= count {}", self.cursor, self.count);

        let card_idx = self.order[self.cursor as usize];
        let card = Card::from(card_idx);
        self.hand.remove(card);
        self.cursor += 1;
        card
    }

    /// Deal cards for the next street (flop=3, turn=1, river=1)
    pub fn deal(&mut self, street: Street) -> Hand {
        (0..street.next().n_revealed())
            .map(|_| self.draw())
            .map(Hand::from)
            .fold(Hand::empty(), Hand::add)
    }

    /// Remove two cards from the deck to deal as hole cards
    pub fn hole(&mut self) -> Hole {
        let a = self.draw();
        let b = self.draw();
        Hole::from((a, b))
    }

    /// Get the remaining number of cards
    pub fn remaining(&self) -> usize {
        self.hand.size()
    }
}

impl From<Deck> for Hand {
    fn from(deck: Deck) -> Self {
        deck.hand
    }
}

impl From<Hand> for Deck {
    fn from(hand: Hand) -> Self {
        let mut deck = Self::new();
        deck.hand = hand;
        // Rebuild order array from hand
        let mut count = 0usize;
        let mut hand_bits = u64::from(hand);
        while hand_bits > 0 {
            let card_idx = hand_bits.trailing_zeros() as u8;
            deck.order[count] = card_idx;
            count += 1;
            hand_bits &= hand_bits - 1;
        }
        deck.count = count as u8;
        deck.cursor = 0;
        deck
    }
}

impl Iterator for Deck {
    type Item = Card;
    fn next(&mut self) -> Option<Self::Item> {
        if self.hand.size() == 0 || self.cursor >= self.count {
            return None;
        }
        Some(self.draw())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Test that the same seed always produces the same shuffle (AC-POK1.1 determinism)
    #[test]
    fn deterministic_shuffle() {
        let seed = [
            0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
            0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
            0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
            0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20,
        ];

        // Shuffle two decks with the same seed
        let mut deck1 = Deck::new();
        deck1.shuffle_with_seed(&seed);

        let mut deck2 = Deck::new();
        deck2.shuffle_with_seed(&seed);

        // Draw all cards and verify they match
        let cards1: Vec<Card> = (0..52).map(|_| deck1.draw()).collect();
        let cards2: Vec<Card> = (0..52).map(|_| deck2.draw()).collect();

        assert_eq!(cards1, cards2, "Same seed must produce same shuffle");
    }

    /// Test that different seeds produce different shuffles
    #[test]
    fn different_seeds_different_shuffles() {
        let seed1 = [0u8; 32];
        let seed2 = [1u8; 32];

        let mut deck1 = Deck::new();
        deck1.shuffle_with_seed(&seed1);

        let mut deck2 = Deck::new();
        deck2.shuffle_with_seed(&seed2);

        let cards1: Vec<Card> = (0..52).map(|_| deck1.draw()).collect();
        let cards2: Vec<Card> = (0..52).map(|_| deck2.draw()).collect();

        assert_ne!(cards1, cards2, "Different seeds should produce different shuffles");
    }
}

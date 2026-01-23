/**
 * Tests for card component utilities.
 *
 * AC-UI2.2: Card index 0–51 maps to correct suit/rank.
 */

import { describe, it, expect } from 'vitest';
import { getSuit, getRank, isRedSuit, getCardDisplay, Suit, Rank } from './card';

describe('Card utilities', () => {
  describe('getSuit', () => {
    it('maps index 0 to Clubs', () => {
      expect(getSuit(0)).toBe(Suit.CLUBS);
    });

    it('maps index 1 to Diamonds', () => {
      expect(getSuit(1)).toBe(Suit.DIAMONDS);
    });

    it('maps index 2 to Hearts', () => {
      expect(getSuit(2)).toBe(Suit.HEARTS);
    });

    it('maps index 3 to Spades', () => {
      expect(getSuit(3)).toBe(Suit.SPADES);
    });

    it('cycles suits for higher indices', () => {
      // Card 4 is 3♣ (rank=1, suit=0)
      expect(getSuit(4)).toBe(Suit.CLUBS);
      // Card 5 is 3♦ (rank=1, suit=1)
      expect(getSuit(5)).toBe(Suit.DIAMONDS);
      // Card 51 is A♠ (rank=12, suit=3)
      expect(getSuit(51)).toBe(Suit.SPADES);
    });
  });

  describe('getRank', () => {
    it('maps index 0-3 to Two', () => {
      expect(getRank(0)).toBe(Rank.TWO);
      expect(getRank(1)).toBe(Rank.TWO);
      expect(getRank(2)).toBe(Rank.TWO);
      expect(getRank(3)).toBe(Rank.TWO);
    });

    it('maps index 4-7 to Three', () => {
      expect(getRank(4)).toBe(Rank.THREE);
      expect(getRank(5)).toBe(Rank.THREE);
      expect(getRank(6)).toBe(Rank.THREE);
      expect(getRank(7)).toBe(Rank.THREE);
    });

    it('maps index 48-51 to Ace', () => {
      expect(getRank(48)).toBe(Rank.ACE);
      expect(getRank(49)).toBe(Rank.ACE);
      expect(getRank(50)).toBe(Rank.ACE);
      expect(getRank(51)).toBe(Rank.ACE);
    });

    it('maps Ten correctly (index 32-35)', () => {
      expect(getRank(32)).toBe(Rank.TEN);
      expect(getRank(33)).toBe(Rank.TEN);
      expect(getRank(34)).toBe(Rank.TEN);
      expect(getRank(35)).toBe(Rank.TEN);
    });
  });

  describe('isRedSuit', () => {
    it('identifies Clubs as not red', () => {
      expect(isRedSuit(Suit.CLUBS)).toBe(false);
    });

    it('identifies Diamonds as red', () => {
      expect(isRedSuit(Suit.DIAMONDS)).toBe(true);
    });

    it('identifies Hearts as red', () => {
      expect(isRedSuit(Suit.HEARTS)).toBe(true);
    });

    it('identifies Spades as not red', () => {
      expect(isRedSuit(Suit.SPADES)).toBe(false);
    });
  });

  describe('getCardDisplay', () => {
    it('displays 2♣ for index 0', () => {
      expect(getCardDisplay(0)).toBe('2♣');
    });

    it('displays 2♦ for index 1', () => {
      expect(getCardDisplay(1)).toBe('2♦');
    });

    it('displays 2♥ for index 2', () => {
      expect(getCardDisplay(2)).toBe('2♥');
    });

    it('displays 2♠ for index 3', () => {
      expect(getCardDisplay(3)).toBe('2♠');
    });

    it('displays A♠ for index 51', () => {
      expect(getCardDisplay(51)).toBe('A♠');
    });

    it('displays T♦ for index 33', () => {
      // Ten of diamonds: rank=8 (T), suit=1 (D), index=8*4+1=33
      expect(getCardDisplay(33)).toBe('T♦');
    });

    it('displays K♥ for index 46', () => {
      // King of hearts: rank=11 (K), suit=2 (H), index=11*4+2=46
      expect(getCardDisplay(46)).toBe('K♥');
    });
  });

  describe('full deck mapping', () => {
    it('maps all 52 cards to unique suit/rank combinations', () => {
      const seen = new Set<string>();

      for (let i = 0; i < 52; i++) {
        const suit = getSuit(i);
        const rank = getRank(i);
        const key = `${rank}-${suit}`;

        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }

      expect(seen.size).toBe(52);
    });

    it('has exactly 13 cards of each suit', () => {
      const suitCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };

      for (let i = 0; i < 52; i++) {
        suitCounts[getSuit(i)]++;
      }

      expect(suitCounts[Suit.CLUBS]).toBe(13);
      expect(suitCounts[Suit.DIAMONDS]).toBe(13);
      expect(suitCounts[Suit.HEARTS]).toBe(13);
      expect(suitCounts[Suit.SPADES]).toBe(13);
    });

    it('has exactly 4 cards of each rank', () => {
      const rankCounts: Record<number, number> = {};
      for (let r = 0; r < 13; r++) rankCounts[r] = 0;

      for (let i = 0; i < 52; i++) {
        rankCounts[getRank(i)]++;
      }

      for (let r = 0; r < 13; r++) {
        expect(rankCounts[r]).toBe(4);
      }
    });
  });
});

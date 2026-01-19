/**
 * Tests for table type utilities.
 *
 * AC-CI6.3: Board displays correct number of cards per street.
 */

import { describe, it, expect } from 'vitest';
import { getBoardCardCount, Street } from './table';

describe('getBoardCardCount', () => {
  it('returns 0 for preflop', () => {
    expect(getBoardCardCount(Street.PREFLOP)).toBe(0);
  });

  it('returns 3 for flop', () => {
    expect(getBoardCardCount(Street.FLOP)).toBe(3);
  });

  it('returns 4 for turn', () => {
    expect(getBoardCardCount(Street.TURN)).toBe(4);
  });

  it('returns 5 for river', () => {
    expect(getBoardCardCount(Street.RIVER)).toBe(5);
  });

  it('returns 0 for invalid street values', () => {
    expect(getBoardCardCount(99 as typeof Street.PREFLOP)).toBe(0);
  });
});

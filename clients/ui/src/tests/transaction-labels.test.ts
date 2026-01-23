/**
 * Transaction label mappings for wallet prompts.
 *
 * AC-UI7.2: Transaction prompts show human-readable descriptions for join/action/leave.
 */

import { describe, it, expect } from 'vitest';
import { getPlayerActionLabel, getTableActionLabel } from '@/lib/transaction-labels';

describe('transaction label mappings', () => {
  it('maps player actions to human-readable labels (AC-UI7.2)', () => {
    expect(getPlayerActionLabel('fold')).toBe('Fold hand');
    expect(getPlayerActionLabel('check')).toBe('Check');
    expect(getPlayerActionLabel('call', 50n)).toBe('Call 50 CRISPS');
    expect(getPlayerActionLabel('raise', 120n)).toBe('Raise to 120 CRISPS');
    expect(getPlayerActionLabel('shove', 1000n)).toBe('All-in: 1,000 CRISPS');
  });

  it('maps table actions to human-readable labels (AC-UI7.2)', () => {
    expect(getTableActionLabel('join', 1000n)).toBe('Join table with 1,000 CRISPS buy-in');
    expect(getTableActionLabel('leave')).toBe('Leave table');
  });
});

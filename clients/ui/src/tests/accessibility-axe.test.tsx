/**
 * Accessibility scans for table + action bar views.
 *
 * AC-UI8.1: Screen reader announces key game events with aria-live for async updates.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { PokerTable } from '@/components/poker-table';
import { PokerActions } from '@/components/poker-actions';
import { ActionHistory } from '@/components/action-history';
import type { TableStore } from '@/hooks/use-table-subscription';
import {
  useSeat,
  usePot,
  useCurrentActor,
  useTableStatus,
  useStreet,
  useDealerPosition,
  useRevealedSeed,
  useSeatStatuses,
} from '@/hooks/use-table-subscription';
import { deriveBoardCards, deriveHoleCards } from '@/lib/card-derivation';
import { SeatStatus, TableStatus, Street } from '@/types/table';

vi.mock('@/hooks/use-table-subscription', () => ({
  useSeat: vi.fn(),
  usePot: vi.fn(),
  useCurrentActor: vi.fn(),
  useTableStatus: vi.fn(),
  useStreet: vi.fn(),
  useDealerPosition: vi.fn(),
  useRevealedSeed: vi.fn(),
  useSeatStatuses: vi.fn(),
}));

vi.mock('@/lib/card-derivation', () => ({
  deriveBoardCards: vi.fn(),
  deriveHoleCards: vi.fn(),
}));

const mockUseSeat = useSeat as ReturnType<typeof vi.fn>;
const mockUsePot = usePot as ReturnType<typeof vi.fn>;
const mockUseCurrentActor = useCurrentActor as ReturnType<typeof vi.fn>;
const mockUseTableStatus = useTableStatus as ReturnType<typeof vi.fn>;
const mockUseStreet = useStreet as ReturnType<typeof vi.fn>;
const mockUseDealerPosition = useDealerPosition as ReturnType<typeof vi.fn>;
const mockUseRevealedSeed = useRevealedSeed as ReturnType<typeof vi.fn>;
const mockUseSeatStatuses = useSeatStatuses as ReturnType<typeof vi.fn>;
const mockDeriveBoardCards = deriveBoardCards as ReturnType<typeof vi.fn>;
const mockDeriveHoleCards = deriveHoleCards as ReturnType<typeof vi.fn>;

describe('Accessibility scans', () => {
  const mockStore = {} as TableStore;
  const emptySeat = {
    status: SeatStatus.EMPTY,
    hasActed: false,
    player: '',
    stack: 0n,
    currentBet: 0n,
    totalBet: 0n,
    holeCardHash: '',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePot.mockReturnValue(0n);
    mockUseCurrentActor.mockReturnValue(-1);
    mockUseTableStatus.mockReturnValue(TableStatus.WAITING);
    mockUseStreet.mockReturnValue(Street.PREFLOP);
    mockUseDealerPosition.mockReturnValue(0);
    mockUseRevealedSeed.mockReturnValue('');
    mockUseSeatStatuses.mockReturnValue(Array.from({ length: 10 }, () => SeatStatus.EMPTY));
    mockDeriveBoardCards.mockReturnValue(null);
    mockDeriveHoleCards.mockReturnValue(null);
    mockUseSeat.mockImplementation(() => ({ ...emptySeat }));
  });

  it('axe scan passes for table + action bar (AC-UI8.1)', async () => {
    const { container } = render(
      <div>
        <PokerTable store={mockStore} />
        <PokerActions
          isPlayerTurn={true}
          toCall={100}
          minRaise={100}
          maxRaise={1000}
          potSize={500}
          raiseAmount={200}
          onRaiseAmountChange={vi.fn()}
          onAction={vi.fn()}
          canCheck={false}
        />
      </div>
    );

    const results = await axe.run(container, {
      rules: {
        'color-contrast': { enabled: false },
      },
    });
    expect(results.violations).toHaveLength(0);
  });

  it('action history announces updates via aria-live (AC-UI8.1)', () => {
    render(
      <ActionHistory
        entries={[
          {
            timestamp: Date.now(),
            player: '11111111111111111111111111111111',
            action: 'call',
            amount: 100n,
            seatIndex: 0,
          },
        ]}
      />
    );

    const log = screen.getByRole('log', { name: 'Recent poker actions' });
    expect(log).toHaveAttribute('aria-live', 'polite');
    expect(log).toHaveAttribute('aria-relevant', 'additions text');
  });
});

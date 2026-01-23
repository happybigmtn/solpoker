/**
 * Render scoping + memory stability checks for table subscriptions.
 *
 * AC-UI9.3: UI updates are scoped to avoid full-table re-renders; memory usage is stable during extended play.
 */

import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import {
  usePot,
  useSeat,
  useSeatStatuses,
  useStreet,
  useTableStatus,
  useDealerPosition,
  useRevealedSeed,
  type TableStore,
} from '@/hooks/use-table-subscription';
import { createTableStore } from '@/stores/table-store';
import {
  emptyTableState,
  SeatStatus,
  TableStatus,
  Street,
  type Seat,
  type TableState,
} from '@/types/table';

const renderCounts = {
  pot: 0,
  seat0: 0,
  seat1: 0,
  board: 0,
};

function resetCounts() {
  renderCounts.pot = 0;
  renderCounts.seat0 = 0;
  renderCounts.seat1 = 0;
  renderCounts.board = 0;
}

function PotProbe({ store }: { store: TableStore }) {
  usePot(store);
  renderCounts.pot += 1;
  return null;
}

function SeatProbe({ store, index }: { store: TableStore; index: number }) {
  useSeat(store, index);
  if (index === 0) {
    renderCounts.seat0 += 1;
  } else if (index === 1) {
    renderCounts.seat1 += 1;
  }
  return null;
}

function BoardProbe({ store }: { store: TableStore }) {
  useStreet(store);
  useTableStatus(store);
  useDealerPosition(store);
  useRevealedSeed(store);
  useSeatStatuses(store);
  renderCounts.board += 1;
  return null;
}

function ProbeApp({ store }: { store: TableStore }) {
  return (
    <>
      <PotProbe store={store} />
      <SeatProbe store={store} index={0} />
      <SeatProbe store={store} index={1} />
      <BoardProbe store={store} />
    </>
  );
}

function withSeat(state: TableState, index: number, partial: Partial<Seat>): TableState {
  const seats = state.seats.map((seat, i) =>
    i === index ? { ...seat, ...partial } : seat
  );
  return {
    ...state,
    seats,
  };
}

function buildBaseState(): TableState {
  const base = emptyTableState();
  base.status = TableStatus.PLAYING;
  base.currentStreet = Street.PREFLOP;
  base.dealerPosition = 0;
  base.revealedSeed = 'a'.repeat(64);
  base.playerCount = 1;
  base.activeCount = 1;
  base.seats = base.seats.map((seat, index) =>
    index === 0
      ? {
          ...seat,
          status: SeatStatus.OCCUPIED,
          player: 'player-0',
          stack: 1000n,
          holeCardHash: 'abc123',
        }
      : seat
  );
  return base;
}

describe('AC-UI9.3: render scoping + memory stability', () => {
  it('scopes updates to pot/seat changes without full-table re-renders', () => {
    resetCounts();
    const store = createTableStore();
    let state = buildBaseState();
    store.setState(state);

    render(<ProbeApp store={store} />);

    const baseline = { ...renderCounts };
    const counts = store._getListenerCounts();
    expect(counts.full).toBe(0);

    act(() => {
      state = { ...state, pot: 500n };
      store.setState(state);
    });

    expect(renderCounts.pot).toBe(baseline.pot + 1);
    expect(renderCounts.seat0).toBe(baseline.seat0);
    expect(renderCounts.seat1).toBe(baseline.seat1);
    expect(renderCounts.board).toBe(baseline.board);

    const afterPot = { ...renderCounts };

    act(() => {
      state = withSeat(state, 0, { stack: 900n });
      store.setState(state);
    });

    expect(renderCounts.seat0).toBe(afterPot.seat0 + 1);
    expect(renderCounts.pot).toBe(afterPot.pot);
    expect(renderCounts.seat1).toBe(afterPot.seat1);
    expect(renderCounts.board).toBe(afterPot.board);

    const afterSeat = { ...renderCounts };

    act(() => {
      state = withSeat(state, 0, { status: SeatStatus.FOLDED });
      store.setState(state);
    });

    expect(renderCounts.seat0).toBe(afterSeat.seat0 + 1);
    expect(renderCounts.board).toBe(afterSeat.board + 1);
    expect(renderCounts.pot).toBe(afterSeat.pot);
  });

  it('keeps subscription counts stable during extended updates', () => {
    resetCounts();
    const store = createTableStore();
    let state = buildBaseState();
    store.setState(state);

    const { unmount } = render(<ProbeApp store={store} />);
    const initialCounts = store._getListenerCounts();

    for (let i = 0; i < 100; i += 1) {
      act(() => {
        state = withSeat(state, 0, { stack: state.seats[0].stack + 1n });
        state = { ...state, pot: state.pot + 1n };
        store.setState(state);
      });
    }

    const afterCounts = store._getListenerCounts();
    expect(afterCounts).toEqual(initialCounts);

    unmount();

    const finalCounts = store._getListenerCounts();
    expect(finalCounts.full).toBe(0);
    expect(finalCounts.pot).toBe(0);
    expect(finalCounts.actor).toBe(0);
    expect(finalCounts.status).toBe(0);
    expect(finalCounts.street).toBe(0);
    expect(finalCounts.dealer).toBe(0);
    expect(finalCounts.seed).toBe(0);
    expect(finalCounts.seatStatus).toBe(0);
    expect(finalCounts.seats.every((count) => count === 0)).toBe(true);
  });
});

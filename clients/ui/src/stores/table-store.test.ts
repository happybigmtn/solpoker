/**
 * Tests for table store selective subscriptions.
 *
 * AC-4.1: Verifies that table subscription updates only relevant components.
 *
 * The key test is that when a specific piece of state changes (e.g., pot),
 * only listeners subscribed to that piece are notified, not all listeners.
 */

import { describe, it, expect, vi } from 'vitest';
import { createTableStore } from './table-store';
import {
  emptyTableState,
  emptySeat,
  SeatStatus,
  type TableState,
  type Seat,
} from '@/types/table';

describe('TableStore selective subscriptions', () => {
  it('notifies only full-state listeners on any change', () => {
    const store = createTableStore();
    const fullListener = vi.fn();
    const potListener = vi.fn();

    store.subscribe(fullListener);
    store.subscribePot(potListener);

    // Change pot
    const state = emptyTableState();
    state.pot = 1000n;
    store.setState(state);

    expect(fullListener).toHaveBeenCalledTimes(1);
    expect(potListener).toHaveBeenCalledTimes(1);
  });

  it('notifies pot listeners only when pot changes', () => {
    const store = createTableStore();
    const potListener = vi.fn();

    store.subscribePot(potListener);

    // Initial state with pot
    const state1 = emptyTableState();
    state1.pot = 500n;
    store.setState(state1);
    expect(potListener).toHaveBeenCalledTimes(1);

    // Change something else (not pot)
    const state2 = { ...state1, currentActor: 3 };
    store.setState(state2);
    expect(potListener).toHaveBeenCalledTimes(1); // Still 1, not 2

    // Change pot again
    const state3 = { ...state2, pot: 1000n };
    store.setState(state3);
    expect(potListener).toHaveBeenCalledTimes(2);
  });

  it('notifies actor listeners only when currentActor changes', () => {
    const store = createTableStore();
    const actorListener = vi.fn();

    store.subscribeActor(actorListener);

    const state1 = emptyTableState();
    state1.currentActor = 2;
    store.setState(state1);
    expect(actorListener).toHaveBeenCalledTimes(1);

    // Change pot (not actor)
    const state2 = { ...state1, pot: 500n };
    store.setState(state2);
    expect(actorListener).toHaveBeenCalledTimes(1); // Still 1

    // Change actor
    const state3 = { ...state2, currentActor: 3 };
    store.setState(state3);
    expect(actorListener).toHaveBeenCalledTimes(2);
  });

  it('notifies seat listeners only when their specific seat changes', () => {
    const store = createTableStore();
    const seat0Listener = vi.fn();
    const seat1Listener = vi.fn();
    const seat2Listener = vi.fn();

    store.subscribeSeat(0, seat0Listener);
    store.subscribeSeat(1, seat1Listener);
    store.subscribeSeat(2, seat2Listener);

    // Update seat 0 only
    const state1 = emptyTableState();
    state1.seats[0] = { ...emptySeat(), status: SeatStatus.OCCUPIED, stack: 1000n };
    store.setState(state1);

    expect(seat0Listener).toHaveBeenCalledTimes(1);
    expect(seat1Listener).toHaveBeenCalledTimes(0); // Not called
    expect(seat2Listener).toHaveBeenCalledTimes(0); // Not called

    // Update seat 1 only
    const state2: TableState = {
      ...state1,
      seats: [...state1.seats],
    };
    state2.seats[1] = { ...emptySeat(), status: SeatStatus.OCCUPIED, stack: 2000n };
    store.setState(state2);

    expect(seat0Listener).toHaveBeenCalledTimes(1); // Still 1
    expect(seat1Listener).toHaveBeenCalledTimes(1);
    expect(seat2Listener).toHaveBeenCalledTimes(0); // Still 0

    // Update both seat 0 and seat 2
    const state3: TableState = {
      ...state2,
      seats: [...state2.seats],
    };
    state3.seats[0] = { ...state3.seats[0], stack: 1500n };
    state3.seats[2] = { ...emptySeat(), status: SeatStatus.OCCUPIED, stack: 3000n };
    store.setState(state3);

    expect(seat0Listener).toHaveBeenCalledTimes(2);
    expect(seat1Listener).toHaveBeenCalledTimes(1); // Still 1
    expect(seat2Listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify seat listeners when seat is unchanged', () => {
    const store = createTableStore();
    const seatListener = vi.fn();

    store.subscribeSeat(0, seatListener);

    // Set initial state with occupied seat
    const seat: Seat = {
      status: SeatStatus.OCCUPIED,
      hasActed: false,
      player: 'ABC123',
      stack: 1000n,
      currentBet: 0n,
      totalBet: 0n,
      holeCardHash: '',
    };
    const state1 = emptyTableState();
    state1.seats[0] = seat;
    store.setState(state1);
    expect(seatListener).toHaveBeenCalledTimes(1);

    // Set same seat data (different object, same values)
    const state2: TableState = {
      ...state1,
      pot: 500n, // Change something else
      seats: [...state1.seats],
    };
    state2.seats[0] = { ...seat }; // Same values
    store.setState(state2);
    expect(seatListener).toHaveBeenCalledTimes(1); // Still 1, seat unchanged
  });

  it('notifies status listeners only when table status changes', () => {
    const store = createTableStore();
    const statusListener = vi.fn();

    store.subscribeStatus(statusListener);

    const state1 = emptyTableState();
    state1.status = 1; // PLAYING
    store.setState(state1);
    expect(statusListener).toHaveBeenCalledTimes(1);

    // Change pot (not status)
    const state2 = { ...state1, pot: 1000n };
    store.setState(state2);
    expect(statusListener).toHaveBeenCalledTimes(1); // Still 1

    // Change status to SHOWDOWN
    const state3 = { ...state2, status: 3 as const };
    store.setState(state3);
    expect(statusListener).toHaveBeenCalledTimes(2);
  });

  it('notifies street listeners only when betting street changes', () => {
    const store = createTableStore();
    const streetListener = vi.fn();

    store.subscribeStreet(streetListener);

    const state1 = emptyTableState();
    state1.currentStreet = 0; // PREFLOP
    store.setState(state1);
    expect(streetListener).toHaveBeenCalledTimes(0); // Same as default

    // Change to FLOP
    const state2 = { ...state1, currentStreet: 1 as const };
    store.setState(state2);
    expect(streetListener).toHaveBeenCalledTimes(1);

    // Change pot (not street)
    const state3 = { ...state2, pot: 500n };
    store.setState(state3);
    expect(streetListener).toHaveBeenCalledTimes(1); // Still 1
  });

  it('unsubscribes correctly', () => {
    const store = createTableStore();
    const listener = vi.fn();

    const unsubscribe = store.subscribePot(listener);

    const state1 = emptyTableState();
    state1.pot = 500n;
    store.setState(state1);
    expect(listener).toHaveBeenCalledTimes(1);

    // Unsubscribe
    unsubscribe();

    // Change pot again
    const state2 = { ...state1, pot: 1000n };
    store.setState(state2);
    expect(listener).toHaveBeenCalledTimes(1); // Still 1, unsubscribed
  });

  it('tracks listener counts correctly for testing', () => {
    const store = createTableStore();

    const fullListener = vi.fn();
    const seat0Listener = vi.fn();
    const seat1Listener = vi.fn();
    const potListener = vi.fn();

    const unsub1 = store.subscribe(fullListener);
    store.subscribeSeat(0, seat0Listener);
    store.subscribeSeat(1, seat1Listener);
    const unsub2 = store.subscribePot(potListener);

    const counts = store._getListenerCounts();
    expect(counts.full).toBe(1);
    expect(counts.seats[0]).toBe(1);
    expect(counts.seats[1]).toBe(1);
    expect(counts.pot).toBe(1);

    // Unsubscribe some
    unsub1();
    unsub2();

    const counts2 = store._getListenerCounts();
    expect(counts2.full).toBe(0);
    expect(counts2.pot).toBe(0);
    expect(counts2.seats[0]).toBe(1); // Still subscribed
  });

  it('demonstrates that pot-only subscribers avoid seat re-renders', () => {
    // This test demonstrates the AC-4.1 requirement:
    // "table subscription updates only relevant components"

    const store = createTableStore();

    // Imagine these are React components that would re-render on notification
    const potComponentRenders = vi.fn();
    const seat0ComponentRenders = vi.fn();
    const seat1ComponentRenders = vi.fn();

    store.subscribePot(potComponentRenders);
    store.subscribeSeat(0, seat0ComponentRenders);
    store.subscribeSeat(1, seat1ComponentRenders);

    // Scenario: Pot increases (e.g., player raised)
    const state1 = emptyTableState();
    state1.pot = 500n;
    store.setState(state1);

    // Only pot component should re-render
    expect(potComponentRenders).toHaveBeenCalledTimes(1);
    expect(seat0ComponentRenders).toHaveBeenCalledTimes(0);
    expect(seat1ComponentRenders).toHaveBeenCalledTimes(0);

    // Scenario: Seat 0 bets (stack decreases, currentBet increases)
    const state2: TableState = {
      ...state1,
      pot: 600n,
      seats: [...state1.seats],
    };
    state2.seats[0] = { ...emptySeat(), stack: 900n, currentBet: 100n };
    store.setState(state2);

    // Pot + Seat 0 should re-render, Seat 1 should not
    expect(potComponentRenders).toHaveBeenCalledTimes(2);
    expect(seat0ComponentRenders).toHaveBeenCalledTimes(1);
    expect(seat1ComponentRenders).toHaveBeenCalledTimes(0);

    // Scenario: Seat 1 folds (only status changes)
    const state3: TableState = {
      ...state2,
      seats: [...state2.seats],
    };
    state3.seats[1] = { ...emptySeat(), status: SeatStatus.FOLDED };
    store.setState(state3);

    // Only Seat 1 should re-render
    expect(potComponentRenders).toHaveBeenCalledTimes(2); // Unchanged
    expect(seat0ComponentRenders).toHaveBeenCalledTimes(1); // Unchanged
    expect(seat1ComponentRenders).toHaveBeenCalledTimes(1);
  });
});

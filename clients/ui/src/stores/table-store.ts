/**
 * Table state store with selective subscriptions.
 *
 * This store enables AC-4.1: components subscribe to slices of state
 * and only re-render when their slice changes.
 *
 * Uses React's useSyncExternalStore pattern for subscription management.
 */

import {
  type TableState,
  type Seat,
  emptyTableState,
  MAX_SEATS,
} from '@/types/table';

type Listener = () => void;

/**
 * Creates a table store with selective subscriptions.
 *
 * Components can subscribe to:
 * - Full table state (useTableState)
 * - Individual seat (useSeat(index))
 * - Pot only (usePot)
 * - Current actor only (useCurrentActor)
 *
 * This pattern prevents cascade re-renders when unrelated parts change.
 */
export function createTableStore() {
  let state: TableState = emptyTableState();
  let prevState: TableState = state;

  // Separate listener sets for different state slices
  const listeners = new Set<Listener>();
  const seatListeners: Set<Listener>[] = Array.from(
    { length: MAX_SEATS },
    () => new Set()
  );
  const potListeners = new Set<Listener>();
  const actorListeners = new Set<Listener>();
  const statusListeners = new Set<Listener>();
  const streetListeners = new Set<Listener>();

  /**
   * Notify only the relevant listeners based on what changed.
   * This is the key to AC-4.1: selective re-rendering.
   */
  function notifyRelevant(prev: TableState, next: TableState) {
    // Always notify full-state listeners
    listeners.forEach((l) => l());

    // Notify pot listeners if pot changed
    if (prev.pot !== next.pot) {
      potListeners.forEach((l) => l());
    }

    // Notify actor listeners if current actor changed
    if (prev.currentActor !== next.currentActor) {
      actorListeners.forEach((l) => l());
    }

    // Notify status listeners if table status changed
    if (prev.status !== next.status) {
      statusListeners.forEach((l) => l());
    }

    // Notify street listeners if betting street changed
    if (prev.currentStreet !== next.currentStreet) {
      streetListeners.forEach((l) => l());
    }

    // Notify seat listeners only for seats that changed
    for (let i = 0; i < MAX_SEATS; i++) {
      if (!seatEquals(prev.seats[i], next.seats[i])) {
        seatListeners[i].forEach((l) => l());
      }
    }
  }

  return {
    /** Get current full table state (snapshot) */
    getState(): TableState {
      return state;
    },

    /** Get a specific seat (snapshot) */
    getSeat(index: number): Seat {
      return state.seats[index];
    },

    /** Get current pot (snapshot) */
    getPot(): bigint {
      return state.pot;
    },

    /** Get current actor index (snapshot) */
    getCurrentActor(): number {
      return state.currentActor;
    },

    /** Get table status (snapshot) */
    getStatus(): number {
      return state.status;
    },

    /** Get current street (snapshot) */
    getStreet(): number {
      return state.currentStreet;
    },

    /**
     * Update the full table state.
     * Called when WebSocket receives new account data.
     */
    setState(newState: TableState) {
      prevState = state;
      state = newState;
      notifyRelevant(prevState, state);
    },

    /** Subscribe to full table state changes */
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Subscribe to a specific seat's changes */
    subscribeSeat(index: number, listener: Listener): () => void {
      seatListeners[index].add(listener);
      return () => seatListeners[index].delete(listener);
    },

    /** Subscribe to pot changes only */
    subscribePot(listener: Listener): () => void {
      potListeners.add(listener);
      return () => potListeners.delete(listener);
    },

    /** Subscribe to current actor changes only */
    subscribeActor(listener: Listener): () => void {
      actorListeners.add(listener);
      return () => actorListeners.delete(listener);
    },

    /** Subscribe to table status changes only */
    subscribeStatus(listener: Listener): () => void {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },

    /** Subscribe to betting street changes only */
    subscribeStreet(listener: Listener): () => void {
      streetListeners.add(listener);
      return () => streetListeners.delete(listener);
    },

    /** For testing: get listener counts */
    _getListenerCounts() {
      return {
        full: listeners.size,
        seats: seatListeners.map((s) => s.size),
        pot: potListeners.size,
        actor: actorListeners.size,
        status: statusListeners.size,
        street: streetListeners.size,
      };
    },
  };
}

/**
 * Compare two seats for equality.
 * Used to determine if a seat-specific re-render is needed.
 */
function seatEquals(a: Seat, b: Seat): boolean {
  return (
    a.status === b.status &&
    a.hasActed === b.hasActed &&
    a.player === b.player &&
    a.stack === b.stack &&
    a.currentBet === b.currentBet &&
    a.totalBet === b.totalBet &&
    a.holeCardHash === b.holeCardHash
  );
}

export type TableStore = ReturnType<typeof createTableStore>;

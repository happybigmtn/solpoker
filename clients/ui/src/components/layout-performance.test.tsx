/**
 * Render tests for layout + state messaging + performance constraints.
 *
 * AC-3.1: Seat layout supports up to MAX_SEATS with clear active/inactive state and turn indicator.
 * AC-3.2: Board, pot, and action history visible without scrolling on desktop.
 * AC-3.3: Mobile view prioritizes current player actions and table state.
 * AC-3.4: Error states and transaction states shown inline (pending, confirmed, failed).
 * AC-4.1: UI subscribes to on-chain table state and only re-renders on relevant updates.
 * AC-4.4: Suspense boundaries are used to avoid data-fetch waterfalls.
 * AC-4.5: Heavy UI panels are dynamically imported and only loaded on demand.
 * AC-4.10: Text inputs with rapid keystrokes avoid heavy controlled re-renders.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';

// Mock types/table module
vi.mock('@/types/table', () => ({
  MAX_SEATS: 10,
  SeatStatus: {
    EMPTY: 0,
    OCCUPIED: 1,
    SITTING_OUT: 2,
    FOLDED: 3,
    ALL_IN: 4,
  },
  TableStatus: {
    WAITING: 0,
    PLAYING: 1,
    CLOSED: 2,
    SHOWDOWN: 3,
  },
  Street: {
    PREFLOP: 0,
    FLOP: 1,
    TURN: 2,
    RIVER: 3,
  },
  getBoardCardCount: (street: number) => {
    if (street === 0) return 0;
    if (street === 1) return 3;
    if (street === 2) return 4;
    if (street === 3) return 5;
    return 0;
  },
}));

// Mock card-derivation
vi.mock('@/lib/card-derivation', () => ({
  deriveBoardCards: vi.fn(),
  deriveHoleCards: vi.fn(),
}));

// Mock hooks/use-table-subscription
vi.mock('@/hooks/use-table-subscription', () => ({
  useSeat: vi.fn(),
  usePot: vi.fn(),
  useCurrentActor: vi.fn(),
  useStreet: vi.fn(),
  useTableState: vi.fn(),
}));

// Mock use-keyboard-shortcuts
vi.mock('@/hooks/use-keyboard-shortcuts', () => ({
  useKeyboardShortcuts: vi.fn(),
  SHORTCUT_DEFINITIONS: [
    { key: 'f', action: 'fold' },
    { key: 'x', action: 'check' },
    { key: 'c', action: 'call' },
    { key: 'r', action: 'raise' },
    { key: 's', action: 'shove' },
  ],
  formatShortcut: (def: { key: string }) => def?.key?.toUpperCase() ?? '',
}));

import {
  useTableState,
  useSeat,
  usePot,
  useCurrentActor,
} from '@/hooks/use-table-subscription';
import { deriveBoardCards, deriveHoleCards } from '@/lib/card-derivation';
import { PokerTable } from './poker-table';
import { TransactionStatus } from './transaction-status';
import { PokerActions } from './poker-actions';
import { CommandPalette } from './command-palette';
import type { TableStore } from '@/hooks/use-table-subscription';

const mockUseTableState = useTableState as ReturnType<typeof vi.fn>;
const mockUseSeat = useSeat as ReturnType<typeof vi.fn>;
const mockUsePot = usePot as ReturnType<typeof vi.fn>;
const mockUseCurrentActor = useCurrentActor as ReturnType<typeof vi.fn>;
const mockDeriveBoardCards = deriveBoardCards as ReturnType<typeof vi.fn>;
const mockDeriveHoleCards = deriveHoleCards as ReturnType<typeof vi.fn>;

describe('AC-3.1: Seat layout with active/inactive state and turn indicator', () => {
  const mockStore = {} as TableStore;

  const createEmptySeat = () => ({
    status: 0, // EMPTY
    hasActed: false,
    player: '',
    stack: 0n,
    currentBet: 0n,
    totalBet: 0n,
    holeCardHash: '',
  });

  const createOccupiedSeat = (player: string, stack: bigint) => ({
    status: 1, // OCCUPIED
    hasActed: false,
    player,
    stack,
    currentBet: 0n,
    totalBet: 0n,
    holeCardHash: '',
  });

  const emptySeats = Array.from({ length: 10 }, createEmptySeat);

  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePot.mockReturnValue(0n);
    mockUseCurrentActor.mockReturnValue(-1);
    mockDeriveBoardCards.mockReturnValue(null);
    mockDeriveHoleCards.mockReturnValue(null);
    mockUseTableState.mockReturnValue({
      currentStreet: 0,
      revealedSeed: '',
      dealerPosition: 0,
      seats: emptySeats,
      status: 0,
    });
    mockUseSeat.mockImplementation(() => createEmptySeat());
  });

  it('renders MAX_SEATS (10) seat positions', () => {
    render(<PokerTable store={mockStore} />);

    // Each seat has an aria-label starting with "Seat"
    const seats = screen.getAllByLabelText(/^Seat \d/);
    expect(seats).toHaveLength(10);
  });

  it('distinguishes active (occupied) from inactive (empty) seats', () => {
    const seats = [createOccupiedSeat('player1', 1000n), ...emptySeats.slice(1)];
    mockUseTableState.mockReturnValue({
      currentStreet: 0,
      revealedSeed: '',
      dealerPosition: 0,
      seats,
      status: 1, // PLAYING
    });
    mockUseSeat.mockImplementation((_: unknown, index: number) =>
      index === 0 ? seats[0] : createEmptySeat()
    );

    render(<PokerTable store={mockStore} />);

    // Seat 1 should NOT have "(empty)" label
    expect(screen.getByLabelText('Seat 1')).toBeInTheDocument();
    // Seat 2 should have "(empty)" label
    expect(screen.getByLabelText('Seat 2 (empty)')).toBeInTheDocument();
  });

  it('shows turn indicator (yellow ring) on current actor', () => {
    const seats = [createOccupiedSeat('player1', 1000n), createOccupiedSeat('player2', 1000n), ...emptySeats.slice(2)];
    mockUseTableState.mockReturnValue({
      currentStreet: 1,
      revealedSeed: '',
      dealerPosition: 0,
      seats,
      status: 1, // PLAYING
    });
    mockUseCurrentActor.mockReturnValue(0); // Seat 0 is current actor
    mockUseSeat.mockImplementation((_: unknown, index: number) =>
      index < 2 ? seats[index] : createEmptySeat()
    );

    const { container } = render(<PokerTable store={mockStore} />);

    // Current actor seat should have yellow ring class
    const yellowRings = container.querySelectorAll('.ring-yellow-400');
    expect(yellowRings.length).toBeGreaterThanOrEqual(1);
  });

  it('highlights player seat with blue ring', () => {
    const playerAddr = 'TestPlayerAddress123';
    const seats = [createOccupiedSeat(playerAddr, 1000n), ...emptySeats.slice(1)];
    mockUseTableState.mockReturnValue({
      currentStreet: 0,
      revealedSeed: '',
      dealerPosition: 0,
      seats,
      status: 1,
    });
    mockUseSeat.mockImplementation((_: unknown, index: number) =>
      index === 0 ? seats[0] : createEmptySeat()
    );

    const { container } = render(<PokerTable store={mockStore} playerAddress={playerAddr} />);

    // Player's seat should have blue ring class
    const blueRings = container.querySelectorAll('.ring-blue-500');
    expect(blueRings.length).toBeGreaterThanOrEqual(1);
  });
});

describe('AC-3.2: Board, pot visible without scrolling', () => {
  const mockStore = {} as TableStore;
  const emptySeats = Array.from({ length: 10 }, () => ({
    status: 0,
    hasActed: false,
    player: '',
    stack: 0n,
    currentBet: 0n,
    totalBet: 0n,
    holeCardHash: '',
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePot.mockReturnValue(5000n);
    mockUseCurrentActor.mockReturnValue(-1);
    mockDeriveBoardCards.mockReturnValue([0, 1, 2, 3, 4]);
    mockDeriveHoleCards.mockReturnValue(null);
    mockUseTableState.mockReturnValue({
      currentStreet: 3, // RIVER
      revealedSeed: 'a'.repeat(64),
      dealerPosition: 0,
      seats: emptySeats,
      status: 1, // PLAYING
    });
    mockUseSeat.mockReturnValue(emptySeats[0]);
  });

  it('renders pot display when pot > 0', () => {
    render(<PokerTable store={mockStore} />);

    expect(screen.getByText(/Pot:.*5,000/)).toBeInTheDocument();
  });

  it('renders board cards area', () => {
    render(<PokerTable store={mockStore} />);

    // Board cards should be present (either face-up or slots)
    // On river with 5 cards, we should not have any empty slots
    const emptySlots = screen.queryAllByLabelText('Empty card slot');
    expect(emptySlots).toHaveLength(0);
  });

  it('table has aria region for accessibility', () => {
    render(<PokerTable store={mockStore} />);

    expect(screen.getByRole('region', { name: 'Poker table' })).toBeInTheDocument();
  });
});

describe('AC-3.4: Transaction states shown inline', () => {
  const mockOnRetry = vi.fn();
  const mockOnDismiss = vi.fn();

  it('shows pending state with spinner', () => {
    render(<TransactionStatus state="pending" />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Submitting transaction…')).toBeInTheDocument();
  });

  it('shows confirmed state with checkmark and explorer link', () => {
    render(
      <TransactionStatus
        state="confirmed"
        signature="abc123def456"
        onDismiss={mockOnDismiss}
      />
    );

    expect(screen.getByText('Transaction confirmed')).toBeInTheDocument();
    expect(screen.getByText('View')).toHaveAttribute(
      'href',
      expect.stringContaining('abc123def456')
    );
  });

  it('shows failed state with user-friendly error message', () => {
    render(
      <TransactionStatus
        state="failed"
        error="insufficient funds for transaction"
        isRetryable={true}
        onRetry={mockOnRetry}
      />
    );

    expect(screen.getByText('Transaction failed')).toBeInTheDocument();
    // AC-6.5: Error message should be user-friendly with next-step
    expect(screen.getByText(/Please add more CRISPS/)).toBeInTheDocument();
  });

  it('shows retry button when action is retryable', () => {
    render(
      <TransactionStatus
        state="failed"
        error="timeout"
        isRetryable={true}
        onRetry={mockOnRetry}
      />
    );

    const retryButton = screen.getByRole('button', { name: 'Retry' });
    expect(retryButton).toBeInTheDocument();
    fireEvent.click(retryButton);
    expect(mockOnRetry).toHaveBeenCalled();
  });

  it('uses aria-live for announcing status updates', () => {
    render(<TransactionStatus state="pending" />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('returns null for idle state', () => {
    const { container } = render(<TransactionStatus state="idle" />);

    expect(container.firstChild).toBeNull();
  });
});

describe('AC-4.1: Selective re-rendering (integration pattern)', () => {
  // These tests verify that the correct hooks are used for selective subscriptions
  // Actual re-render behavior is tested via the hook tests

  const mockStore = {} as TableStore;
  const emptySeats = Array.from({ length: 10 }, () => ({
    status: 0,
    hasActed: false,
    player: '',
    stack: 0n,
    currentBet: 0n,
    totalBet: 0n,
    holeCardHash: '',
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePot.mockReturnValue(0n);
    mockUseCurrentActor.mockReturnValue(-1);
    mockDeriveBoardCards.mockReturnValue(null);
    mockDeriveHoleCards.mockReturnValue(null);
    mockUseTableState.mockReturnValue({
      currentStreet: 0,
      revealedSeed: '',
      dealerPosition: 0,
      seats: emptySeats,
      status: 0,
    });
    mockUseSeat.mockReturnValue(emptySeats[0]);
  });

  it('calls useSeat for each seat index (selective subscription)', () => {
    render(<PokerTable store={mockStore} />);

    // useSeat should be called 10 times, once for each seat
    expect(mockUseSeat).toHaveBeenCalledTimes(10);
    // Each call should have the correct index
    for (let i = 0; i < 10; i++) {
      expect(mockUseSeat).toHaveBeenCalledWith(mockStore, i);
    }
  });

  it('calls usePot for pot subscription', () => {
    render(<PokerTable store={mockStore} />);

    expect(mockUsePot).toHaveBeenCalledWith(mockStore);
  });

  it('calls useCurrentActor for actor subscription', () => {
    render(<PokerTable store={mockStore} />);

    expect(mockUseCurrentActor).toHaveBeenCalledWith(mockStore);
  });
});

describe('AC-4.10: Avoid heavy controlled re-renders in text inputs', () => {
  beforeEach(() => {
    // Mock scrollIntoView which is not available in jsdom
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('command palette input triggers filter via onChange (not heavy controlled)', () => {
    const mockOnClose = vi.fn();
    const mockOnAction = vi.fn();

    render(
      <CommandPalette
        isOpen={true}
        onClose={mockOnClose}
        onAction={mockOnAction}
        isPlayerTurn={true}
        isConnected={true}
      />
    );

    const input = screen.getByRole('searchbox');
    expect(input).toHaveAttribute('type', 'search');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('spellcheck', 'false');

    // Typing should work
    fireEvent.change(input, { target: { value: 'fold' } });
    // The filtered list should show fold
    expect(screen.getByText('Fold')).toBeInTheDocument();
  });

  it('command palette has typographic ellipsis in placeholder', () => {
    const mockOnClose = vi.fn();
    const mockOnAction = vi.fn();

    render(
      <CommandPalette
        isOpen={true}
        onClose={mockOnClose}
        onAction={mockOnAction}
      />
    );

    const input = screen.getByRole('searchbox');
    // AC-5.14: Placeholders use typographic ellipses
    expect(input.getAttribute('placeholder')).toContain('…');
  });
});

describe('AC-3.3: Mobile responsive poker actions', () => {
  const mockOnAction = vi.fn();
  const mockOnRaiseChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders action buttons when player turn', () => {
    render(
      <PokerActions
        isPlayerTurn={true}
        toCall={100}
        minRaise={200}
        maxRaise={1000}
        raiseAmount={300}
        onRaiseAmountChange={mockOnRaiseChange}
        onAction={mockOnAction}
        canCheck={false}
      />
    );

    expect(screen.getByRole('button', { name: /Fold/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Call/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Raise/i })).toBeInTheDocument();
    // Use more specific match for All In button (contains both "All In" and "All" spans)
    expect(screen.getByRole('button', { name: /All In/i })).toBeInTheDocument();
  });

  it('shows waiting message when not player turn', () => {
    render(
      <PokerActions
        isPlayerTurn={false}
        toCall={0}
        minRaise={100}
        maxRaise={1000}
        raiseAmount={100}
        onRaiseAmountChange={mockOnRaiseChange}
        onAction={mockOnAction}
        canCheck={true}
      />
    );

    expect(screen.getByText('Waiting for your turn…')).toBeInTheDocument();
  });

  it('shows check button when canCheck is true', () => {
    render(
      <PokerActions
        isPlayerTurn={true}
        toCall={0}
        minRaise={100}
        maxRaise={1000}
        raiseAmount={100}
        onRaiseAmountChange={mockOnRaiseChange}
        onAction={mockOnAction}
        canCheck={true}
      />
    );

    expect(screen.getByRole('button', { name: /Check/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Call/i })).not.toBeInTheDocument();
  });

  it('uses tabular-nums for chip amounts (AC-6.1)', () => {
    const { container } = render(
      <PokerActions
        isPlayerTurn={true}
        toCall={1000}
        minRaise={200}
        maxRaise={5000}
        raiseAmount={500}
        onRaiseAmountChange={mockOnRaiseChange}
        onAction={mockOnAction}
        canCheck={false}
      />
    );

    // Check for tabular-nums class on amount displays
    const tabularNums = container.querySelectorAll('.tabular-nums');
    expect(tabularNums.length).toBeGreaterThan(0);
  });
});

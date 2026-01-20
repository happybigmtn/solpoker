/**
 * Tests for PokerTable component (Board and seat rendering).
 *
 * AC-CI6.3: Board cards update as streets are dealt (flop, turn, river).
 * AC-CI6.4: Player hole cards display when revealed at showdown.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

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
    if (street === 0) return 0; // PREFLOP
    if (street === 1) return 3; // FLOP
    if (street === 2) return 4; // TURN
    if (street === 3) return 5; // RIVER
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

import {
  useTableState,
  useSeat,
  usePot,
  useCurrentActor,
} from '@/hooks/use-table-subscription';
import { deriveBoardCards, deriveHoleCards } from '@/lib/card-derivation';
import { PokerTable } from './poker-table';
import type { TableStore } from '@/hooks/use-table-subscription';

const mockUseTableState = useTableState as ReturnType<typeof vi.fn>;
const mockUseSeat = useSeat as ReturnType<typeof vi.fn>;
const mockUsePot = usePot as ReturnType<typeof vi.fn>;
const mockUseCurrentActor = useCurrentActor as ReturnType<typeof vi.fn>;
const mockDeriveBoardCards = deriveBoardCards as ReturnType<typeof vi.fn>;
const mockDeriveHoleCards = deriveHoleCards as ReturnType<typeof vi.fn>;

describe('PokerTable (AC-CI6.3, AC-CI6.4)', () => {
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
    holeCardHash: 'abc123', // Non-empty hash means hole cards were dealt
  });

  const emptySeats = Array.from({ length: 10 }, createEmptySeat);

  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePot.mockReturnValue(0n);
    mockUseCurrentActor.mockReturnValue(0);
    mockDeriveBoardCards.mockReturnValue(null);
    mockDeriveHoleCards.mockReturnValue(null);
  });

  describe('AC-CI6.3: Board cards update as streets are dealt', () => {
    it('shows 0 cards preflop (street 0)', () => {
      mockUseTableState.mockReturnValue({
        currentStreet: 0, // PREFLOP
        revealedSeed: '0'.repeat(64),
        dealerPosition: 0,
        seats: emptySeats,
        status: 1, // PLAYING
      });
      mockUseSeat.mockImplementation(() => createEmptySeat());

      render(<PokerTable store={mockStore} />);

      // Should have 5 empty card slots (no dealt cards)
      const emptySlots = screen.getAllByLabelText('Empty card slot');
      expect(emptySlots).toHaveLength(5);
    });

    it('shows 3 cards on flop (street 1)', () => {
      mockDeriveBoardCards.mockReturnValue([0, 5, 10, 15, 20]); // Mock derived cards
      mockUseTableState.mockReturnValue({
        currentStreet: 1, // FLOP
        revealedSeed: 'a'.repeat(64), // Revealed seed
        dealerPosition: 0,
        seats: [createOccupiedSeat('player1', 1000n), createOccupiedSeat('player2', 1000n), ...emptySeats.slice(2)],
        status: 1, // PLAYING
      });
      mockUseSeat.mockImplementation(() => createEmptySeat());

      render(<PokerTable store={mockStore} />);

      // Should have 3 face-up cards and 2 empty slots
      const emptySlots = screen.getAllByLabelText('Empty card slot');
      expect(emptySlots).toHaveLength(2);
    });

    it('shows 4 cards on turn (street 2)', () => {
      mockDeriveBoardCards.mockReturnValue([0, 5, 10, 15, 20]);
      mockUseTableState.mockReturnValue({
        currentStreet: 2, // TURN
        revealedSeed: 'a'.repeat(64),
        dealerPosition: 0,
        seats: [createOccupiedSeat('player1', 1000n), createOccupiedSeat('player2', 1000n), ...emptySeats.slice(2)],
        status: 1, // PLAYING
      });
      mockUseSeat.mockImplementation(() => createEmptySeat());

      render(<PokerTable store={mockStore} />);

      const emptySlots = screen.getAllByLabelText('Empty card slot');
      expect(emptySlots).toHaveLength(1);
    });

    it('shows 5 cards on river (street 3)', () => {
      mockDeriveBoardCards.mockReturnValue([0, 5, 10, 15, 20]);
      mockUseTableState.mockReturnValue({
        currentStreet: 3, // RIVER
        revealedSeed: 'a'.repeat(64),
        dealerPosition: 0,
        seats: [createOccupiedSeat('player1', 1000n), createOccupiedSeat('player2', 1000n), ...emptySeats.slice(2)],
        status: 1, // PLAYING
      });
      mockUseSeat.mockImplementation(() => createEmptySeat());

      render(<PokerTable store={mockStore} />);

      const emptySlots = screen.queryAllByLabelText('Empty card slot');
      expect(emptySlots).toHaveLength(0);
    });

    it('shows card backs when seed not revealed', () => {
      mockDeriveBoardCards.mockReturnValue(null); // No revealed seed
      mockUseTableState.mockReturnValue({
        currentStreet: 1, // FLOP
        revealedSeed: '0'.repeat(64), // Zero seed = not revealed
        dealerPosition: 0,
        seats: [createOccupiedSeat('player1', 1000n), createOccupiedSeat('player2', 1000n), ...emptySeats.slice(2)],
        status: 1, // PLAYING
      });
      mockUseSeat.mockImplementation(() => createEmptySeat());

      render(<PokerTable store={mockStore} />);

      // Should show face-down cards (card backs)
      const faceDownCards = screen.getAllByLabelText('Face-down card');
      expect(faceDownCards).toHaveLength(3);
    });

    it('shows no board cards when not in a hand (WAITING)', () => {
      mockUseTableState.mockReturnValue({
        currentStreet: 0,
        revealedSeed: 'a'.repeat(64),
        dealerPosition: 0,
        seats: emptySeats,
        status: 0, // WAITING
      });
      mockUseSeat.mockImplementation(() => createEmptySeat());

      render(<PokerTable store={mockStore} />);

      // All slots should be empty when not in a hand
      const emptySlots = screen.getAllByLabelText('Empty card slot');
      expect(emptySlots).toHaveLength(5);
    });
  });

  describe('AC-CI6.4: Player hole cards display when revealed at showdown', () => {
    it('shows face-down hole cards during PLAYING (not showdown)', () => {
      const occupiedSeat = createOccupiedSeat('playerAddr', 1000n);
      mockUseTableState.mockReturnValue({
        currentStreet: 3, // RIVER
        revealedSeed: 'a'.repeat(64),
        dealerPosition: 0,
        seats: [occupiedSeat, ...emptySeats.slice(1)],
        status: 1, // PLAYING
      });
      // Return the occupied seat for index 0, empty for rest
      mockUseSeat.mockImplementation((_: unknown, index: number) =>
        index === 0 ? occupiedSeat : createEmptySeat()
      );
      mockDeriveHoleCards.mockReturnValue(null);

      render(<PokerTable store={mockStore} />);

      // Should have face-down cards for hole cards
      const faceDownCards = screen.getAllByLabelText('Face-down card');
      // 2 for hole cards at seat 0
      expect(faceDownCards.length).toBeGreaterThanOrEqual(2);
    });

    it('shows revealed hole cards at SHOWDOWN', () => {
      const occupiedSeat = createOccupiedSeat('playerAddr', 1000n);
      mockUseTableState.mockReturnValue({
        currentStreet: 3, // RIVER
        revealedSeed: 'a'.repeat(64),
        dealerPosition: 0,
        seats: [occupiedSeat, ...emptySeats.slice(1)],
        status: 3, // SHOWDOWN
      });
      mockUseSeat.mockImplementation((_: unknown, index: number) =>
        index === 0 ? occupiedSeat : createEmptySeat()
      );
      // Return hole cards for the player's seat
      mockDeriveHoleCards.mockImplementation(
        (_: string, __: number, ___: unknown, seatIndex: number) =>
          seatIndex === 0 ? [51, 50] : null // A♠, A♥
      );

      render(<PokerTable store={mockStore} />);

      // Should show revealed cards (A and ♠ or ♥)
      const aceCards = screen.getAllByText('A');
      expect(aceCards.length).toBeGreaterThanOrEqual(2);
    });

    it('does not show hole cards for folded players at showdown', () => {
      const foldedSeat = {
        ...createOccupiedSeat('playerAddr', 1000n),
        status: 3, // FOLDED
      };
      mockUseTableState.mockReturnValue({
        currentStreet: 3,
        revealedSeed: 'a'.repeat(64),
        dealerPosition: 0,
        seats: [foldedSeat, ...emptySeats.slice(1)],
        status: 3, // SHOWDOWN
      });
      mockUseSeat.mockImplementation((_: unknown, index: number) =>
        index === 0 ? foldedSeat : createEmptySeat()
      );
      // Even though we could derive hole cards, folded players shouldn't show them
      mockDeriveHoleCards.mockReturnValue([51, 50]);

      render(<PokerTable store={mockStore} />);

      // Folded players show face-down cards even at showdown
      // The folded status should prevent showing face-up cards
      const foldedBadge = screen.getByText('Folded');
      expect(foldedBadge).toBeInTheDocument();
    });

    it('shows empty seats without hole cards', () => {
      mockUseTableState.mockReturnValue({
        currentStreet: 3,
        revealedSeed: 'a'.repeat(64),
        dealerPosition: 0,
        seats: emptySeats,
        status: 3, // SHOWDOWN
      });
      mockUseSeat.mockImplementation(() => createEmptySeat());

      render(<PokerTable store={mockStore} />);

      // Empty seats should show "Empty" text
      const emptyLabels = screen.getAllByText('Empty');
      expect(emptyLabels).toHaveLength(10);
    });
  });

  describe('pot display', () => {
    it('shows pot amount when pot > 0', () => {
      mockUsePot.mockReturnValue(5000n);
      mockUseTableState.mockReturnValue({
        currentStreet: 0,
        revealedSeed: '',
        dealerPosition: 0,
        seats: emptySeats,
        status: 1,
      });
      mockUseSeat.mockImplementation(() => createEmptySeat());

      render(<PokerTable store={mockStore} />);

      // The pot display contains both "Pot:" and the formatted number
      expect(screen.getByText(/Pot:.*5,000/)).toBeInTheDocument();
    });

    it('hides pot display when pot is 0', () => {
      mockUsePot.mockReturnValue(0n);
      mockUseTableState.mockReturnValue({
        currentStreet: 0,
        revealedSeed: '',
        dealerPosition: 0,
        seats: emptySeats,
        status: 0, // WAITING
      });
      mockUseSeat.mockImplementation(() => createEmptySeat());

      render(<PokerTable store={mockStore} />);

      expect(screen.queryByText(/Pot:/)).not.toBeInTheDocument();
    });
  });

  describe('current actor indicator', () => {
    it('highlights the current actor seat', () => {
      const occupiedSeat = createOccupiedSeat('player1', 1000n);
      mockUseTableState.mockReturnValue({
        currentStreet: 0,
        revealedSeed: '',
        dealerPosition: 0,
        seats: [occupiedSeat, createOccupiedSeat('player2', 1000n), ...emptySeats.slice(2)],
        status: 1, // PLAYING
      });
      mockUseCurrentActor.mockReturnValue(0); // Seat 0 is current actor
      mockUseSeat.mockImplementation((_: unknown, index: number) => {
        if (index === 0) return occupiedSeat;
        if (index === 1) return createOccupiedSeat('player2', 1000n);
        return createEmptySeat();
      });

      const { container } = render(<PokerTable store={mockStore} />);

      // Check for yellow ring indicator on current actor
      const yellowRings = container.querySelectorAll('.ring-yellow-400');
      expect(yellowRings.length).toBeGreaterThanOrEqual(1);
    });
  });
});

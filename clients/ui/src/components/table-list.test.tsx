/**
 * Tests for TableList component.
 *
 * AC-CI5.2: UI displays table list with blinds, player count, and join option.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Address } from '@solana/kit';

// Mock useTables hook
const mockRefresh = vi.fn();
vi.mock('@/hooks/use-tables', () => ({
  useTables: vi.fn(),
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

// Mock next/navigation for App Router
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

// Mock @robopoker/client
vi.mock('@robopoker/client', () => ({
  TABLE_STATUS: {
    WAITING: 0,
    PLAYING: 1,
    CLOSED: 2,
    SHOWDOWN: 3,
  },
  MAX_SEATS: 10,
}));

import { useTables } from '@/hooks/use-tables';
import { TableList } from './table-list';

const mockUseTables = useTables as ReturnType<typeof vi.fn>;

describe('TableList (AC-CI5.2)', () => {
  const mockProgramId = 'mockProgramId' as Address;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRefresh.mockClear();
  });

  describe('loading state', () => {
    it('shows loading spinner while fetching', () => {
      mockUseTables.mockReturnValue({
        tables: [],
        isLoading: true,
        error: undefined,
        refresh: mockRefresh,
      });

      render(<TableList pokerProgramId={mockProgramId} />);

      expect(screen.getByText('Loading tables...')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows error message with retry button', () => {
      mockUseTables.mockReturnValue({
        tables: [],
        isLoading: false,
        error: 'Failed to fetch tables',
        refresh: mockRefresh,
      });

      render(<TableList pokerProgramId={mockProgramId} />);

      expect(screen.getByText('Failed to fetch tables')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('shows message when no tables exist', () => {
      mockUseTables.mockReturnValue({
        tables: [],
        isLoading: false,
        error: undefined,
        refresh: mockRefresh,
      });

      render(<TableList pokerProgramId={mockProgramId} />);

      expect(screen.getByText('No tables found.')).toBeInTheDocument();
      expect(screen.getByText('Create a table to get started.')).toBeInTheDocument();
    });
  });

  describe('AC-CI5.2: displays table information', () => {
    const mockTables = [
      {
        address: 'table1Address' as Address,
        tableId: 1n,
        smallBlind: 1_000_000_000n, // 1 token
        bigBlind: 2_000_000_000n, // 2 tokens
        playerCount: 3,
        status: 0, // WAITING
        pot: 5_000_000_000n,
      },
      {
        address: 'table2Address' as Address,
        tableId: 2n,
        smallBlind: 5_000_000_000n,
        bigBlind: 10_000_000_000n,
        playerCount: 6,
        status: 1, // PLAYING
        pot: 100_000_000_000n,
      },
      {
        address: 'table3Address' as Address,
        tableId: 3n,
        smallBlind: 2_000_000_000n,
        bigBlind: 4_000_000_000n,
        playerCount: 10,
        status: 0, // WAITING but full
        pot: 0n,
      },
    ];

    beforeEach(() => {
      mockUseTables.mockReturnValue({
        tables: mockTables,
        isLoading: false,
        error: undefined,
        refresh: mockRefresh,
      });
    });

    it('AC-CI5.2: displays blinds in format small/big', () => {
      render(<TableList pokerProgramId={mockProgramId} />);

      // Table 1: 1/2 blinds
      expect(screen.getByText('1/2')).toBeInTheDocument();
      // Table 2: 5/10 blinds
      expect(screen.getByText('5/10')).toBeInTheDocument();
      // Table 3: 2/4 blinds
      expect(screen.getByText('2/4')).toBeInTheDocument();
    });

    it('AC-CI5.2: displays player count as current/max', () => {
      render(<TableList pokerProgramId={mockProgramId} />);

      // Player counts in format X/10
      expect(screen.getByText('3/10')).toBeInTheDocument();
      expect(screen.getByText('6/10')).toBeInTheDocument();
      expect(screen.getByText('10/10')).toBeInTheDocument();
    });

    it('AC-CI5.2: displays table status badges', () => {
      render(<TableList pokerProgramId={mockProgramId} />);

      // Status badges
      expect(screen.getAllByText('Waiting')).toHaveLength(2);
      expect(screen.getByText('Playing')).toBeInTheDocument();
    });

    it('AC-CI5.2: shows Join button for WAITING tables with available seats', () => {
      render(<TableList pokerProgramId={mockProgramId} />);

      // Table 1 (WAITING, 3/10) should have Join button
      const joinLinks = screen.getAllByRole('link', { name: 'Join' });
      expect(joinLinks).toHaveLength(1);
      // Links use tableId, not address
      expect(joinLinks[0]).toHaveAttribute('href', '/table/1');
    });

    it('AC-CI5.2: shows Watch button for PLAYING tables', () => {
      render(<TableList pokerProgramId={mockProgramId} />);

      // Table 2 (PLAYING) should have Watch button
      const watchLinks = screen.getAllByRole('link', { name: 'Watch' });
      expect(watchLinks).toHaveLength(1);
      // Links use tableId, not address
      expect(watchLinks[0]).toHaveAttribute('href', '/table/2');
    });

    it('AC-CI5.2: disables join for full WAITING tables', () => {
      render(<TableList pokerProgramId={mockProgramId} />);

      // Table 3 (WAITING, 10/10 = full) should not have clickable Join
      // It should be a span, not a link
      const viewSpans = screen.getAllByText('View');
      expect(viewSpans).toHaveLength(1);
      expect(viewSpans[0].tagName).toBe('SPAN');
      expect(viewSpans[0]).toHaveAttribute('aria-disabled', 'true');
    });

    it('AC-CI5.2: displays pot amount', () => {
      render(<TableList pokerProgramId={mockProgramId} />);

      // Pot amounts (formatted as whole numbers)
      expect(screen.getByText('5')).toBeInTheDocument(); // 5 tokens
      expect(screen.getByText('100')).toBeInTheDocument(); // 100 tokens
      expect(screen.getByText('0')).toBeInTheDocument(); // 0 tokens
    });

    it('AC-CI5.2: displays table count in header', () => {
      render(<TableList pokerProgramId={mockProgramId} />);

      expect(screen.getByText('Available Tables (3)')).toBeInTheDocument();
    });
  });

  describe('AC-CI5.2: closed and showdown states', () => {
    it('shows View for CLOSED tables', () => {
      mockUseTables.mockReturnValue({
        tables: [
          {
            address: 'closedTableAddr' as Address,
            tableId: 99n,
            smallBlind: 1n,
            bigBlind: 2n,
            playerCount: 0,
            status: 2, // CLOSED
            pot: 0n,
          },
        ],
        isLoading: false,
        error: undefined,
        refresh: mockRefresh,
      });

      render(<TableList pokerProgramId={mockProgramId} />);

      expect(screen.getByText('Closed')).toBeInTheDocument();
      const viewSpan = screen.getByText('View');
      expect(viewSpan.tagName).toBe('SPAN');
    });

    it('shows Showdown status badge', () => {
      mockUseTables.mockReturnValue({
        tables: [
          {
            address: 'showdownTableAddr' as Address,
            tableId: 100n,
            smallBlind: 1n,
            bigBlind: 2n,
            playerCount: 2,
            status: 3, // SHOWDOWN
            pot: 1000n,
          },
        ],
        isLoading: false,
        error: undefined,
        refresh: mockRefresh,
      });

      render(<TableList pokerProgramId={mockProgramId} />);

      expect(screen.getByText('Showdown')).toBeInTheDocument();
    });
  });
});

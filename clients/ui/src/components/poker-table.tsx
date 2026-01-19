'use client';

/**
 * Poker table layout component.
 *
 * AC-3.1: Seat layout supports up to MAX_SEATS with clear active/inactive
 * state and turn indicator.
 * AC-3.2: Board, pot, and action history visible without scrolling on desktop.
 * AC-4.1: Uses selective subscriptions - each seat only re-renders when it changes.
 */

import { type TableStore, useSeat, usePot, useCurrentActor } from '@/hooks/use-table-subscription';
import { MAX_SEATS, SeatStatus, type Seat as SeatType } from '@/types/table';
import { memo } from 'react';

interface PokerTableProps {
  store: TableStore;
  /** Current player's address (to highlight their seat) */
  playerAddress?: string;
}

/**
 * Main poker table layout.
 *
 * Uses an oval/ellipse layout for seats around a central area
 * containing board cards and pot.
 */
export function PokerTable({ store, playerAddress }: PokerTableProps) {
  return (
    <div className="relative mx-auto aspect-[16/10] w-full max-w-4xl">
      {/* Table felt background */}
      <div className="absolute inset-0 rounded-[50%] bg-emerald-800 dark:bg-emerald-900 shadow-inner" />

      {/* Center area: board + pot */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
        <Board />
        <PotDisplay store={store} />
      </div>

      {/* Seats positioned around the table */}
      <SeatsLayout store={store} playerAddress={playerAddress} />
    </div>
  );
}

/**
 * Board display for community cards.
 *
 * AC-3.2: Board visible without scrolling.
 * Placeholder until we have card rendering.
 */
function Board() {
  return (
    <div className="flex gap-1">
      {/* 5 community card slots */}
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="h-14 w-10 rounded border border-zinc-400/30 bg-zinc-200/20 dark:bg-zinc-700/20"
          aria-label={`Community card ${i + 1}`}
        />
      ))}
    </div>
  );
}

/**
 * Pot display component.
 *
 * AC-4.1: Only re-renders when pot changes.
 * AC-6.1: Uses tabular figures for numeric display.
 */
const PotDisplay = memo(function PotDisplay({ store }: { store: TableStore }) {
  const pot = usePot(store);

  if (pot === 0n) return null;

  return (
    <div className="rounded-full bg-zinc-900/80 px-3 py-1 text-sm font-medium text-white tabular-nums">
      Pot: {formatChips(pot)}
    </div>
  );
});

/**
 * Layout for all seats around the table.
 *
 * Positions seats in an ellipse around the table using CSS transforms.
 * Each seat component subscribes independently for selective re-rendering.
 */
function SeatsLayout({
  store,
  playerAddress,
}: {
  store: TableStore;
  playerAddress?: string;
}) {
  const currentActor = useCurrentActor(store);

  return (
    <>
      {Array.from({ length: MAX_SEATS }).map((_, index) => (
        <SeatComponent
          key={index}
          store={store}
          index={index}
          isCurrentActor={currentActor === index}
          isPlayer={false} // Will be determined by seat data
          playerAddress={playerAddress}
        />
      ))}
    </>
  );
}

interface SeatComponentProps {
  store: TableStore;
  index: number;
  isCurrentActor: boolean;
  isPlayer: boolean;
  playerAddress?: string;
}

/**
 * Individual seat component.
 *
 * AC-4.1: Only re-renders when this specific seat changes.
 * AC-3.1: Clear active/inactive state and turn indicator.
 */
const SeatComponent = memo(function SeatComponent({
  store,
  index,
  isCurrentActor,
  playerAddress,
}: SeatComponentProps) {
  const seat = useSeat(store, index);
  const isPlayer = Boolean(playerAddress && seat.player === playerAddress);

  // Calculate position on ellipse (10 seats around the table)
  const angle = (index * 360) / MAX_SEATS - 90; // Start from top
  const position = getSeatPosition(angle);

  return (
    <div
      className="absolute"
      style={{
        left: `${position.x}%`,
        top: `${position.y}%`,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <SeatCard
        seat={seat}
        index={index}
        isCurrentActor={isCurrentActor}
        isPlayer={isPlayer}
      />
    </div>
  );
});

/**
 * Seat card visual with player info.
 *
 * AC-3.1: Shows active/inactive state and turn indicator.
 */
function SeatCard({
  seat,
  index,
  isCurrentActor,
  isPlayer,
}: {
  seat: SeatType;
  index: number;
  isCurrentActor: boolean;
  isPlayer: boolean;
}) {
  const isEmpty = seat.status === SeatStatus.EMPTY;
  const isFolded = seat.status === SeatStatus.FOLDED;
  const isAllIn = seat.status === SeatStatus.ALL_IN;
  const isSittingOut = seat.status === SeatStatus.SITTING_OUT;

  return (
    <div
      className={`
        relative flex min-w-24 flex-col items-center rounded-lg p-2 text-center
        transition-colors duration-150
        ${isEmpty ? 'bg-zinc-300/50 dark:bg-zinc-700/50' : 'bg-white dark:bg-zinc-800'}
        ${isFolded ? 'opacity-50' : ''}
        ${isSittingOut ? 'opacity-60' : ''}
        ${isCurrentActor ? 'ring-2 ring-yellow-400' : ''}
        ${isPlayer ? 'ring-2 ring-blue-500' : ''}
      `}
      aria-label={`Seat ${index + 1}${
        isEmpty ? ' (empty)' : isSittingOut ? ' (sitting out)' : ''
      }`}
    >
      {/* Turn indicator */}
      {isCurrentActor && (
        <div className="absolute -top-2 left-1/2 -translate-x-1/2">
          <div className="h-2 w-2 animate-pulse rounded-full bg-yellow-400" />
        </div>
      )}

      {/* Dealer button */}
      {/* TODO: Show dealer button based on dealerPosition */}

      {isEmpty ? (
        <span className="text-xs text-zinc-500">Empty</span>
      ) : (
        <>
          {/* Player address (truncated) */}
          <span className="truncate text-xs font-medium max-w-20">
            {truncateAddress(seat.player)}
          </span>

          {/* Stack */}
          <span className="text-sm font-semibold tabular-nums">
            {formatChips(seat.stack)}
          </span>

          {/* Status badge */}
          {isAllIn && (
            <span className="mt-1 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white uppercase">
              All In
            </span>
          )}
          {isSittingOut && (
            <span className="mt-1 rounded-full bg-zinc-400 px-2 py-0.5 text-[10px] font-medium text-zinc-900 uppercase">
              Sitting Out
            </span>
          )}
          {isFolded && (
            <span className="mt-1 rounded-full bg-zinc-500 px-2 py-0.5 text-[10px] font-medium text-white uppercase">
              Folded
            </span>
          )}

          {/* Current bet */}
          {seat.currentBet > 0n && (
            <span className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 tabular-nums">
              Bet: {formatChips(seat.currentBet)}
            </span>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Calculate seat position on an ellipse.
 * Returns percentage values for CSS positioning.
 */
function getSeatPosition(angleDegrees: number): { x: number; y: number } {
  const angleRad = (angleDegrees * Math.PI) / 180;
  // Ellipse radii (as percentage of container)
  const rx = 45; // Horizontal radius
  const ry = 40; // Vertical radius
  return {
    x: 50 + rx * Math.cos(angleRad),
    y: 50 + ry * Math.sin(angleRad),
  };
}

/**
 * Format chip count with locale-aware formatting.
 *
 * AC-6.6: Uses Intl.NumberFormat for number formatting.
 */
function formatChips(amount: bigint): string {
  // For display, convert to number (safe for typical poker amounts)
  const num = Number(amount);
  return new Intl.NumberFormat('en-US', {
    style: 'decimal',
    maximumFractionDigits: 0,
  }).format(num);
}

/**
 * Truncate a Solana address for display.
 *
 * AC-6.4: Long addresses truncate gracefully.
 */
function truncateAddress(address: string): string {
  if (!address) return '';
  if (address.length <= 8) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

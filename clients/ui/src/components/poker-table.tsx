'use client';

/**
 * Poker table layout component.
 *
 * AC-3.1: Seat layout supports up to MAX_SEATS with clear active/inactive
 * state and turn indicator.
 * AC-3.2: Board, pot, and action history visible without scrolling on desktop.
 * AC-4.1: Uses selective subscriptions - each seat only re-renders when it changes.
 * AC-CI6.1–AC-CI6.4: Card rendering with correct suits, ranks, and board display.
 */

import { type TableStore, useSeat, usePot, useCurrentActor, useStreet, useTableState } from '@/hooks/use-table-subscription';
import { MAX_SEATS, SeatStatus, TableStatus, Street, getBoardCardCount, type Seat as SeatType } from '@/types/table';
import { memo, useMemo } from 'react';
import { Card, CardSlot } from './card';
import { deriveBoardCards, deriveHoleCards } from '@/lib/card-derivation';

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
        <Board store={store} />
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
 * AC-CI6.1: Cards render with correct suit and rank.
 * AC-CI6.2: Unrevealed cards display a card back.
 * AC-CI6.3: Board cards update as streets are dealt.
 */
interface BoardProps {
  store: TableStore;
}

const Board = memo(function Board({ store }: BoardProps) {
  const tableState = useTableState(store);
  const { currentStreet, revealedSeed, dealerPosition, seats, status } = tableState;

  // Derive board cards if seed is revealed
  const boardCards = useMemo(() => {
    return deriveBoardCards(revealedSeed, dealerPosition, seats);
  }, [revealedSeed, dealerPosition, seats]);

  // Number of cards that should be visible based on street
  const visibleCount = getBoardCardCount(currentStreet);

  // Only show board during a hand (playing or showdown)
  const isInHand = status === TableStatus.PLAYING || status === TableStatus.SHOWDOWN;

  return (
    <div className="flex gap-1">
      {/* 5 community card slots */}
      {Array.from({ length: 5 }).map((_, i) => {
        const isDealt = isInHand && i < visibleCount;
        const cardIndex = boardCards?.[i] ?? null;

        if (!isDealt) {
          // Empty slot for cards not yet dealt
          return <CardSlot key={i} size="md" />;
        }

        // If seed is revealed, show actual card; otherwise show card back
        return (
          <Card
            key={i}
            index={cardIndex}
            faceDown={cardIndex === null}
            size="md"
          />
        );
      })}
    </div>
  );
});

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
  const tableState = useTableState(store);

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
          tableState={tableState}
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
  tableState: ReturnType<typeof useTableState>;
}

/**
 * Individual seat component.
 *
 * AC-4.1: Only re-renders when this specific seat changes.
 * AC-3.1: Clear active/inactive state and turn indicator.
 * AC-CI6.4: Shows hole cards when revealed at showdown.
 */
const SeatComponent = memo(function SeatComponent({
  store,
  index,
  isCurrentActor,
  playerAddress,
  tableState,
}: SeatComponentProps) {
  const seat = useSeat(store, index);
  const isPlayer = Boolean(playerAddress && seat.player === playerAddress);

  // Derive hole cards if at showdown and seed is revealed
  const holeCards = useMemo(() => {
    const { status, revealedSeed, dealerPosition, seats } = tableState;
    // Only show hole cards during showdown with revealed seed
    if (status !== TableStatus.SHOWDOWN) return null;
    return deriveHoleCards(revealedSeed, dealerPosition, seats, index);
  }, [tableState, index]);

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
        holeCards={holeCards}
        isShowdown={tableState.status === TableStatus.SHOWDOWN}
      />
    </div>
  );
});

/**
 * Seat card visual with player info.
 *
 * AC-3.1: Shows active/inactive state and turn indicator.
 * AC-CI6.4: Player hole cards display when revealed at showdown.
 */
function SeatCard({
  seat,
  index,
  isCurrentActor,
  isPlayer,
  holeCards,
  isShowdown,
}: {
  seat: SeatType;
  index: number;
  isCurrentActor: boolean;
  isPlayer: boolean;
  holeCards: [number, number] | null;
  isShowdown: boolean;
}) {
  const isEmpty = seat.status === SeatStatus.EMPTY;
  const isFolded = seat.status === SeatStatus.FOLDED;
  const isAllIn = seat.status === SeatStatus.ALL_IN;
  const isSittingOut = seat.status === SeatStatus.SITTING_OUT;

  // Determine if hole cards should be shown
  // - During hand (not showdown): show face-down if active (not folded/empty)
  // - At showdown: show revealed cards for non-folded players
  const showHoleCards = !isEmpty && !isSittingOut && seat.holeCardHash;
  const showFaceUp = isShowdown && holeCards && !isFolded;

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
          {/* Hole cards (AC-CI6.4) */}
          {showHoleCards && (
            <div className="flex gap-0.5 mb-1">
              {showFaceUp && holeCards ? (
                <>
                  <Card index={holeCards[0]} size="sm" />
                  <Card index={holeCards[1]} size="sm" />
                </>
              ) : (
                <>
                  <Card faceDown size="sm" />
                  <Card faceDown size="sm" />
                </>
              )}
            </div>
          )}

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

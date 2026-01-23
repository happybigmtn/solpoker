'use client';

/**
 * Playing card component.
 *
 * AC-UI2.1: Cards support face-up, face-down, revealed, folded, and winning states.
 * AC-UI2.2: Cards render correct suit and rank based on card index.
 * AC-UI2.3: Card back pattern avoids moire and remains legible at small sizes.
 * AC-UI2.4: Suits are distinguishable without color using symbols and labels.
 *
 * Card index mapping (matches Rust crate robopoker-core):
 * - rank = index / 4 (0=2, 1=3, ..., 8=T, 9=J, 10=Q, 11=K, 12=A)
 * - suit = index % 4 (0=Clubs, 1=Diamonds, 2=Hearts, 3=Spades)
 */

import { memo } from 'react';

/** Card suit enumeration (matches robopoker-core/src/cards/suit.rs) */
export const Suit = {
  CLUBS: 0,
  DIAMONDS: 1,
  HEARTS: 2,
  SPADES: 3,
} as const;

export type SuitValue = (typeof Suit)[keyof typeof Suit];

/** Card rank enumeration (matches robopoker-core/src/cards/rank.rs) */
export const Rank = {
  TWO: 0,
  THREE: 1,
  FOUR: 2,
  FIVE: 3,
  SIX: 4,
  SEVEN: 5,
  EIGHT: 6,
  NINE: 7,
  TEN: 8,
  JACK: 9,
  QUEEN: 10,
  KING: 11,
  ACE: 12,
} as const;

export type RankValue = (typeof Rank)[keyof typeof Rank];

/** Suit display symbols (AC-PQ.CI3: visually clean) */
const SUIT_SYMBOLS: Record<SuitValue, string> = {
  [Suit.CLUBS]: '♣',
  [Suit.DIAMONDS]: '♦',
  [Suit.HEARTS]: '♥',
  [Suit.SPADES]: '♠',
};

/** Suit display names for accessibility (AC-UI2.4) */
const SUIT_NAMES: Record<SuitValue, string> = {
  [Suit.CLUBS]: 'Clubs',
  [Suit.DIAMONDS]: 'Diamonds',
  [Suit.HEARTS]: 'Hearts',
  [Suit.SPADES]: 'Spades',
};

/** Rank display characters */
const RANK_CHARS: Record<RankValue, string> = {
  [Rank.TWO]: '2',
  [Rank.THREE]: '3',
  [Rank.FOUR]: '4',
  [Rank.FIVE]: '5',
  [Rank.SIX]: '6',
  [Rank.SEVEN]: '7',
  [Rank.EIGHT]: '8',
  [Rank.NINE]: '9',
  [Rank.TEN]: 'T',
  [Rank.JACK]: 'J',
  [Rank.QUEEN]: 'Q',
  [Rank.KING]: 'K',
  [Rank.ACE]: 'A',
};

/** Rank display names for accessibility */
const RANK_NAMES: Record<RankValue, string> = {
  [Rank.TWO]: 'Two',
  [Rank.THREE]: 'Three',
  [Rank.FOUR]: 'Four',
  [Rank.FIVE]: 'Five',
  [Rank.SIX]: 'Six',
  [Rank.SEVEN]: 'Seven',
  [Rank.EIGHT]: 'Eight',
  [Rank.NINE]: 'Nine',
  [Rank.TEN]: 'Ten',
  [Rank.JACK]: 'Jack',
  [Rank.QUEEN]: 'Queen',
  [Rank.KING]: 'King',
  [Rank.ACE]: 'Ace',
};

/**
 * Convert card index (0-51) to suit.
 * AC-CI6.1: Maps card index to correct suit.
 */
export function getSuit(cardIndex: number): SuitValue {
  return (cardIndex % 4) as SuitValue;
}

/**
 * Convert card index (0-51) to rank.
 * AC-CI6.1: Maps card index to correct rank.
 */
export function getRank(cardIndex: number): RankValue {
  return Math.floor(cardIndex / 4) as RankValue;
}

/**
 * Check if suit is red (diamonds/hearts).
 * AC-PQ.CI3: Suit colors are distinct.
 */
export function isRedSuit(suit: SuitValue): boolean {
  return suit === Suit.DIAMONDS || suit === Suit.HEARTS;
}

/**
 * Get display string for a card (e.g., "A♠", "T♦").
 */
export function getCardDisplay(cardIndex: number): string {
  const suit = getSuit(cardIndex);
  const rank = getRank(cardIndex);
  return `${RANK_CHARS[rank]}${SUIT_SYMBOLS[suit]}`;
}

interface CardProps {
  /** Card index 0-51, or null/undefined for card back */
  index?: number | null;
  /** Card size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Whether the card is face down (shows card back) */
  faceDown?: boolean;
  /** Visual state for animation and styling */
  state?: 'face-up' | 'face-down' | 'revealed' | 'folded' | 'winning';
  /** Additional CSS classes */
  className?: string;
}

/**
 * Individual playing card component.
 *
 * AC-CI6.1: Renders correct suit/rank from card index.
 * AC-CI6.2: Shows card back when faceDown or index is null.
 * AC-PQ.CI3: Clean visuals with distinct suit colors.
 */
export const Card = memo(function Card({
  index,
  size = 'md',
  faceDown = false,
  state,
  className = '',
}: CardProps) {
  // Determine if we should show the card back
  const showBack = faceDown || index === null || index === undefined || index < 0 || index > 51;
  const baseState = state ?? (showBack ? 'face-down' : 'face-up');
  const derivedState = showBack && baseState === 'revealed' ? 'face-down' : baseState;

  // Size classes
  const sizeClasses = {
    sm: 'h-10 w-7 text-xs',
    md: 'h-14 w-10 text-sm',
    lg: 'h-20 w-14 text-lg',
  };

  if (showBack || derivedState === 'face-down' || derivedState === 'folded') {
    const isFolded = derivedState === 'folded';
    return (
      <div
        className={`
          ${sizeClasses[size]}
          flex items-center justify-center
          rounded-lg border border-zinc-300/60
          shadow-sm
          card-back
          ${isFolded ? 'opacity-60 rotate-6' : ''}
          ${className}
        `}
        style={{
          background: `
            repeating-linear-gradient(
              45deg,
              var(--accent-ink) 0px,
              var(--accent-ink) 6px,
              transparent 6px,
              transparent 12px
            ),
            var(--accent-ink)
          `,
          borderColor: 'rgba(255, 255, 255, 0.08)',
        }}
        aria-label={isFolded ? 'Folded card' : 'Face-down card'}
        data-state={derivedState}
      >
        {/* Card back pattern */}
        <div
          className="h-full w-full rounded-md m-0.5 border"
          style={{
            background: 'rgba(255, 255, 255, 0.04)',
            borderColor: 'rgba(255, 255, 255, 0.08)',
          }}
          aria-hidden="true"
        />
      </div>
    );
  }

  const suit = getSuit(index);
  const rank = getRank(index);
  const isRed = isRedSuit(suit);
  const suitSymbol = SUIT_SYMBOLS[suit];
  const rankChar = RANK_CHARS[rank];
  const suitName = SUIT_NAMES[suit];
  const rankName = RANK_NAMES[rank];

  return (
    <div
      className={`
        ${sizeClasses[size]}
        flex flex-col items-center justify-center
        rounded-lg border
        bg-[var(--accent-bone)]
        shadow-sm
        font-semibold
        ${isRed ? 'text-[var(--accent-crimson)]' : 'text-[var(--accent-ink)]'}
        ${derivedState === 'winning' ? 'ring-2 ring-[var(--accent-gold)] card-winning' : ''}
        ${derivedState === 'revealed' ? 'scale-[1.02] card-flip' : ''}
        ${className}
      `}
      style={
        derivedState === 'winning'
          ? { boxShadow: '0 0 12px var(--accent-gold)' }
          : undefined
      }
      aria-label={`${rankName} of ${suitName}`}
      data-state={derivedState}
      data-suit={suitName.toLowerCase()}
    >
      {/* Rank and suit display */}
      <span className="leading-none">{rankChar}</span>
      <span className="leading-none">{suitSymbol}</span>
    </div>
  );
});

/**
 * Empty card slot (placeholder when no card is dealt).
 */
export const CardSlot = memo(function CardSlot({
  size = 'md',
  className = '',
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const sizeClasses = {
    sm: 'h-10 w-7',
    md: 'h-14 w-10',
    lg: 'h-20 w-14',
  };

  return (
    <div
      className={`
        ${sizeClasses[size]}
        rounded-lg border border-dashed border-zinc-400/30
        bg-zinc-200/20 dark:bg-zinc-700/20
        ${className}
      `}
      role="img"
      aria-label="Empty card slot"
    />
  );
});

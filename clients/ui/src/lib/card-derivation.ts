/**
 * Card derivation utilities matching Rust deck shuffling logic.
 *
 * AC-CI6.3: Board cards update as streets are dealt.
 * AC-CI6.4: Player hole cards display when revealed at showdown.
 *
 * This mirrors the deck shuffling algorithm in robopoker-poker/src/processor.rs:
 * - Cards are dealt in seat order starting from dealer+1
 * - Each player gets 2 hole cards (dealt in 2 rounds)
 * - Board cards are the next 5 cards after hole cards
 */

import { MAX_SEATS } from '@/types/table';

/**
 * Fisher-Yates shuffle using seed bytes as entropy source.
 * Matches the Rust `Deck::shuffle_with_seed` implementation.
 */
function shuffleDeck(seed: Uint8Array): number[] {
  // Start with sorted deck (0-51)
  const deck = Array.from({ length: 52 }, (_, i) => i);

  // Use seed bytes to generate random indices for shuffle (little-endian)
  let seedIdx = 0;

  for (let i = 51; i > 0; i--) {
    // Get random index using seed bytes
    const byte1 = seed[seedIdx % 32];
    const byte2 = seed[(seedIdx + 1) % 32];
    seedIdx += 2;

    // Combine bytes and modulo to get index in range [0, i]
    const randomValue = byte1 | (byte2 << 8);
    const j = randomValue % (i + 1);

    // Swap
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

/**
 * Parse hex string to Uint8Array.
 */
function hexToBytes(hex: string): Uint8Array {
  if (hex.length !== 64) {
    return new Uint8Array(32);
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Determine deal order starting from dealer+1, wrapping around.
 * Only includes active seats (status not empty/sitting_out).
 */
function getDealOrder(
  dealerPosition: number,
  seats: { status: number }[]
): number[] {
  const order: number[] = [];

  // Active statuses: OCCUPIED (1), FOLDED (3), ALL_IN (4)
  // Inactive: EMPTY (0), SITTING_OUT (2)
  const isActiveForDeal = (status: number) =>
    status === 1 || status === 3 || status === 4;

  let pos = (dealerPosition + 1) % MAX_SEATS;
  for (let i = 0; i < MAX_SEATS; i++) {
    if (isActiveForDeal(seats[pos].status)) {
      order.push(pos);
    }
    pos = (pos + 1) % MAX_SEATS;
  }

  return order;
}

/**
 * Derive board cards (5 community cards) from revealed seed.
 *
 * AC-CI6.3: Returns the board cards for display.
 * Returns null if seed is not revealed.
 *
 * @param revealedSeed - 32-byte seed as hex string
 * @param dealerPosition - Current dealer seat index
 * @param seats - Array of seat statuses for determining active players
 * @returns Array of 5 card indices (0-51), or null if seed not available
 */
export function deriveBoardCards(
  revealedSeed: string,
  dealerPosition: number,
  seats: { status: number }[]
): number[] | null {
  // No seed revealed means cards can't be derived
  if (!revealedSeed || revealedSeed === '0'.repeat(64)) {
    return null;
  }

  const seed = hexToBytes(revealedSeed);
  const deck = shuffleDeck(seed);
  const dealOrder = getDealOrder(dealerPosition, seats);
  const activeCount = dealOrder.length;

  // Hole cards are dealt first: 2 rounds of dealing to each active player
  const holeCardsDealt = activeCount * 2;

  // Board cards are the next 5 cards after hole cards
  return deck.slice(holeCardsDealt, holeCardsDealt + 5);
}

/**
 * Derive hole cards for a specific seat from revealed seed.
 *
 * AC-CI6.4: Player hole cards display when revealed at showdown.
 * Returns null if seed is not revealed or seat is not active.
 *
 * @param revealedSeed - 32-byte seed as hex string
 * @param dealerPosition - Current dealer seat index
 * @param seats - Array of seat statuses
 * @param seatIndex - The seat to get hole cards for
 * @returns Array of 2 card indices (0-51), or null if not available
 */
export function deriveHoleCards(
  revealedSeed: string,
  dealerPosition: number,
  seats: { status: number }[],
  seatIndex: number
): [number, number] | null {
  // No seed revealed means cards can't be derived
  if (!revealedSeed || revealedSeed === '0'.repeat(64)) {
    return null;
  }

  const seed = hexToBytes(revealedSeed);
  const deck = shuffleDeck(seed);
  const dealOrder = getDealOrder(dealerPosition, seats);

  // Find position of this seat in the deal order
  const positionInOrder = dealOrder.indexOf(seatIndex);
  if (positionInOrder === -1) {
    return null; // Seat wasn't active during deal
  }

  const activeCount = dealOrder.length;

  // Cards are dealt in 2 rounds:
  // Round 1: positions 0, 1, 2, ... (activeCount-1)
  // Round 2: positions activeCount, activeCount+1, ... (2*activeCount-1)
  const card1Index = positionInOrder;
  const card2Index = activeCount + positionInOrder;

  return [deck[card1Index], deck[card2Index]];
}

/**
 * Check if the revealed seed is available (non-zero).
 */
export function isSeedRevealed(revealedSeed: string): boolean {
  return Boolean(revealedSeed && revealedSeed !== '0'.repeat(64));
}

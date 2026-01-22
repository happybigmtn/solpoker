'use client';

/**
 * Hook for subscribing to on-chain table state updates.
 *
 * AC-4.1: Subscribes to on-chain table state and only re-renders
 * on relevant updates (no aggressive polling).
 *
 * Uses Solana's accountSubscribe WebSocket API to receive real-time
 * updates when the Table account changes.
 */

import { useEffect, useMemo, useSyncExternalStore, useRef } from 'react';
import { useRpc, useRpcSubscriptions } from './use-rpc';
import { createTableStore, type TableStore } from '@/stores/table-store';
import {
  type TableState,
  type Seat,
  type SeatStatusValue,
  type TableStatusValue,
  type StreetValue,
  MAX_SEATS,
  emptyTableState,
} from '@/types/table';

// Re-export types for convenience
export type { TableState, Seat, TableStore };

/**
 * Parse raw account data (Uint8Array) into TableState.
 *
 * Layout matches Rust struct (see robopoker-poker/src/state.rs):
 * - discriminator: u8 (offset 0)
 * - status: u8 (offset 1)
 * - player_count: u8 (offset 2)
 * - dealer_position: u8 (offset 3)
 * - current_actor: u8 (offset 4)
 * - current_street: u8 (offset 5)
 * - active_count: u8 (offset 6)
 * - seed_revealed: u8 (offset 7)
 * - table_id: u64 (offset 8)
 * - hand_id: u64 (offset 16)
 * - small_blind: u64 (offset 24)
 * - big_blind: u64 (offset 32)
 * - action_deadline_slot: u64 (offset 40)
 * - current_bet: u64 (offset 48)
 * - min_raise: u64 (offset 56)
 * - pot: u64 (offset 64)
 * - rake_accumulated: u64 (offset 72)
 * - vault: Pubkey (32 bytes, offset 80)
 * - seed_commitment: [u8; 32] (offset 112)
 * - revealed_seed: [u8; 32] (offset 144)
 * - seats: [Seat; 10] (offset 176, 96 bytes each)
 */
export function parseTableData(data: Uint8Array): TableState {
  if (data.length < 1136) {
    return emptyTableState();
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // Header fields
  const status = data[1] as TableStatusValue;
  const playerCount = data[2];
  const dealerPosition = data[3];
  const currentActor = data[4];
  const currentStreet = data[5] as StreetValue;
  const activeCount = data[6];
  const seedRevealed = data[7] !== 0;

  // u64 fields (little-endian)
  const tableId = view.getBigUint64(8, true);
  const handId = view.getBigUint64(16, true);
  const smallBlind = view.getBigUint64(24, true);
  const bigBlind = view.getBigUint64(32, true);
  const actionDeadlineSlot = view.getBigUint64(40, true);
  const currentBet = view.getBigUint64(48, true);
  const minRaise = view.getBigUint64(56, true);
  const pot = view.getBigUint64(64, true);
  const rakeAccumulated = view.getBigUint64(72, true);

  // Pubkey (32 bytes) - convert to base58
  const vault = encodeBase58(data.slice(80, 112));

  // 32-byte hashes - convert to hex
  const seedCommitment = encodeHex(data.slice(112, 144));
  const revealedSeed = encodeHex(data.slice(144, 176));

  // Parse seats (96 bytes each, starting at offset 176)
  const seats: Seat[] = [];
  for (let i = 0; i < MAX_SEATS; i++) {
    const seatOffset = 176 + i * 96;
    seats.push(parseSeat(data, seatOffset, view));
  }

  return {
    status,
    playerCount,
    dealerPosition,
    currentActor,
    currentStreet,
    activeCount,
    seedRevealed,
    tableId,
    handId,
    smallBlind,
    bigBlind,
    actionDeadlineSlot,
    currentBet,
    minRaise,
    pot,
    rakeAccumulated,
    vault,
    seedCommitment,
    revealedSeed,
    seats,
  };
}

/**
 * Parse a single seat from account data.
 *
 * Seat layout (96 bytes):
 * - status: u8 (offset 0)
 * - has_acted: u8 (offset 1)
 * - _padding: [u8; 6] (offset 2)
 * - player: Pubkey (32 bytes, offset 8)
 * - stack: u64 (offset 40)
 * - current_bet: u64 (offset 48)
 * - total_bet: u64 (offset 56)
 * - hole_card_hash: [u8; 32] (offset 64)
 */
function parseSeat(
  data: Uint8Array,
  offset: number,
  view: DataView
): Seat {
  const status = data[offset] as SeatStatusValue;
  const hasActed = data[offset + 1] !== 0;

  // Player pubkey (32 bytes at offset + 8)
  const playerBytes = data.slice(offset + 8, offset + 40);
  const player = isZeroBytes(playerBytes) ? '' : encodeBase58(playerBytes);

  // u64 fields
  const stack = view.getBigUint64(offset + 40, true);
  const currentBet = view.getBigUint64(offset + 48, true);
  const totalBet = view.getBigUint64(offset + 56, true);

  // Hole card hash (32 bytes)
  const holeCardHashBytes = data.slice(offset + 64, offset + 96);
  const holeCardHash = isZeroBytes(holeCardHashBytes)
    ? ''
    : encodeHex(holeCardHashBytes);

  return {
    status,
    hasActed,
    player,
    stack,
    currentBet,
    totalBet,
    holeCardHash,
  };
}

/**
 * Check if all bytes are zero.
 */
function isZeroBytes(bytes: Uint8Array): boolean {
  return bytes.every((b) => b === 0);
}

/**
 * Encode bytes as hex string.
 */
function encodeHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Base58 alphabet (Bitcoin/Solana style).
 */
const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Encode bytes as base58 string.
 * Simple implementation for pubkey display.
 */
function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';

  // Count leading zeros
  let zeros = 0;
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    zeros++;
  }

  // Convert to base58
  const size = Math.ceil(bytes.length * 138 / 100) + 1;
  const b58 = new Uint8Array(size);
  let length = 0;

  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    let j = 0;
    for (let k = size - 1; k >= 0 && (carry !== 0 || j < length); k--, j++) {
      carry += 256 * b58[k];
      b58[k] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    length = j;
  }

  // Skip leading zeros in b58
  let start = size - length;
  while (start < size && b58[start] === 0) {
    start++;
  }

  // Build result
  let result = '1'.repeat(zeros);
  for (let i = start; i < size; i++) {
    result += BASE58_ALPHABET[b58[i]];
  }

  return result;
}

/**
 * Context for the table store.
 * Components use this to access selective subscriptions.
 */
export interface TableSubscriptionContextValue {
  store: TableStore;
  tableAddress: string;
  isConnected: boolean;
  error: Error | null;
}

/**
 * Hook to subscribe to a table's on-chain state.
 *
 * Returns a store that components can use to selectively subscribe
 * to different parts of the table state.
 *
 * @param tableAddress - Base58 table account address
 */
export function useTableSubscription(tableAddress: string) {
  const rpc = useRpc();
  const rpcSubscriptions = useRpcSubscriptions();
  const store = useMemo(() => createTableStore(), []);
  const errorRef = useRef<Error | null>(null);
  const isConnectedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!tableAddress) return;

    // Clean up previous subscription
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    async function fetchAndSubscribe() {
      try {
        // First, fetch initial account data via HTTP RPC
        // This gives us the current state immediately
        const { value: accountInfo } = await rpc.getAccountInfo(
          tableAddress as Parameters<typeof rpc.getAccountInfo>[0],
          { encoding: 'base64', commitment: 'confirmed' }
        ).send();

        if (abort.signal.aborted) return;

        if (accountInfo && accountInfo.data) {
          const dataArray = accountInfo.data as unknown as [string, string];
          const [base64Data] = dataArray;
          const data = Uint8Array.from(atob(base64Data), (c) =>
            c.charCodeAt(0)
          );
          const tableState = parseTableData(data);
          store.setState(tableState);
        }

        isConnectedRef.current = true;
        errorRef.current = null;

        // Then subscribe to account changes via WebSocket
        const notifications = rpcSubscriptions.accountNotifications(
          tableAddress as Parameters<typeof rpcSubscriptions.accountNotifications>[0],
          { encoding: 'base64', commitment: 'confirmed' }
        );

        // Subscribe to notifications using async iterator
        const asyncIterable = await notifications.subscribe({ abortSignal: abort.signal });
        for await (const notification of asyncIterable) {
          if (abort.signal.aborted) break;

          // Extract account data from notification
          const accountInfo = notification.value;
          if (accountInfo && accountInfo.data) {
            const dataArray = accountInfo.data as unknown as [string, string];
            const [base64Data] = dataArray;
            const data = Uint8Array.from(atob(base64Data), (c) =>
              c.charCodeAt(0)
            );
            const tableState = parseTableData(data);
            store.setState(tableState);
          }
        }
      } catch (err) {
        // Ignore abort errors
        if (err instanceof Error && err.name === 'AbortError') return;
        errorRef.current = err as Error;
        isConnectedRef.current = false;
      }
    }

    fetchAndSubscribe();

    return () => {
      abort.abort();
      isConnectedRef.current = false;
    };
  }, [tableAddress, rpc, rpcSubscriptions, store]);

  return {
    store,
    tableAddress,
    get isConnected() {
      return isConnectedRef.current;
    },
    get error() {
      return errorRef.current;
    },
  };
}

/**
 * Hook to use the full table state with re-render on any change.
 *
 * Use sparingly - prefer selective hooks below.
 */
export function useTableState(store: TableStore): TableState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/**
 * Hook to use a specific seat with re-render only when that seat changes.
 *
 * AC-4.1: Only re-renders when the specific seat changes.
 */
export function useSeat(store: TableStore, index: number): Seat {
  const subscribe = useMemo(
    () => (listener: () => void) => store.subscribeSeat(index, listener),
    [store, index]
  );
  const getSnapshot = useMemo(
    () => () => store.getSeat(index),
    [store, index]
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Hook to use the pot with re-render only when pot changes.
 *
 * AC-4.1: Only re-renders when the pot changes.
 */
export function usePot(store: TableStore): bigint {
  return useSyncExternalStore(
    store.subscribePot,
    store.getPot,
    store.getPot
  );
}

/**
 * Hook to use the current actor with re-render only when actor changes.
 *
 * AC-4.1: Only re-renders when the current actor changes.
 */
export function useCurrentActor(store: TableStore): number {
  return useSyncExternalStore(
    store.subscribeActor,
    store.getCurrentActor,
    store.getCurrentActor
  );
}

/**
 * Hook to use the table status with re-render only when status changes.
 *
 * AC-4.1: Only re-renders when the table status changes.
 */
export function useTableStatus(store: TableStore): number {
  return useSyncExternalStore(
    store.subscribeStatus,
    store.getStatus,
    store.getStatus
  );
}

/**
 * Hook to use the betting street with re-render only when street changes.
 *
 * AC-4.1: Only re-renders when the betting street changes.
 */
export function useStreet(store: TableStore): number {
  return useSyncExternalStore(
    store.subscribeStreet,
    store.getStreet,
    store.getStreet
  );
}

/**
 * Hook to use the current bet with re-render only when it changes.
 *
 * AC-CI3.1–AC-CI3.5: Needed to compute toCall amount.
 */
export function useCurrentBet(store: TableStore): bigint {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().currentBet,
    () => store.getState().currentBet
  );
}

/**
 * Hook to use the minimum raise with re-render only when it changes.
 *
 * AC-CI3.4: Needed for raise amount validation.
 */
export function useMinRaise(store: TableStore): bigint {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().minRaise,
    () => store.getState().minRaise
  );
}

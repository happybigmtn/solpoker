/**
 * Tests for useTables hook.
 *
 * AC-CI5.1: UI can fetch all table accounts via `getProgramAccounts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// Mock parseTableData from use-table-subscription
vi.mock('./use-table-subscription', () => ({
  parseTableData: vi.fn((data: Uint8Array) => {
    // Return mock table state based on tableId at offset 8
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const tableId = view.getBigUint64(8, true);
    return {
      tableId,
      smallBlind: view.getBigUint64(24, true),
      bigBlind: view.getBigUint64(32, true),
      playerCount: data[2],
      status: data[1],
      pot: view.getBigUint64(64, true),
    };
  }),
}));

// Create a mock RPC with configurable responses
const createMockRpc = (accounts: Array<{ pubkey: string; data: string }>) => ({
  getProgramAccounts: vi.fn(() => ({
    send: vi.fn(() =>
      Promise.resolve(
        accounts.map((acc) => ({
          pubkey: acc.pubkey,
          account: {
            data: [acc.data, 'base64'] as [string, string],
          },
        }))
      )
    ),
  })),
});

// Mock @solana/kit
vi.mock('@solana/kit', () => ({
  createSolanaRpc: vi.fn(() => createMockRpc([])),
}));

// Mock @robopoker/client
vi.mock('@robopoker/client', () => ({
  ACCOUNT_DISCRIMINATOR: { TABLE: 2 },
  TABLE_SIZE: 1136,
}));

import { createSolanaRpc } from '@solana/kit';
import { useTables } from './use-tables';
import type { Address } from '@solana/kit';

const mockCreateSolanaRpc = createSolanaRpc as ReturnType<typeof vi.fn>;

/**
 * Create mock table account data.
 */
function createMockTableData(options: {
  tableId: bigint;
  smallBlind: bigint;
  bigBlind: bigint;
  playerCount: number;
  status: number;
  pot: bigint;
}): Uint8Array {
  const data = new Uint8Array(1136);
  const view = new DataView(data.buffer);

  // Discriminator at offset 0 (TABLE = 2)
  data[0] = 2;
  // Status at offset 1
  data[1] = options.status;
  // Player count at offset 2
  data[2] = options.playerCount;
  // Table ID at offset 8
  view.setBigUint64(8, options.tableId, true);
  // Small blind at offset 24
  view.setBigUint64(24, options.smallBlind, true);
  // Big blind at offset 32
  view.setBigUint64(32, options.bigBlind, true);
  // Pot at offset 64
  view.setBigUint64(64, options.pot, true);

  return data;
}

/**
 * Convert Uint8Array to base64.
 */
function toBase64(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary);
}

describe('useTables (AC-CI5.1)', () => {
  const mockConfig = {
    pokerProgramId: 'mockProgramId' as Address,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC-CI5.1: fetches table accounts via getProgramAccounts', async () => {
    const tableData = createMockTableData({
      tableId: 1n,
      smallBlind: 1_000_000_000n,
      bigBlind: 2_000_000_000n,
      playerCount: 3,
      status: 0, // WAITING
      pot: 5_000_000_000n,
    });

    const mockRpc = createMockRpc([
      { pubkey: 'tableAddress1', data: toBase64(tableData) },
    ]);

    mockCreateSolanaRpc.mockReturnValue(mockRpc);

    const { result } = renderHook(() => useTables(mockConfig));

    // Initially loading
    expect(result.current.isLoading).toBe(true);

    // Wait for fetch to complete
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Verify getProgramAccounts was called with correct filters
    // TABLE discriminator (2) encoded as base64 = "Ag=="
    expect(mockRpc.getProgramAccounts).toHaveBeenCalledWith(
      mockConfig.pokerProgramId,
      expect.objectContaining({
        encoding: 'base64',
        filters: expect.arrayContaining([
          { dataSize: 1136n },
          expect.objectContaining({
            memcmp: expect.objectContaining({
              offset: 0n,
              bytes: 'Ag==', // TABLE discriminator (2) as base64
              encoding: 'base64',
            }),
          }),
        ]),
      })
    );
  });

  it('AC-CI5.1: parses fetched accounts into TableSummary', async () => {
    const tableData = createMockTableData({
      tableId: 123n,
      smallBlind: 1_000_000_000n,
      bigBlind: 2_000_000_000n,
      playerCount: 5,
      status: 1, // PLAYING
      pot: 10_000_000_000n,
    });

    const mockRpc = createMockRpc([
      { pubkey: 'tableAddress123', data: toBase64(tableData) },
    ]);

    mockCreateSolanaRpc.mockReturnValue(mockRpc);

    const { result } = renderHook(() => useTables(mockConfig));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.tables).toHaveLength(1);
    expect(result.current.tables[0]).toMatchObject({
      address: 'tableAddress123',
      tableId: 123n,
      smallBlind: 1_000_000_000n,
      bigBlind: 2_000_000_000n,
      playerCount: 5,
      status: 1,
      pot: 10_000_000_000n,
    });
  });

  it('AC-CI5.1: sorts tables by tableId', async () => {
    const table1 = createMockTableData({
      tableId: 100n,
      smallBlind: 1n,
      bigBlind: 2n,
      playerCount: 1,
      status: 0,
      pot: 0n,
    });
    const table2 = createMockTableData({
      tableId: 50n,
      smallBlind: 1n,
      bigBlind: 2n,
      playerCount: 2,
      status: 0,
      pot: 0n,
    });
    const table3 = createMockTableData({
      tableId: 200n,
      smallBlind: 1n,
      bigBlind: 2n,
      playerCount: 3,
      status: 0,
      pot: 0n,
    });

    const mockRpc = createMockRpc([
      { pubkey: 'table100', data: toBase64(table1) },
      { pubkey: 'table50', data: toBase64(table2) },
      { pubkey: 'table200', data: toBase64(table3) },
    ]);

    mockCreateSolanaRpc.mockReturnValue(mockRpc);

    const { result } = renderHook(() => useTables(mockConfig));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.tables).toHaveLength(3);
    expect(result.current.tables[0].tableId).toBe(50n);
    expect(result.current.tables[1].tableId).toBe(100n);
    expect(result.current.tables[2].tableId).toBe(200n);
  });

  it('AC-CI5.1: returns empty array when no tables exist', async () => {
    const mockRpc = createMockRpc([]);
    mockCreateSolanaRpc.mockReturnValue(mockRpc);

    const { result } = renderHook(() => useTables(mockConfig));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.tables).toHaveLength(0);
    expect(result.current.error).toBeUndefined();
  });

  it('AC-CI5.1: handles RPC errors gracefully', async () => {
    const mockRpc = {
      getProgramAccounts: vi.fn(() => ({
        send: vi.fn(() => Promise.reject(new Error('RPC connection failed'))),
      })),
    };
    mockCreateSolanaRpc.mockReturnValue(mockRpc);

    const { result } = renderHook(() => useTables(mockConfig));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.tables).toHaveLength(0);
    expect(result.current.error).toBe('RPC connection failed');
  });

  it('refresh() refetches table list', async () => {
    const table1 = createMockTableData({
      tableId: 1n,
      smallBlind: 1n,
      bigBlind: 2n,
      playerCount: 1,
      status: 0,
      pot: 0n,
    });

    const mockRpc = createMockRpc([{ pubkey: 'table1', data: toBase64(table1) }]);
    mockCreateSolanaRpc.mockReturnValue(mockRpc);

    const { result } = renderHook(() => useTables(mockConfig));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.tables).toHaveLength(1);
    expect(mockRpc.getProgramAccounts).toHaveBeenCalledTimes(1);

    // Refresh
    await act(async () => {
      await result.current.refresh();
    });

    expect(mockRpc.getProgramAccounts).toHaveBeenCalledTimes(2);
  });
});

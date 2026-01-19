'use client';

/**
 * Hook for fetching all table accounts via getProgramAccounts.
 *
 * AC-CI5.1: UI can fetch all table accounts via `getProgramAccounts`.
 * AC-CI5.2: UI displays table list with blinds, player count, and join option.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createSolanaRpc, type Address } from '@solana/kit';
import { ACCOUNT_DISCRIMINATOR, TABLE_SIZE } from '@robopoker/client';
import { parseTableData } from './use-table-subscription';
import type { TableState } from '@/types/table';

/**
 * Summary info for a table in the list.
 * Includes only the fields needed for the table list UI.
 */
export interface TableSummary {
  /** Table account address (base58) */
  address: Address;
  /** Table ID */
  tableId: bigint;
  /** Small blind amount */
  smallBlind: bigint;
  /** Big blind amount */
  bigBlind: bigint;
  /** Number of players at the table */
  playerCount: number;
  /** Table status (0=WAITING, 1=PLAYING, 2=CLOSED, 3=SHOWDOWN) */
  status: number;
  /** Current pot size */
  pot: bigint;
}

/**
 * Configuration for the useTables hook.
 */
export interface UseTablesConfig {
  /** Poker program ID */
  pokerProgramId: Address;
}

/**
 * Return type for the useTables hook.
 */
export interface UseTablesReturn {
  /** List of table summaries */
  tables: TableSummary[];
  /** Whether tables are currently loading */
  isLoading: boolean;
  /** Error message if fetch failed */
  error?: string;
  /** Refresh the table list */
  refresh: () => Promise<void>;
}

/**
 * Convert TableState to TableSummary.
 */
function toTableSummary(address: Address, state: TableState): TableSummary {
  return {
    address,
    tableId: state.tableId,
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
    playerCount: state.playerCount,
    status: state.status,
    pot: state.pot,
  };
}

/**
 * Hook for fetching all table accounts from the poker program.
 *
 * AC-CI5.1: Uses getProgramAccounts with memcmp filter on TABLE discriminator.
 *
 * @param config - Configuration including program ID
 * @returns List of tables, loading state, and refresh function
 */
export function useTables(config: UseTablesConfig): UseTablesReturn {
  const { pokerProgramId } = config;

  const [tables, setTables] = useState<TableSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();

  // Create RPC client (memoized)
  const rpc = useMemo(() => {
    const httpUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
    return createSolanaRpc(httpUrl);
  }, []);

  /**
   * Fetch all table accounts via getProgramAccounts.
   * AC-CI5.1: UI can fetch all table accounts via `getProgramAccounts`.
   */
  const fetchTables = useCallback(async () => {
    setIsLoading(true);
    setError(undefined);

    try {
      // Use memcmp filter to match TABLE discriminator (byte 0 = 2)
      // Encode the discriminator byte as base64
      const tableDiscriminator = ACCOUNT_DISCRIMINATOR.TABLE;
      const discriminatorBase64 = btoa(String.fromCharCode(tableDiscriminator));

      // Cast bytes to any to work around strict branded type requirements
      // (same pattern as entropy-provider/src/subscription.ts)
      const response = await rpc
        .getProgramAccounts(pokerProgramId, {
          encoding: 'base64',
          filters: [
            // Filter by account size (TABLE_SIZE = 1136 bytes)
            { dataSize: BigInt(TABLE_SIZE) },
            // Filter by TABLE discriminator at offset 0
            {
              memcmp: {
                offset: BigInt(0),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                bytes: discriminatorBase64 as any,
                encoding: 'base64',
              },
            },
          ],
        })
        .send();

      // Parse each account's data into TableSummary
      const tableSummaries: TableSummary[] = [];

      // Response is directly an array of accounts
      for (const account of response) {
        const address = account.pubkey as Address;
        const accountData = account.account;

        // Data is base64 encoded as [data, encoding] tuple
        const data = accountData.data as unknown as [string, string];
        const [base64Data] = data;
        const bytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));

        // Parse the table data
        const tableState = parseTableData(bytes);
        tableSummaries.push(toTableSummary(address, tableState));
      }

      // Sort by tableId for consistent ordering
      tableSummaries.sort((a, b) => {
        if (a.tableId < b.tableId) return -1;
        if (a.tableId > b.tableId) return 1;
        return 0;
      });

      setTables(tableSummaries);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch tables';
      setError(message);
      setTables([]);
    } finally {
      setIsLoading(false);
    }
  }, [rpc, pokerProgramId]);

  // Fetch on mount
  useEffect(() => {
    fetchTables();
  }, [fetchTables]);

  return {
    tables,
    isLoading,
    error,
    refresh: fetchTables,
  };
}

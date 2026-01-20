'use client';

/**
 * Table list component for displaying available poker tables.
 *
 * AC-CI5.2: UI displays table list with blinds, player count, and join option.
 */

import { useTables, type TableSummary } from '@/hooks/use-tables';
import { TABLE_STATUS, MAX_SEATS } from '@robopoker/client';
import Link from 'next/link';
import type { Address } from '@solana/kit';

interface TableListProps {
  /** Poker program ID */
  pokerProgramId: Address;
}

/**
 * Format token amount for display (divide by 10^9 for CRISPS decimals).
 */
function formatTokenAmount(amount: bigint): string {
  const divisor = 1_000_000_000n;
  const whole = amount / divisor;
  const fractional = amount % divisor;

  if (fractional === 0n) {
    return whole.toString();
  }

  // Format with up to 2 decimal places
  const fractionalStr = fractional.toString().padStart(9, '0');
  const decimals = fractionalStr.slice(0, 2).replace(/0+$/, '');

  if (decimals === '') {
    return whole.toString();
  }

  return `${whole}.${decimals}`;
}

/**
 * Get status badge text and style.
 */
function getStatusBadge(status: number): { text: string; className: string } {
  switch (status) {
    case TABLE_STATUS.WAITING:
      return {
        text: 'Waiting',
        className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
      };
    case TABLE_STATUS.PLAYING:
      return {
        text: 'Playing',
        className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
      };
    case TABLE_STATUS.CLOSED:
      return {
        text: 'Closed',
        className: 'bg-zinc-100 text-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-400',
      };
    case TABLE_STATUS.SHOWDOWN:
      return {
        text: 'Showdown',
        className: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
      };
    default:
      return {
        text: 'Unknown',
        className: 'bg-zinc-100 text-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-400',
      };
  }
}

/**
 * Single table row in the list.
 */
function TableRow({
  table,
  useContentVisibility,
}: {
  table: TableSummary;
  useContentVisibility: boolean;
}) {
  const statusBadge = getStatusBadge(table.status);
  const blindsText = `${formatTokenAmount(table.smallBlind)}/${formatTokenAmount(table.bigBlind)}`;
  const seatsText = `${table.playerCount}/${MAX_SEATS}`;
  const canJoin = table.status === TABLE_STATUS.WAITING && table.playerCount < MAX_SEATS;
  const canNavigate = canJoin || table.status === TABLE_STATUS.PLAYING;
  const actionLabel = canJoin ? 'Join' : table.status === TABLE_STATUS.PLAYING ? 'Watch' : 'View';

  return (
    <tr
      className={`border-b border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors ${
        useContentVisibility ? 'content-visibility-auto' : ''
      }`}
    >
      <td className="px-4 py-3 text-sm font-mono text-zinc-600 dark:text-zinc-400">
        #{table.tableId.toString()}
      </td>
      <td className="px-4 py-3 text-sm">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge.className}`}
        >
          {statusBadge.text}
        </span>
      </td>
      <td className="px-4 py-3 text-sm font-mono">
        {blindsText}
      </td>
      <td className="px-4 py-3 text-sm">
        {seatsText}
      </td>
      <td className="px-4 py-3 text-sm font-mono">
        {formatTokenAmount(table.pot)}
      </td>
      <td className="px-4 py-3 text-right">
        {canNavigate ? (
          <Link
            href={`/table/${table.address}`}
            className={`inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              canJoin
                ? 'bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-900'
                : 'bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600'
            }`}
          >
            {actionLabel}
          </Link>
        ) : (
          <span
            className="inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium bg-zinc-100 text-zinc-400 cursor-not-allowed dark:bg-zinc-800 dark:text-zinc-500"
            aria-disabled="true"
          >
            {actionLabel}
          </span>
        )}
      </td>
    </tr>
  );
}

/**
 * Table list component displaying all available tables.
 *
 * AC-CI5.2: Displays blinds, player count, and join option.
 */
export function TableList({ pokerProgramId }: TableListProps) {
  const { tables, isLoading, error, refresh } = useTables({ pokerProgramId });
  const useContentVisibility = tables.length > 50;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-emerald-600" />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading tables...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 py-12">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        <button
          onClick={refresh}
          className="inline-flex items-center rounded-md bg-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600"
        >
          Retry
        </button>
      </div>
    );
  }

  if (tables.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12">
        <p className="text-zinc-600 dark:text-zinc-400">No tables found.</p>
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          Create a table to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Available Tables ({tables.length})
        </h3>
        <button
          onClick={refresh}
          className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          title="Refresh table list"
        >
          Refresh
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
          <thead className="bg-zinc-50 dark:bg-zinc-900/50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Table
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Status
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Blinds
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Players
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Pot
              </th>
              <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 bg-white dark:divide-zinc-800 dark:bg-zinc-900">
            {tables.map((table) => (
              <TableRow
                key={table.address}
                table={table}
                useContentVisibility={useContentVisibility}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

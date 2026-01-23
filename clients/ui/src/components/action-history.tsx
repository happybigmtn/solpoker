'use client';

/**
 * Action history component for displaying recent poker actions.
 *
 * AC-3.2: Action history visible without scrolling on desktop.
 * AC-4.5: Dynamically imported when needed (heavy panel).
 * AC-4.6: Virtualized if 50+ items.
 */

import { memo, useRef, useEffect } from 'react';

export interface ActionHistoryEntry {
  /** Timestamp of the action */
  timestamp: number;
  /** Player address (base58) */
  player: string;
  /** Action type: fold, check, call, raise, all-in */
  action: 'fold' | 'check' | 'call' | 'raise' | 'all-in' | 'post-blind';
  /** Amount (for call, raise, all-in, post-blind) */
  amount?: bigint;
  /** Seat index */
  seatIndex: number;
}

interface ActionHistoryProps {
  entries: ActionHistoryEntry[];
  /** Maximum entries to show without virtualization */
  maxVisible?: number;
}

/**
 * Action history panel.
 *
 * AC-3.2: Compact display for desktop without scrolling.
 * AC-4.6: Uses content-visibility: auto for large lists.
 */
export const ActionHistory = memo(function ActionHistory({
  entries,
  maxVisible = 8,
}: ActionHistoryProps) {
  const listRef = useRef<HTMLUListElement>(null);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [entries.length]);

  if (entries.length === 0) {
    return (
      <div className="rounded-lg bg-zinc-100 p-3 dark:bg-zinc-800">
        <h3 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
          Action History
        </h3>
        <p className="mt-1 text-xs text-zinc-500">No actions yet…</p>
      </div>
    );
  }

  // AC-4.6: For 50+ items, use content-visibility
  const useVirtualization = entries.length > 50;

  return (
    <div className="rounded-lg bg-zinc-100 dark:bg-zinc-800">
      <h3 className="border-b border-zinc-200 px-3 py-2 text-sm font-medium dark:border-zinc-700">
        Action History
      </h3>
      <ul
        ref={listRef}
        className="max-h-48 overflow-y-auto p-2"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-label="Recent poker actions"
      >
        {entries.slice(-maxVisible).map((entry, i) => (
          <ActionHistoryItem
            key={`${entry.timestamp}-${i}`}
            entry={entry}
            useVirtualization={useVirtualization}
          />
        ))}
      </ul>
    </div>
  );
});

/**
 * Single action history entry.
 */
const ActionHistoryItem = memo(function ActionHistoryItem({
  entry,
  useVirtualization,
}: {
  entry: ActionHistoryEntry;
  useVirtualization: boolean;
}) {
  return (
    <li
      className={`flex items-center justify-between py-1 text-xs ${
        useVirtualization ? 'content-visibility-auto' : ''
      }`}
    >
      <span className="flex items-center gap-2">
        <span className="font-mono text-zinc-500">
          {truncateAddress(entry.player)}
        </span>
        <ActionBadge action={entry.action} />
      </span>
      {entry.amount !== undefined && entry.amount > 0n && (
        <span className="font-medium tabular-nums">
          {formatChips(entry.amount)}
        </span>
      )}
    </li>
  );
});

/**
 * Action type badge with color coding.
 */
function ActionBadge({ action }: { action: ActionHistoryEntry['action'] }) {
  const config: Record<
    ActionHistoryEntry['action'],
    { label: string; className: string }
  > = {
    fold: {
      label: 'Fold',
      className: 'bg-zinc-500 text-white',
    },
    check: {
      label: 'Check',
      className: 'bg-green-500 text-white',
    },
    call: {
      label: 'Call',
      className: 'bg-blue-500 text-white',
    },
    raise: {
      label: 'Raise',
      className: 'bg-orange-500 text-white',
    },
    'all-in': {
      label: 'All In',
      className: 'bg-red-500 text-white',
    },
    'post-blind': {
      label: 'Blind',
      className: 'bg-purple-500 text-white',
    },
  };

  const { label, className } = config[action];

  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${className}`}
      data-action-badge
      data-action={action}
    >
      {label}
    </span>
  );
}

function truncateAddress(address: string): string {
  if (!address) return '';
  if (address.length <= 8) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function formatChips(amount: bigint): string {
  const num = Number(amount);
  return new Intl.NumberFormat('en-US', {
    style: 'decimal',
    maximumFractionDigits: 0,
  }).format(num);
}

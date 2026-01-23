'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { TablePageContent } from './content';
import { TablePageSkeleton } from './skeleton';

/**
 * Client-side table page component.
 *
 * Handles catch-all route [[...id]] where:
 * - /table → shows table list prompt
 * - /table/123 → shows specific table
 *
 * AC-7.1: URL reflects table/session state for deep linking.
 * AC-4.4: Suspense boundaries to avoid data-fetch waterfalls.
 *
 * Note: Uses usePathname instead of useParams because useParams doesn't
 * work correctly in static exports for non-pre-rendered catch-all routes.
 */
export function TablePageClient() {
  const pathname = usePathname();

  // Extract table ID from pathname: /table/123 → '123'
  // usePathname works correctly in static exports unlike useParams
  const pathSegments = pathname.split('/').filter(Boolean);
  const id = pathSegments[1]; // ['table', '123'] → '123'

  // Handle base /table route (no ID provided)
  if (!id) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">RoboPoker Tables</h1>
          <p className="text-zinc-600 dark:text-zinc-400 mb-4">
            No table ID specified. Go to the home page to find or create a table.
          </p>
          <Link
            href="/"
            className="inline-block rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            Browse Tables
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Skip link for accessibility (AC-5.4) */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-4 focus:bg-zinc-900 focus:text-white"
      >
        Skip to main content
      </a>

      {/* AC-7.2: Navigation uses Link for proper SPA routing, middle-click and Cmd/Ctrl+click support */}
      <header className="flex h-16 items-center justify-between border-b border-zinc-200 px-6 dark:border-zinc-800">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-lg font-semibold hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
          >
            RoboPoker
          </Link>
          <span className="text-zinc-400">/</span>
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            Table {truncateId(id)}
          </span>
        </div>
        {/* Wallet connect will be rendered client-side */}
      </header>

      <main id="main" className="flex flex-1 flex-col p-6">
        {/* Wrap in Suspense because TableContentWithSearchParams uses useSearchParams */}
        <Suspense fallback={<TablePageSkeleton />}>
          <TableContentWithSearchParams tableId={id} />
        </Suspense>
      </main>
    </div>
  );
}

/**
 * Inner component that uses useSearchParams.
 * Must be wrapped in Suspense for static export compatibility.
 */
function TableContentWithSearchParams({ tableId }: { tableId: string }) {
  const searchParams = useSearchParams();
  const panel = searchParams.get('panel') ?? undefined;

  return <TablePageContent tableId={tableId} activePanel={panel} />;
}

/**
 * Truncate table ID for display.
 */
function truncateId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

import { Suspense } from 'react';
import { TablePageContent } from './content';
import { TablePageSkeleton } from './skeleton';

/**
 * Table page with dynamic route.
 *
 * AC-7.1: URL reflects table/session state for deep linking.
 * AC-4.4: Suspense boundaries to avoid data-fetch waterfalls.
 * AC-1.5: Server component that delegates to client components.
 */
interface TablePageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ panel?: string }>;
}

export default async function TablePage({ params, searchParams }: TablePageProps) {
  const { id } = await params;
  const { panel } = await searchParams;

  return (
    <div className="flex min-h-screen flex-col">
      {/* Skip link for accessibility (AC-5.4) */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-4 focus:bg-zinc-900 focus:text-white"
      >
        Skip to main content
      </a>

      <header className="flex h-16 items-center justify-between border-b border-zinc-200 px-6 dark:border-zinc-800">
        <div className="flex items-center gap-4">
          <a
            href="/"
            className="text-lg font-semibold hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
          >
            RoboPoker
          </a>
          <span className="text-zinc-400">/</span>
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            Table {truncateId(id)}
          </span>
        </div>
        {/* Wallet connect will be rendered client-side */}
      </header>

      <main id="main" className="flex flex-1 flex-col p-6">
        <Suspense fallback={<TablePageSkeleton />}>
          <TablePageContent tableId={id} activePanel={panel} />
        </Suspense>
      </main>
    </div>
  );
}

/**
 * Truncate table ID for display.
 */
function truncateId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

/**
 * Generate metadata for the table page.
 */
export async function generateMetadata({ params }: TablePageProps) {
  const { id } = await params;
  return {
    title: `Table ${truncateId(id)} | RoboPoker`,
    description: 'On-chain multiplayer poker table',
  };
}

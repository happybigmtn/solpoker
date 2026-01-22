import { TablePageClient } from './table-page-client';

/**
 * Table page with optional catch-all route [[...id]].
 *
 * Handles:
 * - /table (base route, pre-rendered)
 * - /table/123 (specific table, handled via SPA fallback)
 *
 * Server component wrapper that exports generateStaticParams for static export.
 * Actual rendering is delegated to the client component.
 *
 * AC-7.1: URL reflects table/session state for deep linking.
 */

/**
 * Generate static params for pre-rendering.
 * Pre-renders only the base /table route.
 * Individual table routes (/table/123) are handled via SPA fallback in netlify.toml.
 */
export function generateStaticParams() {
  // Pre-render the base /table route (id = undefined means no segments)
  return [{ id: [] }];
}

export default function TablePage() {
  return <TablePageClient />;
}

/**
 * Generate metadata for the table page.
 */
export const metadata = {
  title: 'Table | RoboPoker',
  description: 'On-chain multiplayer poker table',
};

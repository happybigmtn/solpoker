'use client';

/**
 * Lobby component for the home page.
 *
 * AC-CI5.1: Displays table list fetched via getProgramAccounts.
 * AC-CI5.2: Shows blinds, player count, and join option.
 * AC-CI5.3: Provides UI to create new tables.
 */

import { useWalletConnection } from '@solana/react-hooks';
import { TableList } from '@/components/table-list';
import { CreateTableForm } from '@/components/create-table-form';
import type { Address } from '@solana/kit';

interface LobbyProps {
  /** Poker program ID */
  pokerProgramId: Address;
  /** CRISPS mint address */
  crispsMint: Address;
}

/**
 * Lobby component showing available tables and creation form.
 */
export function Lobby({ pokerProgramId, crispsMint }: LobbyProps) {
  const { wallet } = useWalletConnection();

  // Show minimal content if env vars not configured
  if (!pokerProgramId || !crispsMint) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900 dark:bg-yellow-900/20">
          <h3 className="text-sm font-semibold text-yellow-800 dark:text-yellow-300">
            Configuration Required
          </h3>
          <p className="mt-1 text-sm text-yellow-700 dark:text-yellow-400">
            Program IDs are not configured. Run <code className="font-mono">./scripts/deploy-devnet.sh</code> to set up the environment.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Hero section */}
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-balance">
          On-chain Multiplayer Poker
        </h2>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          {wallet
            ? 'Join an existing table or create a new one.'
            : 'Connect your wallet to play.'}
        </p>
      </div>

      {/* Table list and creation (only shown when wallet connected) */}
      {wallet && (
        <>
          {/* Create table form */}
          <div className="flex justify-end">
            <CreateTableForm
              pokerProgramId={pokerProgramId}
              crispsMint={crispsMint}
            />
          </div>

          {/* Table list */}
          <TableList pokerProgramId={pokerProgramId} />
        </>
      )}
    </div>
  );
}

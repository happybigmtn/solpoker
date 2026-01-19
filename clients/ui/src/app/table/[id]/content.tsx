'use client';

/**
 * Client-side table page content.
 *
 * AC-1.5: Client component for wallet/hooks.
 * AC-4.1: Subscribes to on-chain table state.
 * AC-4.4: Uses Suspense boundaries for non-critical UI.
 * AC-4.5: Dynamic imports for heavy panels.
 * AC-7.1: URL state for panel selection (deep linkable).
 */

import { Suspense, lazy, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTableSubscription } from '@/hooks/use-table-subscription';
import { PokerTable } from '@/components/poker-table';
import { PokerActions } from '@/components/poker-actions';
import { CommandPalette } from '@/components/command-palette';
import { TransactionStatus, type TransactionState } from '@/components/transaction-status';
import { ConfirmationModal } from '@/components/confirmation-modal';
import { WalletConnect } from '@/components/wallet-connect';
import { useWalletConnection } from '@solana/react-hooks';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';

// AC-4.5: Dynamic import for heavy panel (action history)
const ActionHistory = lazy(() =>
  import('@/components/action-history').then((m) => ({ default: m.ActionHistory }))
);

interface TablePageContentProps {
  tableId: string;
  activePanel?: string;
}

export function TablePageContent({ tableId, activePanel }: TablePageContentProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { wallet, connectors, connect } = useWalletConnection();
  const playerAddress = wallet?.account?.address?.toString();
  const isWalletConnected = Boolean(wallet);

  // AC-4.1: Subscribe to on-chain table state
  const { store, error, isConnected: isRpcConnected } = useTableSubscription(tableId);

  // Transaction state management
  const [txState, setTxState] = useState<TransactionState>('idle');
  const [txSignature, setTxSignature] = useState<string>();
  const [txError, setTxError] = useState<string>();

  // AC-7.1: Update URL when panel changes
  const handlePanelChange = useCallback(
    (panel: string | null) => {
      const params = new URLSearchParams(searchParams);
      if (panel) {
        params.set('panel', panel);
      } else {
        params.delete('panel');
      }
      router.replace(`/table/${tableId}?${params.toString()}`, { scroll: false });
    },
    [router, searchParams, tableId]
  );

  // Raise amount state (controlled)
  const [raiseAmount, setRaiseAmount] = useState(100);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const isPlayerTurn = true; // TODO: Derive from store state

  // AC-5.7: Confirmation modal state for destructive actions
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    action?: 'leaveTable' | 'fold';
  }>({ isOpen: false });

  // Action handlers (placeholder - will integrate with transaction builder)
  const handleAction = useCallback(
    async (action: string, amount?: number) => {
      setTxState('pending');
      setTxError(undefined);

      try {
        // TODO: Build and send transaction via @solana/kit
        // Simulate for now
        await new Promise((resolve) => setTimeout(resolve, 1500));

        setTxState('confirmed');
        setTxSignature('mock-signature-' + Date.now());
      } catch (err) {
        setTxState('failed');
        setTxError(err instanceof Error ? err.message : 'Unknown error');
      }
    },
    []
  );

  const handleDismissStatus = useCallback(() => {
    setTxState('idle');
    setTxSignature(undefined);
    setTxError(undefined);
  }, []);

  // AC-5.7: Handlers for destructive action confirmation
  const handleLeaveTableRequest = useCallback(() => {
    setConfirmModal({ isOpen: true, action: 'leaveTable' });
  }, []);

  const handleConfirmDestructiveAction = useCallback(async () => {
    const action = confirmModal.action;
    setConfirmModal({ isOpen: false });

    if (action === 'leaveTable') {
      await handleAction('leaveTable');
    } else if (action === 'fold') {
      await handleAction('fold');
    }
  }, [confirmModal.action, handleAction]);

  const handleCancelConfirmation = useCallback(() => {
    setConfirmModal({ isOpen: false });
  }, []);

  const handleCommandAction = useCallback(
    async (action: string) => {
      switch (action) {
        case 'connectWallet': {
          const connector = connectors[0];
          if (connector) {
            await connect(connector);
          }
          return;
        }
        case 'joinTable':
        case 'leaveTable':
        case 'startHand':
        case 'fold':
        case 'check':
        case 'call':
        case 'raise':
        case 'shove':
          await handleAction(action);
          return;
        default:
          return;
      }
    },
    [connect, connectors, handleAction],
  );

  useKeyboardShortcuts({
    isPlayerTurn,
    onAction: {
      openCommandPalette: () => setIsPaletteOpen(true),
      closeModal: () => setIsPaletteOpen(false),
    },
  });

  // Show error state if subscription failed
  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 dark:text-red-400">
            Failed to connect to table
          </p>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {error.message}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      {/* Wallet connect (positioned top-right via parent layout) */}
      <div className="fixed right-6 top-4 z-10">
        <WalletConnect />
      </div>

      {/* Connection status indicator */}
      {!isRpcConnected && (
        <div className="mx-auto text-sm text-amber-600 dark:text-amber-400">
          Connecting to table…
        </div>
      )}

      {/* Main table visualization */}
      <PokerTable
        store={store}
        playerAddress={playerAddress}
      />

      {/* Transaction status (AC-3.4) */}
      <div className="mx-auto w-full max-w-md">
        <TransactionStatus
          state={txState}
          signature={txSignature}
          error={txError}
          onDismiss={handleDismissStatus}
        />
      </div>

      {/* Action buttons */}
      <div className="mx-auto w-full max-w-4xl">
        <PokerActions
          isPlayerTurn={isPlayerTurn} // TODO: Derive from store.currentActor === playerSeatIndex
          isSubmitting={txState === 'pending'}
          toCall={50} // TODO: From store (amountToCall)
          minRaise={100} // TODO: From store
          maxRaise={5000} // TODO: From store
          raiseAmount={raiseAmount}
          onRaiseAmountChange={setRaiseAmount}
          onAction={handleAction}
          canCheck={false} // TODO: From store (toCall === 0)
        />
      </div>

      <CommandPalette
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
        onAction={handleCommandAction}
        isPlayerTurn={isPlayerTurn}
        isConnected={isWalletConnected}
      />

      {/* Panel toggle buttons (AC-7.1: URL state) */}
      <div className="mx-auto flex gap-2">
        <button
          type="button"
          onClick={() => handlePanelChange(activePanel === 'history' ? null : 'history')}
          className={`
            rounded-lg px-3 py-1.5 text-sm font-medium
            ${activePanel === 'history' ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300'}
            hover:opacity-80 transition-opacity
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
          `}
        >
          History
        </button>
        <button
          type="button"
          onClick={() => handlePanelChange(activePanel === 'settings' ? null : 'settings')}
          className={`
            rounded-lg px-3 py-1.5 text-sm font-medium
            ${activePanel === 'settings' ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300'}
            hover:opacity-80 transition-opacity
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
          `}
        >
          Settings
        </button>
        {/* AC-5.7: Destructive action with confirmation */}
        <button
          type="button"
          onClick={handleLeaveTableRequest}
          className="rounded-lg px-3 py-1.5 text-sm font-medium border border-red-300 text-red-700 hover:bg-red-50 active:bg-red-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
        >
          Leave Table
        </button>
      </div>

      {/* AC-5.7: Confirmation modal for destructive actions */}
      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.action === 'leaveTable' ? 'Leave Table?' : 'Confirm Action'}
        message={
          confirmModal.action === 'leaveTable'
            ? 'You will forfeit any remaining stake in the current hand. Are you sure you want to leave?'
            : 'Are you sure you want to proceed?'
        }
        confirmLabel={confirmModal.action === 'leaveTable' ? 'Leave' : 'Confirm'}
        cancelLabel="Stay"
        isDestructive
        onConfirm={handleConfirmDestructiveAction}
        onCancel={handleCancelConfirmation}
      />

      {/* AC-4.5: Lazy-loaded panels with Suspense */}
      {activePanel === 'history' && (
        <div className="mx-auto w-full max-w-md">
          <Suspense fallback={<PanelSkeleton />}>
            <ActionHistory entries={[]} />
          </Suspense>
        </div>
      )}

      {activePanel === 'settings' && (
        <div className="mx-auto w-full max-w-md">
          <Suspense fallback={<PanelSkeleton />}>
            <SettingsPanel />
          </Suspense>
        </div>
      )}
    </div>
  );
}

/**
 * Skeleton for lazy-loaded panels.
 */
function PanelSkeleton() {
  return (
    <div className="h-48 w-full animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-700" />
  );
}

/**
 * Settings panel placeholder.
 * TODO: Implement actual settings
 */
function SettingsPanel() {
  return (
    <div className="rounded-lg bg-zinc-100 p-4 dark:bg-zinc-800">
      <h3 className="font-medium">Settings</h3>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Table settings coming soon…
      </p>
    </div>
  );
}

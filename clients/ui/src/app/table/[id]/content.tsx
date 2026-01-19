'use client';

/**
 * Client-side table page content.
 *
 * AC-1.5: Client component for wallet/hooks.
 * AC-4.1: Subscribes to on-chain table state.
 * AC-4.4: Uses Suspense boundaries for non-critical UI.
 * AC-4.5: Dynamic imports for heavy panels.
 * AC-7.1: URL state for panel selection (deep linkable).
 * AC-CI2.1–AC-CI2.4: Transaction building and sending.
 * AC-CI3.1–AC-CI3.5: Player action wiring.
 * AC-CI3.6–AC-CI3.7: Join/leave table wiring.
 */

import { Suspense, lazy, useState, useCallback, useMemo, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { type Address } from '@solana/kit';
import { useTableSubscription, useCurrentActor, useCurrentBet, useMinRaise } from '@/hooks/use-table-subscription';
import { PokerTable } from '@/components/poker-table';
import { PokerActions } from '@/components/poker-actions';
import { CommandPalette } from '@/components/command-palette';
import { TransactionStatus } from '@/components/transaction-status';
import { ConfirmationModal } from '@/components/confirmation-modal';
import { WalletConnect } from '@/components/wallet-connect';
import { useWalletConnection } from '@solana/react-hooks';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { useTableAction } from '@/hooks/use-table-action';
import { usePlayerAction, type PlayerActionType } from '@/hooks/use-player-action';
import {
  deriveAssociatedTokenAccount,
  derivePokerConfigPda,
  deriveTablePda,
  deriveVaultPda,
} from '@robopoker/client';

// AC-4.5: Dynamic import for heavy panel (action history)
const ActionHistory = lazy(() =>
  import('@/components/action-history').then((m) => ({ default: m.ActionHistory }))
);

interface TablePageContentProps {
  tableId: string;
  activePanel?: string;
}

// Get program IDs and addresses from environment
const POKER_PROGRAM_ID = process.env.NEXT_PUBLIC_POKER_PROGRAM_ID as Address;
const CRISPS_MINT = process.env.NEXT_PUBLIC_CRISPS_MINT as Address;

// Default buy-in amount (10 CRISPS with 9 decimals)
const DEFAULT_BUY_IN_AMOUNT = 10_000_000_000n;

export function TablePageContent({ tableId, activePanel }: TablePageContentProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { wallet, connectors, connect } = useWalletConnection();
  const playerAddress = wallet?.account?.address?.toString();
  const isWalletConnected = Boolean(wallet);

  // AC-4.1: Subscribe to on-chain table state
  const { store, error, isConnected: isRpcConnected } = useTableSubscription(tableId);

  // Get table state for action computation
  const currentActor = useCurrentActor(store);
  const currentBet = useCurrentBet(store);
  const minRaise = useMinRaise(store);

  // Async PDA derivation (simplified - in production, use a proper loading state)
  const [derivedAddresses, setDerivedAddresses] = useState<{
    tableAddress: Address | null;
    configAddress: Address | null;
    vaultAddress: Address | null;
    playerTokenAccount: Address | null;
  }>({
    tableAddress: null,
    configAddress: null,
    vaultAddress: null,
    playerTokenAccount: null,
  });

  // Derive PDAs on mount/tableId change
  useEffect(() => {
    if (!POKER_PROGRAM_ID || !CRISPS_MINT) return;

    const derivePdas = async () => {
      try {
        const tableIdBigInt = BigInt(tableId);
        const [tablePda] = await deriveTablePda(POKER_PROGRAM_ID, tableIdBigInt);
        const [vaultPda] = await deriveVaultPda(POKER_PROGRAM_ID, tableIdBigInt);
        const [configPda] = await derivePokerConfigPda(POKER_PROGRAM_ID);

        let playerTokenAccount: Address | null = null;
        if (playerAddress) {
          const [ata] = await deriveAssociatedTokenAccount(
            playerAddress as Address,
            CRISPS_MINT
          );
          playerTokenAccount = ata;
        }

        setDerivedAddresses({
          tableAddress: tablePda,
          configAddress: configPda,
          vaultAddress: vaultPda,
          playerTokenAccount,
        });
      } catch (err) {
        console.error('Failed to derive PDAs:', err);
      }
    };

    derivePdas();
  }, [tableId, playerAddress, POKER_PROGRAM_ID, CRISPS_MINT]);

  // AC-CI2.1–AC-CI3.5: Use real transaction hook for player actions
  const {
    executeAction,
    txState: playerTxState,
    txSignature: playerTxSignature,
    txError: playerTxError,
    resetTxState: resetPlayerTxState,
    isPending: isPlayerActionPending,
  } = usePlayerAction({
    tableAddress: derivedAddresses.tableAddress ?? ('' as Address),
    pokerProgramId: POKER_PROGRAM_ID ?? ('' as Address),
    configAddress: derivedAddresses.configAddress ?? ('' as Address),
  });

  const {
    joinTable,
    leaveTable,
    txState: tableTxState,
    txSignature: tableTxSignature,
    txError: tableTxError,
    resetTxState: resetTableTxState,
    isPending: isTableActionPending,
  } = useTableAction({
    tableAddress: derivedAddresses.tableAddress ?? ('' as Address),
    vaultAddress: derivedAddresses.vaultAddress ?? ('' as Address),
    pokerProgramId: POKER_PROGRAM_ID ?? ('' as Address),
    configAddress: derivedAddresses.configAddress ?? ('' as Address),
    playerTokenAccount: derivedAddresses.playerTokenAccount ?? ('' as Address),
  });

  const hasTableTx = tableTxState !== 'idle';
  const txState = hasTableTx ? tableTxState : playerTxState;
  const txSignature = hasTableTx ? tableTxSignature : playerTxSignature;
  const txError = hasTableTx ? tableTxError : playerTxError;
  const isPending = isPlayerActionPending || isTableActionPending;

  const resetTxState = useCallback(() => {
    resetPlayerTxState();
    resetTableTxState();
  }, [resetPlayerTxState, resetTableTxState]);

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

  // Determine if it's the player's turn based on store state
  const playerSeatIndex = useMemo(() => {
    if (!playerAddress || !store) return -1;
    // Find the seat index for this player
    const seats = store.getState().seats;
    return seats.findIndex((seat) => seat.player === playerAddress);
  }, [playerAddress, store]);

  const isPlayerTurn = currentActor === playerSeatIndex && playerSeatIndex >= 0;

  // Compute toCall based on current bet and player's current bet
  const playerCurrentBet = useMemo(() => {
    if (playerSeatIndex < 0 || !store) return 0n;
    return store.getState().seats[playerSeatIndex]?.currentBet ?? 0n;
  }, [playerSeatIndex, store]);

  const toCallValue = currentBet > playerCurrentBet ? currentBet - playerCurrentBet : 0n;
  const toCall = Number(toCallValue);
  const canCheck = toCallValue === 0n;

  // Player's stack for maxRaise
  const playerStack = useMemo(() => {
    if (playerSeatIndex < 0 || !store) return 0n;
    return store.getState().seats[playerSeatIndex]?.stack ?? 0n;
  }, [playerSeatIndex, store]);

  const minRaiseAmount = Number(minRaise);
  const maxRaise = Number(playerStack);

  // AC-5.7: Confirmation modal state for destructive actions
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    action?: 'leaveTable' | 'fold';
  }>({ isOpen: false });

  // AC-CI3.1–AC-CI3.5: Handle player actions via real transactions
  const handleAction = useCallback(
    async (action: string, amount?: number) => {
      if (action === 'joinTable') {
        const buyInAmount = amount !== undefined ? BigInt(amount) : DEFAULT_BUY_IN_AMOUNT;
        await joinTable(buyInAmount);
        return;
      }
      if (action === 'leaveTable') {
        await leaveTable();
        return;
      }
      if (action === 'startHand') {
        console.warn(`Action ${action} not wired yet.`);
        return;
      }

      // Map string actions to PlayerActionType for player actions
      const validActions: PlayerActionType[] = ['fold', 'check', 'call', 'raise', 'shove'];
      if (!validActions.includes(action as PlayerActionType)) {
        console.warn(`Unknown action type: ${action}`);
        return;
      }

      const actionType = action as PlayerActionType;
      const actionAmount = amount !== undefined ? BigInt(amount) : undefined;

      await executeAction(actionType, actionAmount);
    },
    [executeAction, joinTable, leaveTable]
  );

  const handleDismissStatus = useCallback(() => {
    resetTxState();
  }, [resetTxState]);

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
            await connect(connector.id);
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
          isPlayerTurn={isPlayerTurn}
          isSubmitting={isPending}
          toCall={toCall}
          minRaise={minRaiseAmount}
          maxRaise={maxRaise}
          raiseAmount={raiseAmount}
          onRaiseAmountChange={setRaiseAmount}
          onAction={handleAction}
          canCheck={canCheck}
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

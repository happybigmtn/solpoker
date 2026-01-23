'use client';

/**
 * Hook for building and sending player action transactions.
 *
 * AC-CI2.1: Builds player action transactions using SDK instruction builders (not mocked).
 * AC-CI2.3: Transactions are signed via connected wallet and sent to RPC.
 * AC-CI2.4: Transaction confirmation is awaited and status is surfaced to user.
 * AC-CI3.1–AC-CI3.5: Fold/check/call/raise/shove send correct instruction discriminator.
 * AC-PQ.CI1: Transaction submission feels immediate; no visible delay before pending state.
 */

import { useCallback, useState, useRef } from 'react';
import { useWalletConnection } from '@solana/react-hooks';
import { createWalletTransactionSigner } from '@solana/client';
import {
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
  getSignatureFromTransaction,
  assertIsSendableTransaction,
  compileTransaction,
  getBase64EncodedWireTransaction,
  addSignersToInstruction,
  AccountRole,
  type Address,
  type Instruction,
} from '@solana/kit';
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from '@solana-program/compute-budget';
import { useRpc, useRpcSubscriptions } from './use-rpc';
import {
  buildPlayerActionData,
  getPlayerActionAccountMetas,
  ACTION_TYPE,
  formatTransactionError,
  isNetworkError,
  isUserRejection,
} from '@robopoker/client';
import type { TransactionState } from '@/components/transaction-status';
import { getPlayerActionLabel } from '@/lib/transaction-labels';
import { logUiEvent } from '@/lib/logging';

/**
 * Player action types matching PokerActions component.
 */
export type PlayerActionType = 'fold' | 'check' | 'call' | 'raise' | 'shove';

/**
 * Configuration for the usePlayerAction hook.
 */
export interface UsePlayerActionConfig {
  /** Table address (base58 string) */
  tableAddress: Address;
  /** Poker program ID */
  pokerProgramId: Address;
  /** Config PDA address */
  configAddress: Address;
  /** Clock sysvar address (optional, defaults to standard sysvar) */
  clockAddress?: Address;
  /** Table ID (optional, for logging) */
  tableId?: string | bigint;
}

/**
 * Result from executing a player action.
 */
export interface PlayerActionResult {
  /** Transaction state */
  state: TransactionState;
  /** Transaction signature (if confirmed) */
  signature?: string;
  /** Error message (if failed) */
  error?: string;
  /** Whether the error is retryable (network error) */
  isRetryable?: boolean;
  /** Human-readable label for the action */
  label?: string;
}

/**
 * Return type for the usePlayerAction hook.
 */
export interface UsePlayerActionReturn {
  /** Execute a player action */
  executeAction: (action: PlayerActionType, amount?: bigint) => Promise<PlayerActionResult>;
  /** Retry the last action if available */
  retry: () => Promise<PlayerActionResult>;
  /** Current transaction state */
  txState: TransactionState;
  /** Current transaction signature */
  txSignature?: string;
  /** Current error message */
  txError?: string;
  /** Current transaction label */
  txLabel?: string;
  /** Whether the current error is retryable */
  isRetryable: boolean;
  /** Reset transaction state */
  resetTxState: () => void;
  /** Whether a transaction is currently pending */
  isPending: boolean;
}

/** Clock sysvar address (standard Solana sysvar) */
const CLOCK_SYSVAR: Address = 'SysvarC1ock11111111111111111111111111111111' as Address;

/**
 * Map action type string to discriminator value.
 * AC-CI3.1–AC-CI3.5: Correct discriminator for each action type.
 */
function getActionDiscriminator(action: PlayerActionType): number {
  switch (action) {
    case 'fold':
      return ACTION_TYPE.FOLD;
    case 'check':
      return ACTION_TYPE.CHECK;
    case 'call':
      return ACTION_TYPE.CALL;
    case 'raise':
      return ACTION_TYPE.RAISE;
    case 'shove':
      return ACTION_TYPE.ALL_IN;
    default:
      throw new Error(`Unknown action type: ${action}`);
  }
}

/**
 * Map SDK string role to @solana/kit AccountRole enum.
 * The SDK uses string roles like 'readonly', 'writable', 'signer', 'writable_signer'.
 */
function mapStringRoleToAccountRole(role: string): AccountRole {
  switch (role) {
    case 'readonly':
      return AccountRole.READONLY;
    case 'writable':
      return AccountRole.WRITABLE;
    case 'signer':
    case 'readonly_signer':
      return AccountRole.READONLY_SIGNER;
    case 'writable_signer':
      return AccountRole.WRITABLE_SIGNER;
    default:
      return AccountRole.READONLY;
  }
}

/**
 * Extract transaction logs from an error object if available.
 */
function extractLogs(error: unknown): string[] | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const err = error as {
    logs?: string[];
    data?: { logs?: string[] };
    cause?: { data?: { logs?: string[] } };
    context?: { logs?: string[]; cause?: { data?: { logs?: string[] } } };
  };
  return (
    err.logs ??
    err.data?.logs ??
    err.cause?.data?.logs ??
    err.context?.logs ??
    err.context?.cause?.data?.logs
  );
}

/**
 * Hook for building and sending player action transactions.
 *
 * @param config - Configuration including table address and program IDs
 * @returns Functions and state for executing player actions
 */
export function usePlayerAction(config: UsePlayerActionConfig): UsePlayerActionReturn {
  const { tableAddress, pokerProgramId, configAddress, clockAddress = CLOCK_SYSVAR, tableId } = config;
  const { wallet } = useWalletConnection();

  // Use shared RPC clients (single connection for the app)
  const rpc = useRpc();
  const rpcSubscriptions = useRpcSubscriptions();

  const [txState, setTxState] = useState<TransactionState>('idle');
  const [txSignature, setTxSignature] = useState<string>();
  const [txError, setTxError] = useState<string>();
  const [isRetryable, setIsRetryable] = useState(false);
  const [txLabel, setTxLabel] = useState<string>();
  const lastActionRef = useRef<{ action: PlayerActionType; amount?: bigint } | null>(null);

  const resetTxState = useCallback(() => {
    setTxState('idle');
    setTxSignature(undefined);
    setTxError(undefined);
    setIsRetryable(false);
    setTxLabel(undefined);
    lastActionRef.current = null;
  }, []);

  const executeAction = useCallback(
    async (action: PlayerActionType, amount?: bigint): Promise<PlayerActionResult> => {
      // Validate all required addresses are properly derived
      const isTableAddressValid = tableAddress && tableAddress.length > 10;
      const isConfigAddressValid = configAddress && configAddress.length > 10;
      const isProgramIdValid = pokerProgramId && pokerProgramId.length > 10;

      if (!isTableAddressValid || !isConfigAddressValid || !isProgramIdValid) {
        const missingParts: string[] = [];
        if (!isTableAddressValid) missingParts.push('table');
        if (!isConfigAddressValid) missingParts.push('config');
        if (!isProgramIdValid) missingParts.push('program ID');
        const error = `Waiting for ${missingParts.join(', ')} to load. Please try again in a moment.`;
        setTxState('failed');
        setTxError(error);
        setIsRetryable(true);
        setTxLabel(undefined);
        return { state: 'failed', error, isRetryable: true };
      }

      // Check wallet connection
      if (!wallet) {
        const error = 'Wallet not connected. Please connect your wallet to continue.';
        setTxState('failed');
        setTxError(error);
        setIsRetryable(false);
        setTxLabel(undefined);
        return { state: 'failed', error, isRetryable: false };
      }

      lastActionRef.current = { action, amount };
      const label = getPlayerActionLabel(action, amount);
      setTxLabel(label);

      // AC-PQ.CI1: Set pending state immediately
      setTxState('pending');
      setTxError(undefined);
      setIsRetryable(false);

      try {
        const playerAddress = wallet.account.address;

        // Create wallet transaction signer
        const { signer: walletSigner } = createWalletTransactionSigner(wallet);

        // Start blockhash fetch early - no dependencies (React Best Practice: async-api-routes)
        const blockhashPromise = rpc.getLatestBlockhash().send();

        // Build compute budget instructions for priority fees
        const computeBudgetIx = getSetComputeUnitLimitInstruction({ units: 200_000 });
        const priorityFeeIx = getSetComputeUnitPriceInstruction({ microLamports: 1000n });

        // Build instruction data
        // AC-CI3.1–AC-CI3.5: Correct instruction discriminator for each action
        const actionType = getActionDiscriminator(action);
        const actionAmount = amount ?? 0n;
        const instructionData = buildPlayerActionData({
          actionType,
          amount: actionAmount,
        });

        // Build account metas from SDK
        const sdkAccountMetas = getPlayerActionAccountMetas({
          table: tableAddress,
          player: playerAddress,
          config: configAddress,
          clock: clockAddress,
        });

        // Convert SDK account metas to @solana/kit instruction format
        const baseInstruction: Instruction = {
          programAddress: pokerProgramId,
          accounts: sdkAccountMetas.map((meta) => ({
            address: meta.address as Address,
            role: mapStringRoleToAccountRole(meta.role),
          })),
          data: instructionData,
        };

        // Attach signer to the instruction for the player account
        const instruction = addSignersToInstruction([walletSigner], baseInstruction);

        // Await the blockhash promise started earlier (React Best Practice: async-api-routes)
        const { value: latestBlockhash } = await blockhashPromise;

        // Build transaction message with compute budget + action instruction
        const transactionMessage = pipe(
          createTransactionMessage({ version: 0 }),
          (tx) => setTransactionMessageFeePayerSigner(walletSigner, tx),
          (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
          (tx) => appendTransactionMessageInstructions([computeBudgetIx, priorityFeeIx, instruction], tx)
        );

        // Simulate transaction before signing to catch errors early
        const compiledTx = compileTransaction(transactionMessage);
        const simulationResult = await rpc.simulateTransaction(
          getBase64EncodedWireTransaction(compiledTx),
          { commitment: 'confirmed', encoding: 'base64' }
        ).send();

        if (simulationResult.value.err) {
          const logs = simulationResult.value.logs ?? undefined;
          throw new Error(formatTransactionError(
            new Error(`Simulation failed: ${JSON.stringify(simulationResult.value.err)}`),
            logs,
            pokerProgramId
          ));
        }

        // AC-CI2.3: Sign transaction via connected wallet
        const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
        assertIsSendableTransaction(signedTransaction);

        // Get signature (available after signing)
        const signature = getSignatureFromTransaction(signedTransaction);

        // AC-CI2.3: Send to RPC, AC-CI2.4: Await confirmation
        const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
        await sendAndConfirmTransaction(
          signedTransaction as Parameters<typeof sendAndConfirmTransaction>[0],
          { commitment: 'confirmed' }
        );

        logUiEvent('info', 'player_action', 'Player action confirmed', {
          requestId: signature,
          tableId,
          data: { action, label },
        });

        // Success
        setTxState('confirmed');
        setTxSignature(signature);
        return { state: 'confirmed', signature, label };
      } catch (err) {
        const logs = extractLogs(err);
        const userFriendlyError = formatTransactionError(
          err instanceof Error ? err : String(err),
          logs,
          pokerProgramId
        );
        const retryable = isNetworkError(err instanceof Error ? err : String(err));
        const userRejected = isUserRejection(err instanceof Error ? err : String(err));
        const shouldRetry = retryable && !userRejected;

        setTxState('failed');
        setTxError(userFriendlyError);
        setIsRetryable(shouldRetry);

        return { state: 'failed', error: userFriendlyError, isRetryable: shouldRetry, label };
      }
    },
    [wallet, rpc, rpcSubscriptions, tableAddress, pokerProgramId, configAddress, clockAddress, tableId]
  );

  const retry = useCallback(async (): Promise<PlayerActionResult> => {
    if (!lastActionRef.current) {
      const error = 'No previous action to retry.';
      setTxState('failed');
      setTxError(error);
      setIsRetryable(false);
      return { state: 'failed', error, isRetryable: false };
    }

    return executeAction(lastActionRef.current.action, lastActionRef.current.amount);
  }, [executeAction]);

  return {
    executeAction,
    retry,
    txState,
    txSignature,
    txError,
    txLabel,
    isRetryable,
    resetTxState,
    isPending: txState === 'pending',
  };
}

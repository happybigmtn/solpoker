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

import { useCallback, useState, useMemo, useRef } from 'react';
import { useWalletConnection } from '@solana/react-hooks';
import { createWalletTransactionSigner } from '@solana/client';
import {
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
  getSignatureFromTransaction,
  assertIsSendableTransaction,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  addSignersToInstruction,
  AccountRole,
  type Address,
  type Instruction,
} from '@solana/kit';
import {
  buildPlayerActionData,
  getPlayerActionAccountMetas,
  ACTION_TYPE,
  formatTransactionError,
  isNetworkError,
  isUserRejection,
} from '@robopoker/client';
import type { TransactionState } from '@/components/transaction-status';

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
  const { tableAddress, pokerProgramId, configAddress, clockAddress = CLOCK_SYSVAR } = config;
  const { wallet } = useWalletConnection();

  const [txState, setTxState] = useState<TransactionState>('idle');
  const [txSignature, setTxSignature] = useState<string>();
  const [txError, setTxError] = useState<string>();
  const [isRetryable, setIsRetryable] = useState(false);
  const lastActionRef = useRef<{ action: PlayerActionType; amount?: bigint } | null>(null);

  // Create RPC clients (memoized)
  const { rpc, rpcSubscriptions } = useMemo(() => {
    const httpUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
    const wsUrl =
      process.env.NEXT_PUBLIC_SOLANA_WS_URL ||
      httpUrl.replace('https', 'wss').replace('http', 'ws');

    return {
      rpc: createSolanaRpc(httpUrl),
      rpcSubscriptions: createSolanaRpcSubscriptions(wsUrl),
    };
  }, []);

  const resetTxState = useCallback(() => {
    setTxState('idle');
    setTxSignature(undefined);
    setTxError(undefined);
    setIsRetryable(false);
    lastActionRef.current = null;
  }, []);

  const executeAction = useCallback(
    async (action: PlayerActionType, amount?: bigint): Promise<PlayerActionResult> => {
      // Check wallet connection
      if (!wallet) {
        const error = 'Wallet not connected. Please connect your wallet to continue.';
        setTxState('failed');
        setTxError(error);
        setIsRetryable(false);
        return { state: 'failed', error, isRetryable: false };
      }

      lastActionRef.current = { action, amount };

      // AC-PQ.CI1: Set pending state immediately
      setTxState('pending');
      setTxError(undefined);
      setIsRetryable(false);

      try {
        const playerAddress = wallet.account.address;

        // Create wallet transaction signer
        // This wraps the wallet session into a TransactionSigner for @solana/kit
        const { signer: walletSigner, mode } = createWalletTransactionSigner(wallet);

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
        // Map string roles to AccountRole enum values
        const baseInstruction: Instruction = {
          programAddress: pokerProgramId,
          accounts: sdkAccountMetas.map((meta) => ({
            address: meta.address as Address,
            role: mapStringRoleToAccountRole(meta.role),
          })),
          data: instructionData,
        };

        // Attach signer to the instruction for the player account
        // This associates the wallet signer with the player's signer account
        const instruction = addSignersToInstruction([walletSigner], baseInstruction);

        // Get latest blockhash for transaction lifetime
        const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

        // Build transaction message
        // AC-CI2.1: Builds transaction using SDK instruction builders (not mocked)
        const transactionMessage = pipe(
          createTransactionMessage({ version: 0 }),
          (tx) => setTransactionMessageFeePayerSigner(walletSigner, tx),
          (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
          (tx) => appendTransactionMessageInstruction(instruction, tx)
        );

        // AC-CI2.3: Sign transaction via connected wallet
        const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
        assertIsSendableTransaction(signedTransaction);

        // Get signature (available after signing)
        const signature = getSignatureFromTransaction(signedTransaction);

        // AC-CI2.3: Send to RPC
        // AC-CI2.4: Await confirmation
        if (mode === 'send') {
          // Wallet only supports sendTransaction (already sent during signing)
          // Just wait for confirmation via signature status
          // The sendAndConfirm factory should handle this
        }

        const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
        // The signed transaction has blockhash lifetime from setTransactionMessageLifetimeUsingBlockhash.
        // The type assertion is needed because the generic type inference loses the lifetime info.
        await sendAndConfirmTransaction(
          signedTransaction as Parameters<typeof sendAndConfirmTransaction>[0],
          { commitment: 'confirmed' }
        );

        // Success
        setTxState('confirmed');
        setTxSignature(signature);
        return { state: 'confirmed', signature };
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

        return { state: 'failed', error: userFriendlyError, isRetryable: shouldRetry };
      }
    },
    [wallet, rpc, rpcSubscriptions, tableAddress, pokerProgramId, configAddress, clockAddress]
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
    isRetryable,
    resetTxState,
    isPending: txState === 'pending',
  };
}

'use client';

/**
 * Hook for building and sending createTable transactions.
 *
 * AC-CI5.3: UI can create a new table with specified blinds.
 * AC-CI5.4: Created table redirects to the table view.
 */

import { useCallback, useState } from 'react';
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
  buildCreateTableData,
  getCreateTableAccountMetas,
  deriveTablePda,
  deriveVaultPda,
  derivePokerConfigPda,
  TOKEN_2022_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  formatTransactionError,
  isNetworkError,
  isUserRejection,
} from '@robopoker/client';
import type { TransactionState } from '@/components/transaction-status';
import { logUiEvent } from '@/lib/logging';

/**
 * Arguments for creating a table.
 */
export interface CreateTableArgs {
  /** Unique table ID */
  tableId: bigint;
  /** Small blind amount (in token units) */
  smallBlind: bigint;
  /** Big blind amount (in token units) */
  bigBlind: bigint;
}

/**
 * Configuration for the useCreateTable hook.
 */
export interface UseCreateTableConfig {
  /** Poker program ID */
  pokerProgramId: Address;
  /** CRISPS mint address */
  crispsMint: Address;
}

/**
 * Result from executing a create table action.
 */
export interface CreateTableResult {
  /** Transaction state */
  state: TransactionState;
  /** Transaction signature (if confirmed) */
  signature?: string;
  /** Created table address (if confirmed) */
  tableAddress?: Address;
  /** Error message (if failed) */
  error?: string;
  /** Whether the error is retryable (network error) */
  isRetryable?: boolean;
}

/**
 * Return type for the useCreateTable hook.
 */
export interface UseCreateTableReturn {
  /** Create a new table with specified blinds */
  createTable: (args: CreateTableArgs) => Promise<CreateTableResult>;
  /** Current transaction state */
  txState: TransactionState;
  /** Current transaction signature */
  txSignature?: string;
  /** Created table address */
  tableAddress?: Address;
  /** Current error message */
  txError?: string;
  /** Reset transaction state */
  resetTxState: () => void;
  /** Whether a transaction is currently pending */
  isPending: boolean;
  /** Whether the current error is retryable */
  isRetryable: boolean;
}

/**
 * Map SDK string role to @solana/kit AccountRole enum.
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
 * Hook for creating new poker tables.
 *
 * @param config - Configuration including program ID and mint address
 * @returns Functions and state for creating tables
 */
export function useCreateTable(config: UseCreateTableConfig): UseCreateTableReturn {
  const { pokerProgramId, crispsMint } = config;
  const { wallet } = useWalletConnection();

  // Use shared RPC clients (single connection for the app)
  const rpc = useRpc();
  const rpcSubscriptions = useRpcSubscriptions();

  const [txState, setTxState] = useState<TransactionState>('idle');
  const [txSignature, setTxSignature] = useState<string>();
  const [tableAddress, setTableAddress] = useState<Address>();
  const [txError, setTxError] = useState<string>();
  const [isRetryable, setIsRetryable] = useState(false);

  const resetTxState = useCallback(() => {
    setTxState('idle');
    setTxSignature(undefined);
    setTableAddress(undefined);
    setTxError(undefined);
    setIsRetryable(false);
  }, []);

  /**
   * Create a new table with the specified blinds.
   * AC-CI5.3: UI can create a new table with specified blinds.
   */
  const createTable = useCallback(
    async (args: CreateTableArgs): Promise<CreateTableResult> => {
      const { tableId, smallBlind, bigBlind } = args;

      // Check wallet connection
      if (!wallet) {
        const error = 'Wallet not connected. Please connect your wallet to continue.';
        setTxState('failed');
        setTxError(error);
        setIsRetryable(false);
        return { state: 'failed', error, isRetryable: false };
      }

      // Set pending state immediately (AC-PQ.CI1)
      setTxState('pending');
      setTxError(undefined);
      setIsRetryable(false);

      try {
        const payerAddress = wallet.account.address;

        // Derive PDAs
        const [derivedTableAddress] = await deriveTablePda(pokerProgramId, tableId);
        const [vaultAddress] = await deriveVaultPda(pokerProgramId, tableId);
        const [configAddress] = await derivePokerConfigPda(pokerProgramId);

        // Create wallet transaction signer
        const { signer: walletSigner } = createWalletTransactionSigner(wallet);

        // Build compute budget instructions for priority fees
        const computeBudgetIx = getSetComputeUnitLimitInstruction({ units: 300_000 });
        const priorityFeeIx = getSetComputeUnitPriceInstruction({ microLamports: 1000n });

        // Build create table instruction data
        const instructionData = buildCreateTableData({ tableId, smallBlind, bigBlind });

        // Build account metas from SDK
        const sdkAccountMetas = getCreateTableAccountMetas({
          table: derivedTableAddress,
          vault: vaultAddress,
          payer: payerAddress,
          config: configAddress,
          crispsMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID as Address,
          systemProgram: SYSTEM_PROGRAM_ID as Address,
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

        // Attach signer to the instruction for the payer account
        const instruction = addSignersToInstruction([walletSigner], baseInstruction);

        // Get latest blockhash for transaction lifetime
        const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

        // Build transaction with compute budget + create table instruction
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

        // Sign transaction via connected wallet
        const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
        assertIsSendableTransaction(signedTransaction);

        // Get signature
        const signature = getSignatureFromTransaction(signedTransaction);

        // Send and confirm
        const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
        await sendAndConfirmTransaction(
          signedTransaction as Parameters<typeof sendAndConfirmTransaction>[0],
          { commitment: 'confirmed' }
        );

        logUiEvent('info', 'create_table', 'Table created', {
          requestId: signature,
          tableId,
          data: {
            table_address: derivedTableAddress,
          },
        });

        // Success
        setTxState('confirmed');
        setTxSignature(signature);
        setTableAddress(derivedTableAddress);

        return { state: 'confirmed', signature, tableAddress: derivedTableAddress };
      } catch (err) {
        // Decode program errors to user-readable messages
        const userFriendlyError = formatTransactionError(
          err instanceof Error ? err : String(err),
          undefined,
          pokerProgramId
        );

        // Determine if error is retryable
        const retryable = isNetworkError(err instanceof Error ? err : String(err));
        const userRejected = isUserRejection(err instanceof Error ? err : String(err));
        const shouldRetry = retryable && !userRejected;

        setTxState('failed');
        setTxError(userFriendlyError);
        setIsRetryable(shouldRetry);

        return { state: 'failed', error: userFriendlyError, isRetryable: shouldRetry };
      }
    },
    [wallet, rpc, rpcSubscriptions, pokerProgramId, crispsMint]
  );

  return {
    createTable,
    txState,
    txSignature,
    tableAddress,
    txError,
    resetTxState,
    isPending: txState === 'pending',
    isRetryable,
  };
}

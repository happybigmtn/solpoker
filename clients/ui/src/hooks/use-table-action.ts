'use client';

/**
 * Hook for building and sending join/leave table transactions.
 *
 * AC-CI2.2: UI builds join/leave table transactions using SDK instruction builders.
 * AC-CI2.3: Transactions are signed via connected wallet and sent to RPC.
 * AC-CI2.4: Transaction confirmation is awaited and status is surfaced to user.
 * AC-CI3.6: Join table action sends a `join_table` transaction with buy-in amount.
 * AC-CI3.7: Leave table action sends a `leave_table` transaction.
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
  buildJoinTableData,
  getJoinTableAccountMetas,
  buildLeaveTableData,
  getLeaveTableAccountMetas,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getCreateAtaIdempotentAccountMetas,
  buildCreateAtaIdempotentData,
  formatTransactionError,
  isNetworkError,
  isUserRejection,
} from '@robopoker/client';
import type { TransactionState } from '@/components/transaction-status';
import { getTableActionLabel } from '@/lib/transaction-labels';
import { logUiEvent } from '@/lib/logging';

/**
 * Configuration for the useTableAction hook.
 */
export interface UseTableActionConfig {
  /** Table address (base58 string) */
  tableAddress: Address;
  /** Vault address (base58 string) */
  vaultAddress: Address;
  /** Poker program ID */
  pokerProgramId: Address;
  /** Config PDA address */
  configAddress: Address;
  /** Player's CRISPS token account address */
  playerTokenAccount: Address;
  /** CRISPS mint address */
  crispsMint: Address;
  /** Table ID (optional, for logging) */
  tableId?: string | bigint;
}

/**
 * Result from executing a table action.
 */
export interface TableActionResult {
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
 * Return type for the useTableAction hook.
 */
export interface UseTableActionReturn {
  /** Join the table with specified buy-in amount */
  joinTable: (buyInAmount: bigint) => Promise<TableActionResult>;
  /** Leave the table */
  leaveTable: () => Promise<TableActionResult>;
  /** Retry the last action if available */
  retry: () => Promise<TableActionResult>;
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
 * Hook for building and sending join/leave table transactions.
 *
 * @param config - Configuration including table address, vault, and program IDs
 * @returns Functions and state for joining/leaving tables
 */
export function useTableAction(config: UseTableActionConfig): UseTableActionReturn {
  const {
    tableAddress,
    vaultAddress,
    pokerProgramId,
    configAddress,
    playerTokenAccount,
    crispsMint,
    tableId,
  } = config;
  const { wallet } = useWalletConnection();

  // Use shared RPC clients (single connection for the app)
  const rpc = useRpc();
  const rpcSubscriptions = useRpcSubscriptions();

  const [txState, setTxState] = useState<TransactionState>('idle');
  const [txSignature, setTxSignature] = useState<string>();
  const [txError, setTxError] = useState<string>();
  const [isRetryable, setIsRetryable] = useState(false);
  const [txLabel, setTxLabel] = useState<string>();
  const lastActionRef = useRef<
    | { type: 'join'; buyInAmount: bigint }
    | { type: 'leave' }
    | null
  >(null);

  const resetTxState = useCallback(() => {
    setTxState('idle');
    setTxSignature(undefined);
    setTxError(undefined);
    setIsRetryable(false);
    setTxLabel(undefined);
    lastActionRef.current = null;
  }, []);

  /**
   * Join the table with the specified buy-in amount.
   * AC-CI3.6: Join table action sends a `join_table` transaction with buy-in amount.
   */
  const joinTable = useCallback(
    async (buyInAmount: bigint): Promise<TableActionResult> => {
      // Validate all required addresses are properly derived (not empty strings or null)
      const isTableAddressValid = tableAddress && tableAddress.length > 10;
      const isVaultAddressValid = vaultAddress && vaultAddress.length > 10;
      const isConfigAddressValid = configAddress && configAddress.length > 10;
      const isPlayerTokenAccountValid = playerTokenAccount && playerTokenAccount.length > 10;
      const isProgramIdValid = pokerProgramId && pokerProgramId.length > 10;
      const isMintValid = crispsMint && crispsMint.length > 10;

      if (!isTableAddressValid || !isVaultAddressValid || !isConfigAddressValid || !isPlayerTokenAccountValid || !isProgramIdValid || !isMintValid) {
        const missingParts: string[] = [];
        if (!isTableAddressValid) missingParts.push('table');
        if (!isVaultAddressValid) missingParts.push('vault');
        if (!isConfigAddressValid) missingParts.push('config');
        if (!isPlayerTokenAccountValid) missingParts.push('token account');
        if (!isProgramIdValid) missingParts.push('program ID');
        if (!isMintValid) missingParts.push('mint');
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

      lastActionRef.current = { type: 'join', buyInAmount };
      const label = getTableActionLabel('join', buyInAmount);
      setTxLabel(label);

      // Set pending state immediately
      setTxState('pending');
      setTxError(undefined);
      setIsRetryable(false);

      try {
        const playerAddress = wallet.account.address;

        // Create wallet transaction signer
        const { signer: walletSigner } = createWalletTransactionSigner(wallet);

        // Build compute budget instructions for priority fees
        const computeBudgetIx = getSetComputeUnitLimitInstruction({ units: 300_000 });
        const priorityFeeIx = getSetComputeUnitPriceInstruction({ microLamports: 1000n });

        // Start independent RPC calls in parallel (React Best Practice: async-parallel)
        // ATA check and blockhash fetch have no dependencies - run concurrently
        const ataCheckPromise = rpc.getAccountInfo(playerTokenAccount, { encoding: 'base64' }).send()
          .then(ataInfo => ({
            exists: ataInfo.value !== null && ataInfo.value.data.length > 0,
          }))
          .catch(() => ({ exists: false }));

        const blockhashPromise = rpc.getLatestBlockhash().send();

        // Await ATA check result
        const ataResult = await ataCheckPromise;
        const ataExists = ataResult.exists;

        // Build instructions array - start with compute budget
        const instructions: Instruction[] = [computeBudgetIx, priorityFeeIx];

        if (!ataExists) {
          // Build create ATA idempotent instruction (creates if doesn't exist, succeeds if exists)
          const createAtaAccountMetas = getCreateAtaIdempotentAccountMetas({
            payer: playerAddress,
            ata: playerTokenAccount,
            wallet: playerAddress,
            mint: crispsMint,
            tokenProgramId: TOKEN_2022_PROGRAM_ID as Address,
          });

          const createAtaBaseInstruction: Instruction = {
            programAddress: ASSOCIATED_TOKEN_PROGRAM_ID as Address,
            accounts: createAtaAccountMetas.map((meta) => ({
              address: meta.address as Address,
              role: mapStringRoleToAccountRole(meta.role),
            })),
            data: buildCreateAtaIdempotentData(),
          };

          // Attach signer to the create ATA instruction
          const createAtaInstruction = addSignersToInstruction([walletSigner], createAtaBaseInstruction);
          instructions.push(createAtaInstruction);
        }

        // AC-CI3.6: Build join table instruction data
        const instructionData = buildJoinTableData({ buyInAmount });

        // Build account metas from SDK
        const sdkAccountMetas = getJoinTableAccountMetas({
          table: tableAddress,
          vault: vaultAddress,
          playerTokenAccount,
          player: playerAddress,
          config: configAddress,
          tokenProgram: TOKEN_2022_PROGRAM_ID as Address,
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
        const joinInstruction = addSignersToInstruction([walletSigner], baseInstruction);
        instructions.push(joinInstruction);

        // Await the blockhash promise started earlier (parallel with ATA check)
        const { value: latestBlockhash } = await blockhashPromise;

        // AC-CI2.2: Build transaction using SDK instruction builders
        const transactionMessage = pipe(
          createTransactionMessage({ version: 0 }),
          (tx) => setTransactionMessageFeePayerSigner(walletSigner, tx),
          (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
          (tx) => appendTransactionMessageInstructions(instructions, tx)
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

        // Get signature
        const signature = getSignatureFromTransaction(signedTransaction);

        // AC-CI2.4: Send and confirm
        const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
        await sendAndConfirmTransaction(
          signedTransaction as Parameters<typeof sendAndConfirmTransaction>[0],
          { commitment: 'confirmed' }
        );

        logUiEvent('info', 'join_table', 'Table joined', {
          requestId: signature,
          tableId,
          data: { label },
        });

        // Success
        setTxState('confirmed');
        setTxSignature(signature);
        return { state: 'confirmed', signature, label };
      } catch (err) {
        // Log the raw error for debugging
        console.error('[joinTable] Raw error:', err);
        console.error('[joinTable] Error type:', err?.constructor?.name);
        if (err instanceof Error) {
          console.error('[joinTable] Error message:', err.message);
          console.error('[joinTable] Error stack:', err.stack);
        }

        const logs = extractLogs(err);
        if (logs) {
          console.error('[joinTable] Transaction logs:', logs);
        }

        const userFriendlyError = formatTransactionError(
          err instanceof Error ? err : String(err),
          logs,
          pokerProgramId
        );
        console.error('[joinTable] Formatted error:', userFriendlyError);

        const retryable = isNetworkError(err instanceof Error ? err : String(err));
        const userRejected = isUserRejection(err instanceof Error ? err : String(err));
        const shouldRetry = retryable && !userRejected;

        setTxState('failed');
        setTxError(userFriendlyError);
        setIsRetryable(shouldRetry);

        return { state: 'failed', error: userFriendlyError, isRetryable: shouldRetry, label };
      }
    },
    [
      wallet,
      rpc,
      rpcSubscriptions,
      tableAddress,
      vaultAddress,
      pokerProgramId,
      configAddress,
      playerTokenAccount,
      crispsMint,
      tableId,
    ]
  );

  /**
   * Leave the table.
   * AC-CI3.7: Leave table action sends a `leave_table` transaction.
   */
  const leaveTable = useCallback(async (): Promise<TableActionResult> => {
    if (!tableAddress || !vaultAddress || !configAddress || !playerTokenAccount || !pokerProgramId) {
      const error = 'Table info is still loading. Please try again in a moment.';
      setTxState('failed');
      setTxError(error);
      setIsRetryable(false);
      setTxLabel(undefined);
      return { state: 'failed', error, isRetryable: false };
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

    lastActionRef.current = { type: 'leave' };
    const label = getTableActionLabel('leave');
    setTxLabel(label);

    // Set pending state immediately
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

      // AC-CI3.7: Build leave table instruction data
      const instructionData = buildLeaveTableData();

      // Build account metas from SDK
      const sdkAccountMetas = getLeaveTableAccountMetas({
        table: tableAddress,
        vault: vaultAddress,
        playerTokenAccount,
        player: playerAddress,
        config: configAddress,
        tokenProgram: TOKEN_2022_PROGRAM_ID as Address,
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

      // AC-CI2.2: Build transaction using SDK instruction builders
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

      // Get signature
      const signature = getSignatureFromTransaction(signedTransaction);

      // AC-CI2.4: Send and confirm
      const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
      await sendAndConfirmTransaction(
        signedTransaction as Parameters<typeof sendAndConfirmTransaction>[0],
        { commitment: 'confirmed' }
      );

      logUiEvent('info', 'leave_table', 'Table left', {
        requestId: signature,
        tableId,
        data: { label },
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
  }, [
    wallet,
    rpc,
    rpcSubscriptions,
    tableAddress,
    vaultAddress,
    pokerProgramId,
    configAddress,
    playerTokenAccount,
    tableId,
  ]);

  const retry = useCallback(async (): Promise<TableActionResult> => {
    if (!lastActionRef.current) {
      const error = 'No previous action to retry.';
      setTxState('failed');
      setTxError(error);
      setIsRetryable(false);
      return { state: 'failed', error, isRetryable: false };
    }

    if (lastActionRef.current.type === 'join') {
      return joinTable(lastActionRef.current.buyInAmount);
    }

    return leaveTable();
  }, [joinTable, leaveTable]);

  return {
    joinTable,
    leaveTable,
    retry,
    txState,
    txSignature,
    txError,
    txLabel,
    resetTxState,
    isRetryable,
    isPending: txState === 'pending',
  };
}

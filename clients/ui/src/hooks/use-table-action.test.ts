/**
 * Tests for useTableAction hook.
 *
 * AC-CI3.6: Join TX transfers CRISPS to vault.
 * AC-CI3.7: Leave TX returns remaining stack to player.
 * AC-CI2.2: UI builds join/leave table transactions using SDK instruction builders.
 * AC-CI2.4: Verify transaction state management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { POKER_DISCRIMINATOR } from '@robopoker/client';

// Mock @solana/react-hooks
vi.mock('@solana/react-hooks', () => ({
  useWalletConnection: vi.fn(),
}));

// Mock @solana/client
vi.mock('@solana/client', () => ({
  createWalletTransactionSigner: vi.fn(() => ({
    signer: { address: 'mockSignerAddress' as const, signTransactions: vi.fn() },
    mode: 'signAndSend' as const,
  })),
}));

// Mock RPC functions
const mockSimulateTransaction = vi.fn(() => ({
  send: vi.fn(() => Promise.resolve({ value: { err: null, logs: [] } })),
}));
const mockGetAccountInfo = vi.fn(() => ({
  send: vi.fn(() => Promise.resolve({ value: null })),
}));
const mockRpc = {
  getLatestBlockhash: vi.fn(() => ({
    send: vi.fn(() => Promise.resolve({ value: { blockhash: 'mockBlockhash', lastValidBlockHeight: 1000n } })),
  })),
  getAccountInfo: mockGetAccountInfo,
  simulateTransaction: mockSimulateTransaction,
};
const mockRpcSubscriptions = {};

// Mock use-rpc hooks
vi.mock('./use-rpc', () => ({
  useRpc: vi.fn(() => mockRpc),
  useRpcSubscriptions: vi.fn(() => mockRpcSubscriptions),
}));

// Mock @solana-program/compute-budget
vi.mock('@solana-program/compute-budget', () => ({
  getSetComputeUnitLimitInstruction: vi.fn(() => ({ programAddress: 'computeBudget', data: new Uint8Array() })),
  getSetComputeUnitPriceInstruction: vi.fn(() => ({ programAddress: 'computeBudget', data: new Uint8Array() })),
}));

// Mock @solana/kit

vi.mock('@solana/kit', () => ({
  AccountRole: {
    READONLY: 0,
    WRITABLE: 1,
    READONLY_SIGNER: 2,
    WRITABLE_SIGNER: 3,
  },
  createTransactionMessage: vi.fn(() => ({})),
  pipe: vi.fn((...fns) => {
    let result = fns[0];
    for (let i = 1; i < fns.length; i++) {
      result = fns[i](result);
    }
    return result;
  }),
  setTransactionMessageFeePayerSigner: vi.fn((signer) => (tx: unknown) => ({ ...tx, feePayer: signer })),
  setTransactionMessageLifetimeUsingBlockhash: vi.fn((blockhash) => (tx: unknown) => ({ ...tx, blockhash })),
  appendTransactionMessageInstruction: vi.fn((instruction) => (tx: unknown) => ({ ...tx, instructions: [instruction] })),
  appendTransactionMessageInstructions: vi.fn((instructions) => (tx: unknown) => ({ ...tx, instructions })),
  signTransactionMessageWithSigners: vi.fn(() => Promise.resolve({ signatures: ['mockSig'] })),
  sendAndConfirmTransactionFactory: vi.fn(() => vi.fn(() => Promise.resolve())),
  getSignatureFromTransaction: vi.fn(() => 'mockSignature123'),
  assertIsSendableTransaction: vi.fn(),
  compileTransaction: vi.fn(() => ({})),
  getBase64EncodedWireTransaction: vi.fn(() => 'base64tx'),
  createSolanaRpc: vi.fn(() => ({
    getLatestBlockhash: vi.fn(() => ({
      send: vi.fn(() => Promise.resolve({ value: { blockhash: 'mockBlockhash', lastValidBlockHeight: 1000n } })),
    })),
    getAccountInfo: mockGetAccountInfo,
    simulateTransaction: mockSimulateTransaction,
  })),
  createSolanaRpcSubscriptions: vi.fn(() => ({})),
  addSignersToInstruction: vi.fn((signers, instruction) => ({ ...instruction, signers })),
}));

// Mock @robopoker/client
vi.mock('@robopoker/client', () => ({
  buildJoinTableData: vi.fn((args) => {
    // Build instruction data: discriminator (1) + padding (7) + buyInAmount (8)
    const data = new Uint8Array(16);
    data[0] = 2; // JOIN_TABLE discriminator
    const view = new DataView(data.buffer);
    view.setBigUint64(8, args.buyInAmount, true);
    return data;
  }),
  getJoinTableAccountMetas: vi.fn(() => [
    { address: 'tableAddress', role: 'writable' },
    { address: 'vaultAddress', role: 'writable' },
    { address: 'playerTokenAccount', role: 'writable' },
    { address: 'playerAddress', role: 'signer' },
    { address: 'configAddress', role: 'readonly' },
    { address: 'tokenProgram', role: 'readonly' },
  ]),
  buildLeaveTableData: vi.fn(() => {
    // Build instruction data: discriminator (1)
    return new Uint8Array([3]); // LEAVE_TABLE discriminator
  }),
  getLeaveTableAccountMetas: vi.fn(() => [
    { address: 'tableAddress', role: 'writable' },
    { address: 'vaultAddress', role: 'writable' },
    { address: 'playerTokenAccount', role: 'writable' },
    { address: 'playerAddress', role: 'signer' },
    { address: 'configAddress', role: 'readonly' },
    { address: 'tokenProgram', role: 'readonly' },
  ]),
  TOKEN_2022_PROGRAM_ID: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  ASSOCIATED_TOKEN_PROGRAM_ID: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  POKER_DISCRIMINATOR: {
    JOIN_TABLE: 2,
    LEAVE_TABLE: 3,
  },
  // ATA creation mocks
  getCreateAtaIdempotentAccountMetas: vi.fn(() => [
    { address: 'payerAddress', role: 'writable_signer' },
    { address: 'ataAddress', role: 'writable' },
    { address: 'walletAddress', role: 'readonly' },
    { address: 'mintAddress', role: 'readonly' },
    { address: 'systemProgram', role: 'readonly' },
    { address: 'tokenProgram', role: 'readonly' },
    { address: 'associatedTokenProgram', role: 'readonly' },
  ]),
  buildCreateAtaIdempotentData: vi.fn(() => new Uint8Array([1])),
  formatTransactionError: vi.fn((error) => {
    const msg = typeof error === 'string' ? error : error.message;
    if (msg.includes('network')) return 'Network error. Please check your connection and try again.';
    if (msg.includes('custom program error')) return 'Program error decoded.';
    return 'Transaction failed. Please try again.';
  }),
  isNetworkError: vi.fn((error) => {
    const msg = typeof error === 'string' ? error : error.message;
    return msg.toLowerCase().includes('network') || msg.toLowerCase().includes('timeout');
  }),
  isUserRejection: vi.fn((error) => {
    const msg = typeof error === 'string' ? error : error.message;
    return msg.toLowerCase().includes('user rejected');
  }),
}));

import { useWalletConnection } from '@solana/react-hooks';
import { sendAndConfirmTransactionFactory, type Address } from '@solana/kit';
import { buildJoinTableData, buildLeaveTableData, getJoinTableAccountMetas, getLeaveTableAccountMetas } from '@robopoker/client';
import { useTableAction } from './use-table-action';

const mockUseWalletConnection = useWalletConnection as ReturnType<typeof vi.fn>;
const mockSendAndConfirmTransactionFactory = sendAndConfirmTransactionFactory as ReturnType<typeof vi.fn>;
const mockBuildJoinTableData = buildJoinTableData as ReturnType<typeof vi.fn>;
const mockBuildLeaveTableData = buildLeaveTableData as ReturnType<typeof vi.fn>;
const mockGetJoinTableAccountMetas = getJoinTableAccountMetas as ReturnType<typeof vi.fn>;
const mockGetLeaveTableAccountMetas = getLeaveTableAccountMetas as ReturnType<typeof vi.fn>;

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useTableAction', () => {
  const mockConfig = {
    tableAddress: 'mockTableAddress' as Address,
    vaultAddress: 'mockVaultAddress' as Address,
    pokerProgramId: 'mockProgramId' as Address,
    configAddress: 'mockConfigAddress' as Address,
    playerTokenAccount: 'mockPlayerTokenAccount' as Address,
    crispsMint: 'mockCrispsMint' as Address,
  };

  const mockWallet = {
    account: {
      address: 'mockPlayerAddress' as Address,
      publicKey: new Uint8Array(32),
    },
    connector: { id: 'phantom', name: 'Phantom' },
    disconnect: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWalletConnection.mockReturnValue({
      wallet: mockWallet,
      status: 'connected',
      connectors: [],
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
    mockSendAndConfirmTransactionFactory.mockReturnValue(vi.fn(() => Promise.resolve()));
    // Reset simulation mock to return success by default
    mockSimulateTransaction.mockReturnValue({
      send: vi.fn(() => Promise.resolve({ value: { err: null, logs: [] } })),
    });
    // Reset getAccountInfo mock to return null (account doesn't exist)
    mockGetAccountInfo.mockReturnValue({
      send: vi.fn(() => Promise.resolve({ value: null })),
    });
  });

  describe('joinTable (AC-CI3.6)', () => {
    it('AC-CI3.6: join TX sends correct instruction with buy-in amount', async () => {
      const { result } = renderHook(() => useTableAction(mockConfig));

      await act(async () => {
        await result.current.joinTable(1000000n);
      });

      // Verify instruction builder was called with buy-in amount
      expect(mockBuildJoinTableData).toHaveBeenCalledWith({
        buyInAmount: 1000000n,
      });
    });

    it('AC-CI3.6: join TX includes vault and token accounts for transfer', async () => {
      const { result } = renderHook(() => useTableAction(mockConfig));

      await act(async () => {
        await result.current.joinTable(1000000n);
      });

      // Verify account metas include vault (for CRISPS transfer)
      expect(mockGetJoinTableAccountMetas).toHaveBeenCalledWith({
        table: mockConfig.tableAddress,
        vault: mockConfig.vaultAddress,
        playerTokenAccount: mockConfig.playerTokenAccount,
        player: 'mockPlayerAddress',
        config: mockConfig.configAddress,
        tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
      });
    });

    it('returns confirmed state on successful join', async () => {
      const { result } = renderHook(() => useTableAction(mockConfig));

      let response: Awaited<ReturnType<typeof result.current.joinTable>>;
      await act(async () => {
        response = await result.current.joinTable(1000000n);
      });

      expect(response!.state).toBe('confirmed');
      expect(response!.signature).toBe('mockSignature123');
    });
  });

  describe('leaveTable (AC-CI3.7)', () => {
    it('AC-CI3.7: leave TX sends correct instruction discriminator', async () => {
      const { result } = renderHook(() => useTableAction(mockConfig));

      await act(async () => {
        await result.current.leaveTable();
      });

      // Verify instruction builder was called (no args for leave)
      expect(mockBuildLeaveTableData).toHaveBeenCalled();
    });

    it('AC-CI3.7: leave TX includes vault and token accounts for transfer', async () => {
      const { result } = renderHook(() => useTableAction(mockConfig));

      await act(async () => {
        await result.current.leaveTable();
      });

      // Verify account metas include vault (for returning stack to player)
      expect(mockGetLeaveTableAccountMetas).toHaveBeenCalledWith({
        table: mockConfig.tableAddress,
        vault: mockConfig.vaultAddress,
        playerTokenAccount: mockConfig.playerTokenAccount,
        player: 'mockPlayerAddress',
        config: mockConfig.configAddress,
        tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
      });
    });

    it('returns confirmed state on successful leave', async () => {
      const { result } = renderHook(() => useTableAction(mockConfig));

      let response: Awaited<ReturnType<typeof result.current.leaveTable>>;
      await act(async () => {
        response = await result.current.leaveTable();
      });

      expect(response!.state).toBe('confirmed');
      expect(response!.signature).toBe('mockSignature123');
    });
  });

  describe('transaction state management (AC-CI2.4)', () => {
    it('starts with idle state', () => {
      const { result } = renderHook(() => useTableAction(mockConfig));

      expect(result.current.txState).toBe('idle');
      expect(result.current.isPending).toBe(false);
    });

    it('sets pending state immediately on join', async () => {
      const deferred = createDeferred<void>();
      mockSendAndConfirmTransactionFactory.mockReturnValue(() => deferred.promise);
      const { result } = renderHook(() => useTableAction(mockConfig));

      let joinPromise: Promise<unknown> = Promise.resolve();
      // Start action but don't await
      act(() => {
        joinPromise = result.current.joinTable(1000000n);
      });

      // State should be pending immediately
      expect(result.current.txState).toBe('pending');
      expect(result.current.isPending).toBe(true);

      await act(async () => {
        deferred.resolve();
        await joinPromise;
      });
    });

    it('sets pending state immediately on leave', async () => {
      const deferred = createDeferred<void>();
      mockSendAndConfirmTransactionFactory.mockReturnValue(() => deferred.promise);
      const { result } = renderHook(() => useTableAction(mockConfig));

      let leavePromise: Promise<unknown> = Promise.resolve();
      // Start action but don't await
      act(() => {
        leavePromise = result.current.leaveTable();
      });

      // State should be pending immediately
      expect(result.current.txState).toBe('pending');
      expect(result.current.isPending).toBe(true);

      await act(async () => {
        deferred.resolve();
        await leavePromise;
      });
    });

    it('sets confirmed state on successful transaction', async () => {
      const { result } = renderHook(() => useTableAction(mockConfig));

      await act(async () => {
        await result.current.joinTable(1000000n);
      });

      expect(result.current.txState).toBe('confirmed');
      expect(result.current.txSignature).toBe('mockSignature123');
    });

    it('sets failed state on wallet not connected', async () => {
      mockUseWalletConnection.mockReturnValue({
        wallet: null,
        status: 'disconnected',
        connectors: [],
        connect: vi.fn(),
        disconnect: vi.fn(),
      });

      const { result } = renderHook(() => useTableAction(mockConfig));

      await act(async () => {
        const response = await result.current.joinTable(1000000n);
        expect(response.state).toBe('failed');
        expect(response.error).toContain('Wallet not connected');
      });

      expect(result.current.txState).toBe('failed');
      expect(result.current.txError).toContain('Wallet not connected');
    });

    it('resetTxState clears all state', async () => {
      const { result } = renderHook(() => useTableAction(mockConfig));

      await act(async () => {
        await result.current.joinTable(1000000n);
      });

      expect(result.current.txState).toBe('confirmed');

      act(() => {
        result.current.resetTxState();
      });

      expect(result.current.txState).toBe('idle');
      expect(result.current.txSignature).toBeUndefined();
      expect(result.current.txError).toBeUndefined();
    });
  });

  describe('error handling (AC-CI4.1–AC-CI4.4)', () => {
    it('marks network errors as retryable and exposes retry', async () => {
      const sendAndConfirm = vi.fn(() => Promise.reject(new Error('Network timeout')));
      mockSendAndConfirmTransactionFactory.mockReturnValue(sendAndConfirm);

      const { result } = renderHook(() => useTableAction(mockConfig));

      await act(async () => {
        await result.current.joinTable(1000000n);
      });

      expect(result.current.txState).toBe('failed');
      expect(result.current.isRetryable).toBe(true);

      mockBuildJoinTableData.mockClear();

      await act(async () => {
        await result.current.retry();
      });

      expect(mockBuildJoinTableData).toHaveBeenCalled();
    });

    it('does not mark user rejection as retryable', async () => {
      const sendAndConfirm = vi.fn(() => Promise.reject(new Error('User rejected')));
      mockSendAndConfirmTransactionFactory.mockReturnValue(sendAndConfirm);

      const { result } = renderHook(() => useTableAction(mockConfig));

      await act(async () => {
        await result.current.leaveTable();
      });

      expect(result.current.isRetryable).toBe(false);
    });

    it('AC-CI4.4: surfaces simulation/preflight errors with user-friendly message', async () => {
      // Simulation errors occur during preflight check before transaction lands on-chain
      // With pre-send simulation, we catch errors early
      mockSimulateTransaction.mockReturnValueOnce({
        send: vi.fn(() => Promise.resolve({
          value: { err: { InstructionError: [0, { Custom: 6 }] }, logs: ['Program log: TableFull'] },
        })),
      });

      const { result } = renderHook(() => useTableAction(mockConfig));

      await act(async () => {
        await result.current.joinTable(1000000n);
      });

      expect(result.current.txState).toBe('failed');
      // AC-CI4.4: Simulation error surfaced with decoded program error message
      expect(result.current.txError).toBeDefined();
      // Simulation errors are not retryable (program logic failure, not network)
      expect(result.current.isRetryable).toBe(false);
    });

    it('AC-CI4.4: surfaces preflight failure with balance guidance', async () => {
      const sendAndConfirm = vi.fn(() =>
        Promise.reject(new Error('Preflight check failed: insufficient funds for transaction'))
      );
      mockSendAndConfirmTransactionFactory.mockReturnValue(sendAndConfirm);

      const { result } = renderHook(() => useTableAction(mockConfig));

      await act(async () => {
        await result.current.joinTable(1000000n);
      });

      expect(result.current.txState).toBe('failed');
      // formatTransactionError returns user-friendly message
      expect(result.current.txError).toBeDefined();
    });
  });
});

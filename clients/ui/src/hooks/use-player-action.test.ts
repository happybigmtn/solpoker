/**
 * Tests for usePlayerAction hook.
 *
 * AC-CI3.1–AC-CI3.5: Verify correct instruction discriminators for each action type.
 * AC-CI2.4: Verify transaction state management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ACTION_TYPE } from '@robopoker/client';

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
  signTransactionMessageWithSigners: vi.fn(() => Promise.resolve({ signatures: ['mockSig'] })),
  sendAndConfirmTransactionFactory: vi.fn(() => vi.fn(() => Promise.resolve())),
  getSignatureFromTransaction: vi.fn(() => 'mockSignature123'),
  assertIsSendableTransaction: vi.fn(),
  createSolanaRpc: vi.fn(() => ({
    getLatestBlockhash: vi.fn(() => ({
      send: vi.fn(() => Promise.resolve({ value: { blockhash: 'mockBlockhash', lastValidBlockHeight: 1000n } })),
    })),
  })),
  createSolanaRpcSubscriptions: vi.fn(() => ({})),
  addSignersToInstruction: vi.fn((signers, instruction) => ({ ...instruction, signers })),
}));

// Mock @robopoker/client
vi.mock('@robopoker/client', () => ({
  buildPlayerActionData: vi.fn((args) => new Uint8Array([6, args.actionType, 0, 0, 0, 0, 0, 0, ...new Uint8Array(8)])),
  getPlayerActionAccountMetas: vi.fn(() => [
    { address: 'tableAddress', role: 'writable' },
    { address: 'playerAddress', role: 'signer' },
    { address: 'configAddress', role: 'readonly' },
    { address: 'clockAddress', role: 'readonly' },
  ]),
  ACTION_TYPE: {
    FOLD: 0,
    CHECK: 1,
    CALL: 2,
    RAISE: 3,
    ALL_IN: 4,
  },
  formatTransactionError: vi.fn(() => 'Friendly error'),
  isNetworkError: vi.fn(() => false),
  isUserRejection: vi.fn(() => false),
}));

import { useWalletConnection } from '@solana/react-hooks';
import { sendAndConfirmTransactionFactory, type Address } from '@solana/kit';
import { buildPlayerActionData, formatTransactionError, isNetworkError, isUserRejection } from '@robopoker/client';
import { usePlayerAction, type PlayerActionType } from './use-player-action';

const mockUseWalletConnection = useWalletConnection as ReturnType<typeof vi.fn>;
const mockSendAndConfirmTransactionFactory = sendAndConfirmTransactionFactory as ReturnType<typeof vi.fn>;
const mockBuildPlayerActionData = buildPlayerActionData as ReturnType<typeof vi.fn>;
const mockFormatTransactionError = formatTransactionError as ReturnType<typeof vi.fn>;
const mockIsNetworkError = isNetworkError as ReturnType<typeof vi.fn>;
const mockIsUserRejection = isUserRejection as ReturnType<typeof vi.fn>;

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('usePlayerAction', () => {
  const mockConfig = {
    tableAddress: 'mockTableAddress' as Address,
    pokerProgramId: 'mockProgramId' as Address,
    configAddress: 'mockConfigAddress' as Address,
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
  });

  describe('action discriminators (AC-CI3.1–AC-CI3.5)', () => {
    it('AC-CI3.1: fold sends ACTION_TYPE.FOLD discriminator', async () => {
      const { result } = renderHook(() => usePlayerAction(mockConfig));

      await act(async () => {
        await result.current.executeAction('fold');
      });

      expect(mockBuildPlayerActionData).toHaveBeenCalledWith({
        actionType: ACTION_TYPE.FOLD,
        amount: 0n,
      });
    });

    it('AC-CI3.2: check sends ACTION_TYPE.CHECK discriminator', async () => {
      const { result } = renderHook(() => usePlayerAction(mockConfig));

      await act(async () => {
        await result.current.executeAction('check');
      });

      expect(mockBuildPlayerActionData).toHaveBeenCalledWith({
        actionType: ACTION_TYPE.CHECK,
        amount: 0n,
      });
    });

    it('AC-CI3.3: call sends ACTION_TYPE.CALL discriminator', async () => {
      const { result } = renderHook(() => usePlayerAction(mockConfig));

      await act(async () => {
        await result.current.executeAction('call');
      });

      expect(mockBuildPlayerActionData).toHaveBeenCalledWith({
        actionType: ACTION_TYPE.CALL,
        amount: 0n,
      });
    });

    it('AC-CI3.4: raise sends ACTION_TYPE.RAISE discriminator with amount', async () => {
      const { result } = renderHook(() => usePlayerAction(mockConfig));

      await act(async () => {
        await result.current.executeAction('raise', 100n);
      });

      expect(mockBuildPlayerActionData).toHaveBeenCalledWith({
        actionType: ACTION_TYPE.RAISE,
        amount: 100n,
      });
    });

    it('AC-CI3.5: shove sends ACTION_TYPE.ALL_IN discriminator', async () => {
      const { result } = renderHook(() => usePlayerAction(mockConfig));

      await act(async () => {
        await result.current.executeAction('shove');
      });

      expect(mockBuildPlayerActionData).toHaveBeenCalledWith({
        actionType: ACTION_TYPE.ALL_IN,
        amount: 0n,
      });
    });
  });

  describe('transaction state management (AC-CI2.4)', () => {
    it('starts with idle state', () => {
      const { result } = renderHook(() => usePlayerAction(mockConfig));

      expect(result.current.txState).toBe('idle');
      expect(result.current.isPending).toBe(false);
    });

    it('AC-PQ.CI1: sets pending state immediately on action execution', async () => {
      const deferred = createDeferred<void>();
      mockSendAndConfirmTransactionFactory.mockReturnValue(() => deferred.promise);
      const { result } = renderHook(() => usePlayerAction(mockConfig));

      let actionPromise: Promise<unknown> = Promise.resolve();
      // Start action but don't await
      act(() => {
        actionPromise = result.current.executeAction('check');
      });

      // State should be pending immediately
      expect(result.current.txState).toBe('pending');
      expect(result.current.isPending).toBe(true);

      await act(async () => {
        deferred.resolve();
        await actionPromise;
      });
    });

    it('sets confirmed state on successful transaction', async () => {
      const { result } = renderHook(() => usePlayerAction(mockConfig));

      await act(async () => {
        await result.current.executeAction('check');
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

      const { result } = renderHook(() => usePlayerAction(mockConfig));

      await act(async () => {
        const response = await result.current.executeAction('check');
        expect(response.state).toBe('failed');
        expect(response.error).toContain('Wallet not connected');
      });

      expect(result.current.txState).toBe('failed');
      expect(result.current.txError).toContain('Wallet not connected');
    });

    it('resetTxState clears all state', async () => {
      const { result } = renderHook(() => usePlayerAction(mockConfig));

      await act(async () => {
        await result.current.executeAction('check');
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

  describe('executeAction return value', () => {
    it('returns signature on success', async () => {
      const { result } = renderHook(() => usePlayerAction(mockConfig));

      let response: Awaited<ReturnType<typeof result.current.executeAction>>;
      await act(async () => {
        response = await result.current.executeAction('fold');
      });

      expect(response!.state).toBe('confirmed');
      expect(response!.signature).toBe('mockSignature123');
    });

    it('returns error on failure', async () => {
      mockUseWalletConnection.mockReturnValue({
        wallet: null,
        status: 'disconnected',
        connectors: [],
        connect: vi.fn(),
        disconnect: vi.fn(),
      });

      const { result } = renderHook(() => usePlayerAction(mockConfig));

      let response: Awaited<ReturnType<typeof result.current.executeAction>>;
      await act(async () => {
        response = await result.current.executeAction('fold');
      });

      expect(response!.state).toBe('failed');
      expect(response!.error).toBeDefined();
    });
  });

  describe('error handling (AC-CI4.1–AC-CI4.3)', () => {
    it('marks network errors as retryable and exposes retry', async () => {
      const sendAndConfirm = vi.fn(() => Promise.reject(new Error('Network timeout')));
      mockSendAndConfirmTransactionFactory.mockReturnValue(sendAndConfirm);
      mockFormatTransactionError.mockReturnValue('Network error. Please retry.');
      mockIsNetworkError.mockReturnValue(true);
      mockIsUserRejection.mockReturnValue(false);

      const { result } = renderHook(() => usePlayerAction(mockConfig));

      await act(async () => {
        await result.current.executeAction('check');
      });

      expect(result.current.txState).toBe('failed');
      expect(result.current.txError).toBe('Network error. Please retry.');
      expect(result.current.isRetryable).toBe(true);

      mockBuildPlayerActionData.mockClear();

      await act(async () => {
        await result.current.retry();
      });

      expect(mockBuildPlayerActionData).toHaveBeenCalled();
    });

    it('does not mark user rejection as retryable', async () => {
      const sendAndConfirm = vi.fn(() => Promise.reject(new Error('User rejected')));
      mockSendAndConfirmTransactionFactory.mockReturnValue(sendAndConfirm);
      mockFormatTransactionError.mockReturnValue('You cancelled the transaction.');
      mockIsNetworkError.mockReturnValue(true);
      mockIsUserRejection.mockReturnValue(true);

      const { result } = renderHook(() => usePlayerAction(mockConfig));

      await act(async () => {
        await result.current.executeAction('check');
      });

      expect(result.current.isRetryable).toBe(false);
    });
  });
});

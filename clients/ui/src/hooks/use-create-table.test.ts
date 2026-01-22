/**
 * Tests for useCreateTable hook.
 *
 * AC-CI5.3: UI can create a new table with specified blinds.
 * AC-CI5.4: Created table redirects to the table view.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

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
const mockRpc = {
  getLatestBlockhash: vi.fn(() => ({
    send: vi.fn(() => Promise.resolve({ value: { blockhash: 'mockBlockhash', lastValidBlockHeight: 1000n } })),
  })),
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
  createSolanaRpc: vi.fn(() => mockRpc),
  createSolanaRpcSubscriptions: vi.fn(() => ({})),
  addSignersToInstruction: vi.fn((signers, instruction) => ({ ...instruction, signers })),
}));

// Mock @robopoker/client
vi.mock('@robopoker/client', () => ({
  buildCreateTableData: vi.fn((args) => {
    // Build instruction data: discriminator (1) + padding (7) + tableId (8) + smallBlind (8) + bigBlind (8)
    const data = new Uint8Array(32);
    data[0] = 1; // CREATE_TABLE discriminator
    const view = new DataView(data.buffer);
    view.setBigUint64(8, args.tableId, true);
    view.setBigUint64(16, args.smallBlind, true);
    view.setBigUint64(24, args.bigBlind, true);
    return data;
  }),
  getCreateTableAccountMetas: vi.fn(() => [
    { address: 'tableAddress', role: 'writable' },
    { address: 'vaultAddress', role: 'writable' },
    { address: 'payerAddress', role: 'writable_signer' },
    { address: 'configAddress', role: 'readonly' },
    { address: 'crispsMint', role: 'readonly' },
    { address: 'tokenProgram', role: 'readonly' },
    { address: 'systemProgram', role: 'readonly' },
  ]),
  deriveTablePda: vi.fn((programId, tableId) =>
    Promise.resolve([`derivedTable_${tableId}` as const, 255])
  ),
  deriveVaultPda: vi.fn((programId, tableId) =>
    Promise.resolve([`derivedVault_${tableId}` as const, 254])
  ),
  derivePokerConfigPda: vi.fn(() =>
    Promise.resolve(['derivedConfig' as const, 253])
  ),
  TOKEN_2022_PROGRAM_ID: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  SYSTEM_PROGRAM_ID: '11111111111111111111111111111111',
  POKER_DISCRIMINATOR: { CREATE_TABLE: 1 },
  formatTransactionError: vi.fn((error) => {
    const msg = typeof error === 'string' ? error : error.message;
    if (msg.includes('network')) return 'Network error. Please check your connection and try again.';
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
import {
  buildCreateTableData,
  getCreateTableAccountMetas,
  deriveTablePda,
  deriveVaultPda,
  derivePokerConfigPda,
} from '@robopoker/client';
import { useCreateTable } from './use-create-table';
import type { Address } from '@solana/kit';

const mockUseWalletConnection = useWalletConnection as ReturnType<typeof vi.fn>;
const mockBuildCreateTableData = buildCreateTableData as ReturnType<typeof vi.fn>;
const mockGetCreateTableAccountMetas = getCreateTableAccountMetas as ReturnType<typeof vi.fn>;
const mockDeriveTablePda = deriveTablePda as ReturnType<typeof vi.fn>;
const mockDeriveVaultPda = deriveVaultPda as ReturnType<typeof vi.fn>;
const mockDerivePokerConfigPda = derivePokerConfigPda as ReturnType<typeof vi.fn>;

describe('useCreateTable (AC-CI5.3, AC-CI5.4)', () => {
  const mockConfig = {
    pokerProgramId: 'mockProgramId' as Address,
    crispsMint: 'mockCrispsMint' as Address,
  };

  const mockWallet = {
    account: {
      address: 'mockPayerAddress' as Address,
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
  });

  describe('createTable (AC-CI5.3)', () => {
    it('AC-CI5.3: creates table with specified blinds', async () => {
      const { result } = renderHook(() => useCreateTable(mockConfig));

      await act(async () => {
        await result.current.createTable({
          tableId: 12345n,
          smallBlind: 1_000_000_000n,
          bigBlind: 2_000_000_000n,
        });
      });

      // Verify instruction builder was called with correct args
      expect(mockBuildCreateTableData).toHaveBeenCalledWith({
        tableId: 12345n,
        smallBlind: 1_000_000_000n,
        bigBlind: 2_000_000_000n,
      });
    });

    it('AC-CI5.3: derives correct PDAs for table and vault', async () => {
      const { result } = renderHook(() => useCreateTable(mockConfig));

      await act(async () => {
        await result.current.createTable({
          tableId: 99999n,
          smallBlind: 1n,
          bigBlind: 2n,
        });
      });

      // Verify PDA derivations were called
      expect(mockDeriveTablePda).toHaveBeenCalledWith(mockConfig.pokerProgramId, 99999n);
      expect(mockDeriveVaultPda).toHaveBeenCalledWith(mockConfig.pokerProgramId, 99999n);
      expect(mockDerivePokerConfigPda).toHaveBeenCalledWith(mockConfig.pokerProgramId);
    });

    it('AC-CI5.3: builds correct account metas', async () => {
      const { result } = renderHook(() => useCreateTable(mockConfig));

      await act(async () => {
        await result.current.createTable({
          tableId: 1n,
          smallBlind: 100n,
          bigBlind: 200n,
        });
      });

      // Verify account metas were requested
      expect(mockGetCreateTableAccountMetas).toHaveBeenCalledWith(
        expect.objectContaining({
          table: 'derivedTable_1',
          vault: 'derivedVault_1',
          payer: 'mockPayerAddress',
          config: 'derivedConfig',
          crispsMint: mockConfig.crispsMint,
        })
      );
    });

    it('AC-CI5.4: returns table address on success (for redirect)', async () => {
      const { result } = renderHook(() => useCreateTable(mockConfig));

      let response: Awaited<ReturnType<typeof result.current.createTable>>;
      await act(async () => {
        response = await result.current.createTable({
          tableId: 42n,
          smallBlind: 1n,
          bigBlind: 2n,
        });
      });

      expect(response!.state).toBe('confirmed');
      expect(response!.signature).toBe('mockSignature123');
      expect(response!.tableAddress).toBe('derivedTable_42');
    });
  });

  describe('transaction state management', () => {
    it('starts with idle state', () => {
      const { result } = renderHook(() => useCreateTable(mockConfig));

      expect(result.current.txState).toBe('idle');
      expect(result.current.isPending).toBe(false);
    });

    it('sets pending state immediately', async () => {
      const { result } = renderHook(() => useCreateTable(mockConfig));

      // Start action but don't await
      act(() => {
        result.current.createTable({
          tableId: 1n,
          smallBlind: 1n,
          bigBlind: 2n,
        });
      });

      expect(result.current.txState).toBe('pending');
      expect(result.current.isPending).toBe(true);
    });

    it('sets confirmed state on success', async () => {
      const { result } = renderHook(() => useCreateTable(mockConfig));

      await act(async () => {
        await result.current.createTable({
          tableId: 1n,
          smallBlind: 1n,
          bigBlind: 2n,
        });
      });

      expect(result.current.txState).toBe('confirmed');
      expect(result.current.txSignature).toBe('mockSignature123');
      expect(result.current.tableAddress).toBe('derivedTable_1');
    });

    it('sets failed state on wallet not connected', async () => {
      mockUseWalletConnection.mockReturnValue({
        wallet: null,
        status: 'disconnected',
        connectors: [],
        connect: vi.fn(),
        disconnect: vi.fn(),
      });

      const { result } = renderHook(() => useCreateTable(mockConfig));

      await act(async () => {
        const response = await result.current.createTable({
          tableId: 1n,
          smallBlind: 1n,
          bigBlind: 2n,
        });
        expect(response.state).toBe('failed');
        expect(response.error).toContain('Wallet not connected');
      });

      expect(result.current.txState).toBe('failed');
      expect(result.current.txError).toContain('Wallet not connected');
    });

    it('resetTxState clears all state', async () => {
      const { result } = renderHook(() => useCreateTable(mockConfig));

      await act(async () => {
        await result.current.createTable({
          tableId: 1n,
          smallBlind: 1n,
          bigBlind: 2n,
        });
      });

      expect(result.current.txState).toBe('confirmed');

      act(() => {
        result.current.resetTxState();
      });

      expect(result.current.txState).toBe('idle');
      expect(result.current.txSignature).toBeUndefined();
      expect(result.current.tableAddress).toBeUndefined();
      expect(result.current.txError).toBeUndefined();
    });
  });
});

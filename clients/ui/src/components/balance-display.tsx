'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWalletConnection } from '@solana/react-hooks';
import { createSolanaRpc, type Address } from '@solana/kit';
import { deriveAssociatedTokenAccount } from '@robopoker/client';

/**
 * Balance display component showing SOL and CRISPS balances.
 * Implements AC-D6.2: UI can connect wallet and display SOL + CRISPS balances.
 */
interface BalanceDisplayProps {
  /** CRISPS mint address */
  crispsMint: Address;
}

const CRISPS_DECIMALS = 9;

export function BalanceDisplay({ crispsMint }: BalanceDisplayProps) {
  const { wallet, status } = useWalletConnection();
  const [solBalance, setSolBalance] = useState<bigint | null>(null);
  const [crispsBalance, setCrispsBalance] = useState<bigint | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connected = status === 'connected';
  const address = wallet?.account?.address;

  const fetchBalances = useCallback(async () => {
    if (!address || !crispsMint) return;

    setIsLoading(true);
    setError(null);

    try {
      const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
      const rpc = createSolanaRpc(rpcUrl);

      // Fetch SOL balance
      const solBalanceResult = await rpc.getBalance(address).send();
      setSolBalance(solBalanceResult.value);

      // Fetch CRISPS balance (Token-2022 ATA)
      const [ataAddress] = await deriveAssociatedTokenAccount(address, crispsMint);

      const ataInfo = await rpc.getAccountInfo(ataAddress, { encoding: 'base64' }).send();

      if (ataInfo.value) {
        // Parse token account balance (offset 64, 8 bytes, little-endian)
        const data = Buffer.from(ataInfo.value.data[0], 'base64');
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const tokenBalance = view.getBigUint64(64, true);
        setCrispsBalance(tokenBalance);
      } else {
        // No ATA exists yet
        setCrispsBalance(0n);
      }
    } catch (err) {
      console.error('Failed to fetch balances:', err);
      setError('Failed to load balances');
    } finally {
      setIsLoading(false);
    }
  }, [address, crispsMint]);

  // Fetch balances on mount and when address changes
  useEffect(() => {
    if (connected && address) {
      fetchBalances();
    } else {
      setSolBalance(null);
      setCrispsBalance(null);
    }
  }, [connected, address, fetchBalances]);

  // Don't show anything if not connected
  if (!connected || !address) {
    return null;
  }

  const formatSol = (balance: bigint) => {
    const sol = Number(balance) / 1e9;
    return sol.toFixed(4);
  };

  const formatCrisps = (balance: bigint) => {
    const crisps = Number(balance) / 10 ** CRISPS_DECIMALS;
    return crisps.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  return (
    <div className="flex items-center gap-4 text-sm">
      {isLoading ? (
        <span className="text-zinc-500 dark:text-zinc-400">Loading...</span>
      ) : error ? (
        <span className="text-red-500 dark:text-red-400">{error}</span>
      ) : (
        <>
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-500 dark:text-zinc-400">SOL:</span>
            <span className="font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
              {solBalance !== null ? formatSol(solBalance) : '--'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-500 dark:text-zinc-400">CRISPS:</span>
            <span className="font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
              {crispsBalance !== null ? formatCrisps(crispsBalance) : '--'}
            </span>
          </div>
          <button
            onClick={fetchBalances}
            className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
            aria-label="Refresh balances"
            title="Refresh balances"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}

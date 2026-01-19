'use client';

import { useMemo } from 'react';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';

/**
 * RPC configuration for Solana connections.
 * Per AC-1.4: Websocket endpoint configured for subscriptions.
 * Per AC-1.2: Uses @solana/kit for transaction construction.
 */
export function useRpcConfig() {
  return useMemo(() => {
    const httpUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
    const wsUrl =
      process.env.NEXT_PUBLIC_SOLANA_WS_URL ||
      httpUrl.replace('https', 'wss').replace('http', 'ws');

    return { httpUrl, wsUrl };
  }, []);
}

/**
 * Creates an RPC client for HTTP requests.
 * Per AC-1.2: Uses @solana/kit (no direct web3.js usage).
 */
export function useRpc() {
  const { httpUrl } = useRpcConfig();
  return useMemo(() => createSolanaRpc(httpUrl), [httpUrl]);
}

/**
 * Creates an RPC subscriptions client for WebSocket notifications.
 * Per AC-1.4: Websocket endpoint for table/game updates.
 * Per AC-4.1: Subscriptions for real-time updates.
 */
export function useRpcSubscriptions() {
  const { wsUrl } = useRpcConfig();
  return useMemo(() => createSolanaRpcSubscriptions(wsUrl), [wsUrl]);
}

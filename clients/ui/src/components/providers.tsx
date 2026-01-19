'use client';

import { type ReactNode } from 'react';
import { autoDiscover, createClient } from '@solana/client';
import { SolanaProvider as SolanaHooksProvider } from '@solana/react-hooks';

/**
 * Solana wallet provider with Wallet Standard auto-discovery.
 * Per AC-1.1, AC-1.3: Uses framework-kit with Wallet Standard wallets.
 * Per AC-1.4: Websocket endpoint configured for subscriptions.
 */
const endpoint =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';

const websocketEndpoint =
  process.env.NEXT_PUBLIC_SOLANA_WS_URL ??
  endpoint.replace('https://', 'wss://').replace('http://', 'ws://');

const solanaClient = createClient({
  endpoint,
  websocketEndpoint,
  walletConnectors: autoDiscover(),
});

export function SolanaProvider({ children }: { children: ReactNode }) {
  return <SolanaHooksProvider client={solanaClient}>{children}</SolanaHooksProvider>;
}

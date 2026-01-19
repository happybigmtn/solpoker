'use client';

import { type ReactNode } from 'react';
import { SolanaProvider } from './providers';

/**
 * Client-side provider wrapper.
 * Per AC-1.5: Wallet/hooks live only in client components.
 */
export function ClientProviders({ children }: { children: ReactNode }) {
  return <SolanaProvider>{children}</SolanaProvider>;
}

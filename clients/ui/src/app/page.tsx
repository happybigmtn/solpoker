import { WalletConnect } from '@/components/wallet-connect';
import { Lobby } from '@/components/lobby';
import type { Address } from '@solana/kit';

export default function Home() {
  // Read program IDs from environment variables
  const pokerProgramId = (process.env.NEXT_PUBLIC_POKER_PROGRAM_ID || '') as Address;
  const crispsMint = (process.env.NEXT_PUBLIC_CRISPS_MINT || '') as Address;

  return (
    <div className="flex min-h-screen flex-col">
      {/* Skip link for accessibility (AC-5.4) */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-4 focus:bg-zinc-900 focus:text-white"
      >
        Skip to main content
      </a>

      <header className="flex h-16 items-center justify-between border-b border-zinc-200 px-6 dark:border-zinc-800">
        <h1 className="text-lg font-semibold">RoboPoker</h1>
        <WalletConnect />
      </header>

      <main id="main" className="flex-1 p-6">
        <Lobby pokerProgramId={pokerProgramId} crispsMint={crispsMint} />
      </main>
    </div>
  );
}

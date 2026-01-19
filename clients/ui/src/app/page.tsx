import { WalletConnect } from '@/components/wallet-connect';

export default function Home() {
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

      <main id="main" className="flex flex-1 items-center justify-center p-6">
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-balance">
            On-chain Multiplayer Poker
          </h2>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Connect your wallet to get started.
          </p>
        </div>
      </main>
    </div>
  );
}

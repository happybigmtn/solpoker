'use client';

import { useState, useCallback } from 'react';
import { useWalletConnection } from '@solana/react-hooks';

/**
 * Wallet connect button with Wallet Standard auto-discovery.
 * Per AC-1.3: Wallet connect/disconnect via framework-kit hooks.
 * Per AC-5.2: Uses semantic button element.
 * Per AC-5.8: Provides hover/active feedback.
 */
export function WalletConnect() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { connectors, connect, disconnect, wallet, status } = useWalletConnection();
  const [copied, setCopied] = useState(false);

  const connected = status === 'connected';
  const connecting = status === 'connecting';
  const address = wallet?.account?.address?.toString() ?? '';
  const formatted = address
    ? `${address.slice(0, 4)}…${address.slice(-4)}`
    : '';

  const handleSelect = useCallback(
    async (connector: (typeof connectors)[number]) => {
      await connect(connector.id);
      setIsModalOpen(false);
    },
    [connect],
  );

  const handleOpenModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const handleCopy = useCallback(async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [address]);

  if (connecting) {
    return (
      <button
        disabled
        className="h-10 px-4 rounded-lg bg-zinc-200 text-zinc-500 cursor-not-allowed dark:bg-zinc-800 dark:text-zinc-500"
        aria-busy="true"
      >
        Connecting…
      </button>
    );
  }

  if (connected && address) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={handleCopy}
          className="h-10 px-4 rounded-lg bg-zinc-100 text-zinc-900 font-mono text-sm tabular-nums transition-colors hover:bg-zinc-200 active:bg-zinc-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700 dark:active:bg-zinc-600"
          aria-label={copied ? 'Address copied' : 'Copy wallet address'}
        >
          {copied ? 'Copied!' : formatted}
        </button>
        <button
          onClick={disconnect}
          className="h-10 px-4 rounded-lg border border-zinc-300 text-zinc-700 transition-colors hover:bg-zinc-100 active:bg-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={handleOpenModal}
        className="h-10 px-4 rounded-lg bg-zinc-900 text-white transition-colors hover:bg-zinc-800 active:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:active:bg-zinc-300"
      >
        Connect Wallet
      </button>

      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={handleCloseModal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="wallet-modal-title"
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="wallet-modal-title"
              className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100"
            >
              Select Wallet
            </h2>
            <div className="flex flex-col gap-2">
              {connectors.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  No wallets detected. Install a Solana wallet extension.
                </p>
              ) : (
                connectors.map((connector) => (
                  <button
                    key={connector.name}
                    onClick={() => handleSelect(connector)}
                    className="flex h-12 items-center gap-3 rounded-lg px-4 text-left transition-colors hover:bg-zinc-100 active:bg-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
                  >
                    {/* AC-9.1: Decorative image with explicit dimensions and alt="" */}
                    {/* AC-9.2: Lazy load below-fold images */}
                    {connector.icon && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={connector.icon}
                        alt=""
                        width={24}
                        height={24}
                        loading="lazy"
                        className="h-6 w-6"
                      />
                    )}
                    <span className="text-zinc-900 dark:text-zinc-100">
                      {connector.name}
                    </span>
                  </button>
                ))
              )}
            </div>
            <button
              onClick={handleCloseModal}
              className="mt-4 h-10 w-full rounded-lg border border-zinc-300 text-zinc-700 transition-colors hover:bg-zinc-100 active:bg-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

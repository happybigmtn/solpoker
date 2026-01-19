'use client';

/**
 * Transaction status component.
 *
 * AC-3.4: Error states and transaction states shown inline
 * (pending, confirmed, failed) with clear, minimal messaging.
 * AC-6.5: Error messages include a next-step fix in second person.
 */

import { memo } from 'react';

export type TransactionState = 'idle' | 'pending' | 'confirmed' | 'failed';

export interface TransactionStatusProps {
  /** Current transaction state */
  state: TransactionState;
  /** Transaction signature (for confirmed state) */
  signature?: string;
  /** Error message (for failed state) */
  error?: string;
  /** Whether the error is retryable */
  isRetryable?: boolean;
  /** Callback to retry the last action */
  onRetry?: () => void;
  /** Callback to dismiss/reset */
  onDismiss?: () => void;
}

/**
 * Inline transaction status indicator.
 *
 * AC-3.4: Shows pending spinner, success checkmark, or error state.
 * Uses toast-like appearance but inline for context.
 */
export const TransactionStatus = memo(function TransactionStatus({
  state,
  signature,
  error,
  isRetryable,
  onRetry,
  onDismiss,
}: TransactionStatusProps) {
  if (state === 'idle') return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`
        flex items-center gap-2 rounded-lg px-3 py-2 text-sm
        ${state === 'pending' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200' : ''}
        ${state === 'confirmed' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200' : ''}
        ${state === 'failed' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200' : ''}
      `}
    >
      {state === 'pending' && (
        <>
          <Spinner />
          <span>Submitting transaction…</span>
        </>
      )}

      {state === 'confirmed' && (
        <>
          <CheckIcon />
          <span>Transaction confirmed</span>
          {signature && (
            <a
              href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 underline hover:no-underline"
            >
              View
            </a>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="ml-auto p-1 hover:bg-green-200 rounded dark:hover:bg-green-800"
              aria-label="Dismiss"
            >
              <CloseIcon />
            </button>
          )}
        </>
      )}

      {state === 'failed' && (
        <>
          <ErrorIcon />
          <div className="flex-1">
            <p className="font-medium">Transaction failed</p>
            {/* AC-6.5: Error messages in second person with next-step */}
            <p className="text-xs opacity-80">
              {formatErrorMessage(error)}
            </p>
          </div>
          {isRetryable && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="px-2 py-1 text-xs font-medium rounded bg-red-200 text-red-800 hover:bg-red-300 dark:bg-red-900/40 dark:text-red-200 dark:hover:bg-red-900/60"
            >
              Retry
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="p-1 hover:bg-red-200 rounded dark:hover:bg-red-800"
              aria-label="Dismiss"
            >
              <CloseIcon />
            </button>
          )}
        </>
      )}
    </div>
  );
});

/**
 * Format error message with user-friendly next step.
 *
 * AC-6.5: Include a next-step fix in second person.
 */
function formatErrorMessage(error?: string): string {
  if (!error) {
    return 'Something went wrong. Please try again.';
  }

  // Common Solana error patterns with user-friendly messages
  const errorMappings: Record<string, string> = {
    'insufficient funds': 'You don\'t have enough funds. Please add more CRISPS to your wallet.',
    'insufficient lamports': 'You don\'t have enough SOL for fees. Please add SOL to your wallet.',
    'blockhash not found': 'The transaction expired. Please try again.',
    'transaction simulation failed': 'The action couldn\'t be completed. Please check your balance and try again.',
    'user rejected': 'You cancelled the transaction. Please approve it in your wallet to continue.',
    'timeout': 'The transaction timed out. Please check your connection and try again.',
  };

  const lowerError = error.toLowerCase();
  for (const [pattern, message] of Object.entries(errorMappings)) {
    if (lowerError.includes(pattern)) {
      return message;
    }
  }

  // Default: show original error with generic next-step
  return `${error}. Please try again or contact support if the issue persists.`;
}

/**
 * Loading spinner component.
 *
 * AC-5.5: Uses transform for animation (not layout properties).
 */
function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
}

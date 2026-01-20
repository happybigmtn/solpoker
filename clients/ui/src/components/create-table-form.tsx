'use client';

/**
 * Form component for creating new poker tables.
 *
 * AC-CI5.3: UI can create a new table with specified blinds.
 * AC-CI5.4: Created table redirects to the table view.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCreateTable } from '@/hooks/use-create-table';
import { TransactionStatus } from '@/components/transaction-status';
import type { Address } from '@solana/kit';

interface CreateTableFormProps {
  /** Poker program ID */
  pokerProgramId: Address;
  /** CRISPS mint address */
  crispsMint: Address;
  /** Callback when table is successfully created */
  onSuccess?: () => void;
}

/**
 * Generate a random table ID.
 * Uses current timestamp + random number for uniqueness.
 */
function generateTableId(): bigint {
  const timestamp = BigInt(Date.now());
  const random = BigInt(Math.floor(Math.random() * 1_000_000));
  return timestamp * 1_000_000n + random;
}

/**
 * Parse token input to bigint (multiplied by 10^9 for CRISPS decimals).
 */
function parseTokenInput(value: string): bigint | null {
  const trimmed = value.trim();
  if (!trimmed || isNaN(Number(trimmed))) return null;

  const parts = trimmed.split('.');
  if (parts.length > 2) return null;

  const whole = parts[0] || '0';
  const fractional = (parts[1] || '').padEnd(9, '0').slice(0, 9);

  try {
    return BigInt(whole) * 1_000_000_000n + BigInt(fractional);
  } catch {
    return null;
  }
}

/**
 * Form for creating a new poker table.
 */
export function CreateTableForm({ pokerProgramId, crispsMint, onSuccess }: CreateTableFormProps) {
  const router = useRouter();
  const { createTable, txState, txSignature, tableAddress, txError, resetTxState, isPending } =
    useCreateTable({ pokerProgramId, crispsMint });

  const [smallBlindInput, setSmallBlindInput] = useState('1');
  const [bigBlindInput, setBigBlindInput] = useState('2');
  const [validationError, setValidationError] = useState<string>();
  const [errorField, setErrorField] = useState<'smallBlind' | 'bigBlind'>();
  const [isOpen, setIsOpen] = useState(false);
  const smallBlindRef = useRef<HTMLInputElement>(null);
  const bigBlindRef = useRef<HTMLInputElement>(null);

  // AC-5.13: Focus the first error field on validation error
  useEffect(() => {
    if (validationError && errorField) {
      const ref = errorField === 'smallBlind' ? smallBlindRef : bigBlindRef;
      ref.current?.focus();
    }
  }, [validationError, errorField]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setValidationError(undefined);
      setErrorField(undefined);

      // Parse and validate inputs
      const smallBlind = parseTokenInput(smallBlindInput);
      const bigBlind = parseTokenInput(bigBlindInput);

      // AC-5.13: Set error field for focus on validation error
      if (smallBlind === null || smallBlind <= 0n) {
        setValidationError('Small blind must be a positive number. Enter a value greater than 0.');
        setErrorField('smallBlind');
        return;
      }

      if (bigBlind === null || bigBlind <= 0n) {
        setValidationError('Big blind must be a positive number. Enter a value greater than 0.');
        setErrorField('bigBlind');
        return;
      }

      if (bigBlind < smallBlind) {
        setValidationError('Big blind must be at least equal to small blind. Increase the big blind value.');
        setErrorField('bigBlind');
        return;
      }

      // Generate unique table ID
      const tableId = generateTableId();

      // AC-CI5.3: Create the table
      const result = await createTable({ tableId, smallBlind, bigBlind });

      // AC-CI5.4: Redirect on success
      if (result.state === 'confirmed' && result.tableAddress) {
        onSuccess?.();
        router.push(`/table/${result.tableAddress}`);
      }
    },
    [smallBlindInput, bigBlindInput, createTable, router, onSuccess]
  );

  const handleClose = useCallback(() => {
    setIsOpen(false);
    resetTxState();
    setValidationError(undefined);
  }, [resetTxState]);

  // Show success message before redirect
  if (txState === 'confirmed' && tableAddress) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-900/20">
        <p className="text-sm text-green-800 dark:text-green-300">
          Table created successfully! Redirecting...
        </p>
        {txSignature && (
          <p className="mt-1 text-xs font-mono text-green-600 dark:text-green-400">
            TX: {txSignature.slice(0, 20)}...
          </p>
        )}
      </div>
    );
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-900"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Create Table
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Create New Table</h3>
        <button
          onClick={handleClose}
          disabled={isPending}
          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          aria-label="Close create table form"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="smallBlind" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Small Blind (CRISPS)
            </label>
            <input
              ref={smallBlindRef}
              type="number"
              inputMode="decimal"
              id="smallBlind"
              name="smallBlind"
              autoComplete="off"
              min="0"
              step="0.000000001"
              value={smallBlindInput}
              onChange={(e) => setSmallBlindInput(e.target.value)}
              disabled={isPending}
              aria-invalid={errorField === 'smallBlind'}
              aria-describedby={errorField === 'smallBlind' ? 'form-error' : undefined}
              className={`mt-1 block w-full rounded-md border bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 disabled:bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-100 dark:disabled:bg-zinc-800 ${
                errorField === 'smallBlind'
                  ? 'border-red-500 focus:border-red-500 focus:ring-red-500 dark:border-red-500'
                  : 'border-zinc-300 focus:border-emerald-500 focus:ring-emerald-500 dark:border-zinc-700 dark:focus:border-emerald-400 dark:focus:ring-emerald-400'
              }`}
              placeholder="1"
            />
          </div>
          <div>
            <label htmlFor="bigBlind" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Big Blind (CRISPS)
            </label>
            <input
              ref={bigBlindRef}
              type="number"
              inputMode="decimal"
              id="bigBlind"
              name="bigBlind"
              autoComplete="off"
              min="0"
              step="0.000000001"
              value={bigBlindInput}
              onChange={(e) => setBigBlindInput(e.target.value)}
              disabled={isPending}
              aria-invalid={errorField === 'bigBlind'}
              aria-describedby={errorField === 'bigBlind' ? 'form-error' : undefined}
              className={`mt-1 block w-full rounded-md border bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 disabled:bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-100 dark:disabled:bg-zinc-800 ${
                errorField === 'bigBlind'
                  ? 'border-red-500 focus:border-red-500 focus:ring-red-500 dark:border-red-500'
                  : 'border-zinc-300 focus:border-emerald-500 focus:ring-emerald-500 dark:border-zinc-700 dark:focus:border-emerald-400 dark:focus:ring-emerald-400'
              }`}
              placeholder="2"
            />
          </div>
        </div>

        {/* AC-5.13: Error message rendered inline near field */}
        {validationError && (
          <p id="form-error" role="alert" className="text-sm text-red-600 dark:text-red-400">{validationError}</p>
        )}

        {txError && (
          <p className="text-sm text-red-600 dark:text-red-400">{txError}</p>
        )}

        {txState !== 'idle' && (
          <TransactionStatus state={txState} signature={txSignature} />
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={isPending}
            className="flex-1 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:focus:ring-offset-zinc-900"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="flex-1 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-50 dark:focus:ring-offset-zinc-900"
          >
            {isPending ? 'Creating...' : 'Create Table'}
          </button>
        </div>
      </form>
    </div>
  );
}

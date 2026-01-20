'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  type PokerAction,
  formatShortcut,
  SHORTCUT_DEFINITIONS,
  useKeyboardShortcuts,
} from '@/hooks/use-keyboard-shortcuts';

/**
 * Format a chip amount with Intl.NumberFormat.
 * Per AC-6.6: Numeric amounts formatted with Intl.NumberFormat.
 */
function formatChips(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(amount);
}

export interface PokerActionsProps {
  /** Whether it's currently the player's turn */
  isPlayerTurn: boolean;
  /** Current bet to call (0 if check is available) */
  toCall: number;
  /** Minimum raise amount */
  minRaise: number;
  /** Maximum raise amount (player's remaining stack) */
  maxRaise: number;
  /** Current raise amount (controlled) */
  raiseAmount: number;
  /** Callback when raise amount changes */
  onRaiseAmountChange: (amount: number) => void;
  /** Callback when an action is selected */
  onAction: (action: PokerAction, amount?: number) => void;
  /** Whether check is a valid action (no bet to call) */
  canCheck: boolean;
  /** Whether an action is currently being submitted */
  isSubmitting?: boolean;
}

/**
 * Poker action buttons with keyboard shortcuts.
 * Per AC-2.2: Primary actions have single-key shortcuts (F/X/C/R/S).
 * Per AC-2.3: Raise amount adjustable with +/-/arrows, confirmed with Enter.
 * Per AC-3.3: Mobile view prioritizes current player actions.
 * Per AC-5.12: Buttons stay enabled until request starts, show spinner during.
 */
export function PokerActions({
  isPlayerTurn,
  toCall,
  minRaise,
  maxRaise,
  raiseAmount,
  onRaiseAmountChange,
  onAction,
  canCheck,
  isSubmitting = false,
}: PokerActionsProps) {
  const [isRaiseModeInternal, setIsRaiseModeInternal] = useState(false);
  const raiseInputRef = useRef<HTMLInputElement>(null);

  // Compute effective raise mode - automatically false when not player's turn
  // This derived state ensures raise mode UI is hidden when not player's turn
  // The internal state persists so raise mode can resume if turn briefly switches
  const isRaiseMode = isPlayerTurn && isRaiseModeInternal;

  // Focus raise input when entering raise mode
  useEffect(() => {
    if (isRaiseMode) {
      raiseInputRef.current?.focus();
      raiseInputRef.current?.select();
    }
  }, [isRaiseMode]);

  const handleFold = useCallback(() => {
    if (!isSubmitting) onAction('fold');
  }, [onAction, isSubmitting]);

  const handleCheck = useCallback(() => {
    if (!isSubmitting && canCheck) onAction('check');
  }, [onAction, canCheck, isSubmitting]);

  const handleCall = useCallback(() => {
    if (!isSubmitting && !canCheck) onAction('call');
  }, [onAction, canCheck, isSubmitting]);

  const handleRaise = useCallback(() => {
    if (!isSubmitting) {
      if (isRaiseMode) {
        // Confirm raise
        onAction('raise', raiseAmount);
        setIsRaiseModeInternal(false);
      } else {
        // Enter raise mode
        setIsRaiseModeInternal(true);
      }
    }
  }, [onAction, raiseAmount, isRaiseMode, isSubmitting]);

  const handleShove = useCallback(() => {
    if (!isSubmitting) onAction('shove', maxRaise);
  }, [onAction, maxRaise, isSubmitting]);

  const handleIncreaseRaise = useCallback(() => {
    const step = Math.max(minRaise, Math.floor(maxRaise / 10));
    const newAmount = Math.min(raiseAmount + step, maxRaise);
    onRaiseAmountChange(newAmount);
  }, [raiseAmount, minRaise, maxRaise, onRaiseAmountChange]);

  const handleDecreaseRaise = useCallback(() => {
    const step = Math.max(minRaise, Math.floor(maxRaise / 10));
    const newAmount = Math.max(raiseAmount - step, minRaise);
    onRaiseAmountChange(newAmount);
  }, [raiseAmount, minRaise, maxRaise, onRaiseAmountChange]);

  const handleConfirmRaise = useCallback(() => {
    if (isRaiseMode && !isSubmitting) {
      onAction('raise', raiseAmount);
      setIsRaiseModeInternal(false);
    }
  }, [isRaiseMode, raiseAmount, onAction, isSubmitting]);

  // Register keyboard shortcuts (AC-2.2, AC-2.3)
  useKeyboardShortcuts({
    isPlayerTurn: isPlayerTurn && !isSubmitting,
    onAction: {
      fold: handleFold,
      check: canCheck ? handleCheck : undefined,
      call: !canCheck ? handleCall : undefined,
      raise: handleRaise,
      shove: handleShove,
      increaseRaise: isRaiseMode ? handleIncreaseRaise : undefined,
      decreaseRaise: isRaiseMode ? handleDecreaseRaise : undefined,
      confirmRaise: isRaiseMode ? handleConfirmRaise : undefined,
    },
  });

  // Get shortcut display strings
  const foldShortcut = formatShortcut(SHORTCUT_DEFINITIONS.find((d) => d.action === 'fold')!);
  const checkShortcut = formatShortcut(SHORTCUT_DEFINITIONS.find((d) => d.action === 'check')!);
  const callShortcut = formatShortcut(SHORTCUT_DEFINITIONS.find((d) => d.action === 'call')!);
  const raiseShortcut = formatShortcut(SHORTCUT_DEFINITIONS.find((d) => d.action === 'raise')!);
  const shoveShortcut = formatShortcut(SHORTCUT_DEFINITIONS.find((d) => d.action === 'shove')!);

  if (!isPlayerTurn) {
    return (
      <div className="flex items-center justify-center py-2 sm:py-4 text-sm text-zinc-500 dark:text-zinc-400">
        Waiting for your turn…
      </div>
    );
  }

  // AC-3.3: Mobile-responsive button sizing
  const baseButtonClass =
    'h-10 sm:h-12 px-3 sm:px-6 rounded-lg font-medium transition-colors touch-action-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 text-sm sm:text-base';

  return (
    <div className="flex flex-col gap-2 sm:gap-4 p-2 sm:p-4">
      {/* Raise amount input (AC-2.3, AC-5.9, AC-5.10, AC-5.11, AC-5.15) */}
      {isRaiseMode && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDecreaseRaise}
            disabled={raiseAmount <= minRaise || isSubmitting}
            className="h-10 w-10 rounded-lg border border-zinc-300 text-lg font-medium transition-colors hover:bg-zinc-100 active:bg-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
            aria-label="Decrease raise amount"
          >
            −
          </button>
          <div className="relative flex-1">
            {/* AC-5.11: Label wraps input for single hit target */}
            <label className="relative block">
              <span className="sr-only">Raise amount</span>
              <input
                ref={raiseInputRef}
                id="raise-amount"
                type="number"
                inputMode="numeric"
                min={minRaise}
                max={maxRaise}
                value={raiseAmount}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) {
                    onRaiseAmountChange(Math.min(Math.max(val, minRaise), maxRaise));
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleConfirmRaise();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setIsRaiseModeInternal(false);
                  }
                }}
                disabled={isSubmitting}
                className="h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-center font-mono tabular-nums text-zinc-900 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                name="raise-amount"
                autoComplete="off"
                spellCheck={false}
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-zinc-400 pointer-events-none">
                ↑↓
              </span>
            </label>
          </div>
          <button
            type="button"
            onClick={handleIncreaseRaise}
            disabled={raiseAmount >= maxRaise || isSubmitting}
            className="h-10 w-10 rounded-lg border border-zinc-300 text-lg font-medium transition-colors hover:bg-zinc-100 active:bg-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
            aria-label="Increase raise amount"
          >
            +
          </button>
        </div>
      )}

      {/* Action buttons (AC-2.2) - AC-3.3: wrap on mobile, flex on desktop */}
      <div className="flex flex-wrap gap-1.5 sm:gap-2">
        {/* Fold - AC-3.3: Hide kbd on small screens */}
        <button
          type="button"
          onClick={handleFold}
          disabled={isSubmitting}
          className={`${baseButtonClass} border border-zinc-300 text-zinc-700 hover:bg-zinc-100 active:bg-zinc-200 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:active:bg-zinc-700`}
        >
          {isSubmitting ? <Spinner /> : `Fold`}
          <kbd className="ml-1 sm:ml-2 rounded bg-zinc-100 px-1 sm:px-1.5 py-0.5 text-[10px] sm:text-xs dark:bg-zinc-700 hidden sm:inline">
            {foldShortcut}
          </kbd>
        </button>

        {/* Check or Call - AC-3.3: responsive kbd badges */}
        {canCheck ? (
          <button
            type="button"
            onClick={handleCheck}
            disabled={isSubmitting}
            className={`${baseButtonClass} bg-zinc-100 text-zinc-900 hover:bg-zinc-200 active:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700 dark:active:bg-zinc-600`}
          >
            {isSubmitting ? <Spinner /> : `Check`}
            <kbd className="ml-1 sm:ml-2 rounded bg-zinc-200 px-1 sm:px-1.5 py-0.5 text-[10px] sm:text-xs dark:bg-zinc-600 hidden sm:inline">
              {checkShortcut}
            </kbd>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleCall}
            disabled={isSubmitting}
            className={`${baseButtonClass} bg-zinc-100 text-zinc-900 hover:bg-zinc-200 active:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700 dark:active:bg-zinc-600`}
          >
            {isSubmitting ? (
              <Spinner />
            ) : (
              <>
                Call{' '}
                <span className="font-mono tabular-nums">{formatChips(toCall)}</span>
              </>
            )}
            <kbd className="ml-1 sm:ml-2 rounded bg-zinc-200 px-1 sm:px-1.5 py-0.5 text-[10px] sm:text-xs dark:bg-zinc-600 hidden sm:inline">
              {callShortcut}
            </kbd>
          </button>
        )}

        {/* Raise - AC-3.3: responsive */}
        <button
          type="button"
          onClick={handleRaise}
          disabled={isSubmitting}
          className={`${baseButtonClass} ${
            isRaiseMode
              ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
              : 'bg-zinc-200 text-zinc-900 hover:bg-zinc-300 active:bg-zinc-400 dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600 dark:active:bg-zinc-500'
          }`}
        >
          {isSubmitting ? (
            <Spinner />
          ) : isRaiseMode ? (
            <>
              Confirm <span className="font-mono tabular-nums">{formatChips(raiseAmount)}</span>
            </>
          ) : (
            'Raise'
          )}
          <kbd className="ml-1 sm:ml-2 rounded bg-zinc-300 px-1 sm:px-1.5 py-0.5 text-[10px] sm:text-xs dark:bg-zinc-500 hidden sm:inline">
            {isRaiseMode ? 'Enter' : raiseShortcut}
          </kbd>
        </button>

        {/* All In - AC-3.3: responsive */}
        <button
          type="button"
          onClick={handleShove}
          disabled={isSubmitting}
          className={`${baseButtonClass} bg-zinc-900 text-white hover:bg-zinc-800 active:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:active:bg-zinc-300`}
        >
          {isSubmitting ? (
            <Spinner />
          ) : (
            <>
              <span className="hidden sm:inline">All In</span>
              <span className="sm:hidden">All</span>
              {' '}<span className="font-mono tabular-nums">{formatChips(maxRaise)}</span>
            </>
          )}
          <kbd className="ml-1 sm:ml-2 rounded bg-zinc-700 px-1 sm:px-1.5 py-0.5 text-[10px] sm:text-xs text-zinc-300 dark:bg-zinc-300 dark:text-zinc-700 hidden sm:inline">
            {shoveShortcut}
          </kbd>
        </button>
      </div>
    </div>
  );
}

/**
 * Loading spinner for button states.
 * Per AC-5.12: Show spinner during requests.
 */
function Spinner() {
  return (
    <svg
      className="h-5 w-5 animate-spin"
      xmlns="http://www.w3.org/2000/svg"
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

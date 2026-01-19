'use client';

/**
 * Confirmation modal for destructive actions.
 *
 * AC-5.7: Destructive actions (leave table, concede) require confirmation or undo.
 * AC-2.4: Esc closes modals; focus is always visible.
 * AC-5.5: Motion honors prefers-reduced-motion.
 */

import { useCallback, useEffect, useRef } from 'react';

export interface ConfirmationModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Title of the modal */
  title: string;
  /** Description/message explaining the action */
  message: string;
  /** Label for the confirm button */
  confirmLabel?: string;
  /** Label for the cancel button */
  cancelLabel?: string;
  /** Whether this is a destructive action (affects button styling) */
  isDestructive?: boolean;
  /** Callback when user confirms */
  onConfirm: () => void;
  /** Callback when user cancels */
  onCancel: () => void;
}

export function ConfirmationModal({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDestructive = false,
  onConfirm,
  onCancel,
}: ConfirmationModalProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  // Focus the cancel button when modal opens (safer default for destructive actions)
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        cancelButtonRef.current?.focus();
      });
    }
  }, [isOpen]);

  // Handle keyboard navigation (AC-2.4)
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      } else if (event.key === 'Tab') {
        // Trap focus within modal
        const firstFocusable = cancelButtonRef.current;
        const lastFocusable = confirmButtonRef.current;

        if (event.shiftKey && document.activeElement === firstFocusable) {
          event.preventDefault();
          lastFocusable?.focus();
        } else if (!event.shiftKey && document.activeElement === lastFocusable) {
          event.preventDefault();
          firstFocusable?.focus();
        }
      }
    },
    [onCancel]
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirmation-modal-title"
      aria-describedby="confirmation-modal-description"
    >
      {/* AC-5.5: Motion-safe animation */}
      <div
        className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl dark:bg-zinc-900 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h2
          id="confirmation-modal-title"
          className="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
        >
          {title}
        </h2>
        <p
          id="confirmation-modal-description"
          className="mt-2 text-sm text-zinc-600 dark:text-zinc-400"
        >
          {message}
        </p>

        <div className="mt-6 flex gap-3">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            className="flex-1 h-10 rounded-lg border border-zinc-300 text-zinc-700 transition-colors hover:bg-zinc-100 active:bg-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={onConfirm}
            className={`flex-1 h-10 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${
              isDestructive
                ? 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 focus-visible:outline-red-500 dark:bg-red-700 dark:hover:bg-red-600'
                : 'bg-zinc-900 text-white hover:bg-zinc-800 active:bg-zinc-700 focus-visible:outline-zinc-500 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

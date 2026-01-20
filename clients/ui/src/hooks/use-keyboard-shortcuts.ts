'use client';

import { useEffect, useCallback, useRef } from 'react';

/**
 * Poker action types for keyboard shortcuts.
 * Per AC-2.2: Primary actions have single-key shortcuts when player's turn.
 */
export type PokerAction = 'fold' | 'check' | 'call' | 'raise' | 'shove';

/**
 * Global action types for command palette and navigation.
 * Per AC-2.1: Command palette actions include connect wallet, join/leave table, etc.
 */
export type GlobalAction =
  | 'openCommandPalette'
  | 'closeModal'
  | 'connectWallet'
  | 'joinTable'
  | 'leaveTable'
  | 'startHand';

export type ShortcutAction = PokerAction | GlobalAction | 'increaseRaise' | 'decreaseRaise' | 'confirmRaise';

/**
 * Shortcut definition with key, modifiers, and conditions.
 */
export interface ShortcutDefinition {
  key: string;
  modifiers?: {
    ctrl?: boolean;
    meta?: boolean;
    shift?: boolean;
    alt?: boolean;
  };
  /** Whether the shortcut requires Cmd (Mac) or Ctrl (Windows/Linux) */
  cmdOrCtrl?: boolean;
  /** Action to dispatch when shortcut is triggered */
  action: ShortcutAction;
  /** Human-readable label for display in command palette */
  label: string;
  /** Whether shortcut only activates when no input is focused */
  requireNoFocus?: boolean;
  /** Whether shortcut only activates during player's turn */
  requirePlayerTurn?: boolean;
}

/**
 * Complete shortcut mapping for the poker UI.
 * Per AC-2.1, AC-2.2, AC-2.3: All primary actions have keyboard shortcuts.
 */
export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  // Global shortcuts (AC-2.1)
  {
    key: 'k',
    cmdOrCtrl: true,
    action: 'openCommandPalette',
    label: 'Open Command Palette',
  },
  {
    key: 'Escape',
    action: 'closeModal',
    label: 'Close Modal',
  },

  // Poker action shortcuts (AC-2.2)
  {
    key: 'f',
    action: 'fold',
    label: 'Fold',
    requireNoFocus: true,
    requirePlayerTurn: true,
  },
  {
    key: 'x',
    action: 'check',
    label: 'Check',
    requireNoFocus: true,
    requirePlayerTurn: true,
  },
  {
    key: 'c',
    action: 'call',
    label: 'Call',
    requireNoFocus: true,
    requirePlayerTurn: true,
  },
  {
    key: 'r',
    action: 'raise',
    label: 'Raise',
    requireNoFocus: true,
    requirePlayerTurn: true,
  },
  {
    key: 's',
    action: 'shove',
    label: 'All In',
    requireNoFocus: true,
    requirePlayerTurn: true,
  },

  // Raise amount adjustment (AC-2.3)
  {
    key: 'ArrowUp',
    action: 'increaseRaise',
    label: 'Increase Raise',
    requireNoFocus: true,
    requirePlayerTurn: true,
  },
  {
    key: 'ArrowDown',
    action: 'decreaseRaise',
    label: 'Decrease Raise',
    requireNoFocus: true,
    requirePlayerTurn: true,
  },
  {
    key: '+',
    action: 'increaseRaise',
    label: 'Increase Raise',
    requireNoFocus: true,
    requirePlayerTurn: true,
  },
  {
    key: '-',
    action: 'decreaseRaise',
    label: 'Decrease Raise',
    requireNoFocus: true,
    requirePlayerTurn: true,
  },
  {
    key: '=',
    action: 'increaseRaise',
    label: 'Increase Raise',
    requireNoFocus: true,
    requirePlayerTurn: true,
  },
  {
    key: 'Enter',
    action: 'confirmRaise',
    label: 'Confirm Raise',
    requireNoFocus: true,
    requirePlayerTurn: true,
  },
];

/**
 * Get all shortcut definitions for a specific action.
 */
export function getShortcutsForAction(action: ShortcutAction): ShortcutDefinition[] {
  return SHORTCUT_DEFINITIONS.filter((def) => def.action === action);
}

/**
 * Get display string for a shortcut (e.g., "⌘K" or "Ctrl+K").
 */
export function formatShortcut(def: ShortcutDefinition): string {
  const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac');
  const parts: string[] = [];

  if (def.cmdOrCtrl) {
    parts.push(isMac ? '⌘' : 'Ctrl');
  }
  if (def.modifiers?.ctrl) {
    parts.push('Ctrl');
  }
  if (def.modifiers?.meta) {
    parts.push(isMac ? '⌘' : 'Win');
  }
  if (def.modifiers?.shift) {
    parts.push('Shift');
  }
  if (def.modifiers?.alt) {
    parts.push(isMac ? '⌥' : 'Alt');
  }

  // Format special keys
  const keyDisplay =
    def.key === 'Escape'
      ? 'Esc'
      : def.key === 'ArrowUp'
        ? '↑'
        : def.key === 'ArrowDown'
          ? '↓'
          : def.key.toUpperCase();

  parts.push(keyDisplay);

  return parts.join(isMac ? '' : '+');
}

export interface UseKeyboardShortcutsOptions {
  /** Whether the player is currently in turn (enables poker action shortcuts) */
  isPlayerTurn?: boolean;
  /** Handlers for each action */
  onAction?: Partial<Record<ShortcutAction, () => void>>;
  /** Whether shortcuts are globally enabled */
  enabled?: boolean;
}

/**
 * Hook to handle keyboard shortcuts for the poker UI.
 * Per AC-2.1, AC-2.2, AC-2.3, AC-2.4.
 */
export function useKeyboardShortcuts({
  isPlayerTurn = false,
  onAction = {},
  enabled = true,
}: UseKeyboardShortcutsOptions = {}) {
  const handlersRef = useRef(onAction);

  // Update handlers ref in an effect to avoid accessing ref during render
  useEffect(() => {
    handlersRef.current = onAction;
  });

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      // Check if an input element is focused (AC-2.4: no keyboard trap)
      const activeElement = document.activeElement;
      const isInputFocused =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement instanceof HTMLSelectElement ||
        (activeElement as HTMLElement)?.isContentEditable;

      const isMac = navigator.platform.includes('Mac');

      for (const def of SHORTCUT_DEFINITIONS) {
        // Check key match (case-insensitive for letters)
        const keyMatches =
          event.key.toLowerCase() === def.key.toLowerCase() || event.key === def.key;

        if (!keyMatches) continue;

        // Check modifiers
        if (def.cmdOrCtrl) {
          const cmdOrCtrlPressed = isMac ? event.metaKey : event.ctrlKey;
          if (!cmdOrCtrlPressed) continue;
        }

        if (def.modifiers?.ctrl && !event.ctrlKey) continue;
        if (def.modifiers?.meta && !event.metaKey) continue;
        if (def.modifiers?.shift && !event.shiftKey) continue;
        if (def.modifiers?.alt && !event.altKey) continue;

        // Check conditions
        if (def.requireNoFocus && isInputFocused) continue;
        if (def.requirePlayerTurn && !isPlayerTurn) continue;

        // Execute handler if available
        const handler = handlersRef.current[def.action];
        if (handler) {
          event.preventDefault();
          handler();
          return;
        }
      }
    },
    [enabled, isPlayerTurn],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

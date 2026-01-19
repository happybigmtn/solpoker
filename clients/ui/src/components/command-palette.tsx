'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  type ShortcutAction,
  SHORTCUT_DEFINITIONS,
  formatShortcut,
  useKeyboardShortcuts,
} from '@/hooks/use-keyboard-shortcuts';

/**
 * Command palette item definition.
 */
export interface CommandItem {
  id: string;
  label: string;
  shortcut?: string;
  action: ShortcutAction | (() => void);
  disabled?: boolean;
  category?: string;
}

export interface CommandPaletteProps {
  /** Whether the palette is currently open */
  isOpen: boolean;
  /** Callback when palette should close */
  onClose: () => void;
  /** Callback when an action is selected */
  onAction: (action: ShortcutAction) => void;
  /** Additional custom commands */
  customCommands?: CommandItem[];
  /** Whether player is currently in turn (affects available actions) */
  isPlayerTurn?: boolean;
  /** Whether wallet is connected */
  isConnected?: boolean;
}

/**
 * Superhuman-style command palette.
 * Per AC-2.1: Global shortcut (Cmd/Ctrl+K) opens palette with all actions.
 * Per AC-5.3: Announces updates with aria-live.
 * Per AC-4.10: Uses uncontrolled input to avoid heavy re-renders.
 */
export function CommandPalette({
  isOpen,
  onClose,
  onAction,
  customCommands = [],
  isPlayerTurn = false,
  isConnected = false,
}: CommandPaletteProps) {
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Build command list from shortcut definitions + custom commands
  const commands = useMemo<CommandItem[]>(() => {
    const baseCommands: CommandItem[] = [];

    // Wallet commands
    if (!isConnected) {
      baseCommands.push({
        id: 'connectWallet',
        label: 'Connect Wallet',
        action: 'connectWallet',
        category: 'Wallet',
      });
    }

    // Table commands
    baseCommands.push(
      {
        id: 'joinTable',
        label: 'Join Table',
        action: 'joinTable',
        category: 'Table',
        disabled: !isConnected,
      },
      {
        id: 'leaveTable',
        label: 'Leave Table',
        action: 'leaveTable',
        category: 'Table',
        disabled: !isConnected,
      },
      {
        id: 'startHand',
        label: 'Start Hand',
        action: 'startHand',
        category: 'Table',
        disabled: !isConnected,
      },
    );

    // Poker action commands (only when in turn)
    const pokerActions: CommandItem[] = [
      {
        id: 'fold',
        label: 'Fold',
        shortcut: formatShortcut(SHORTCUT_DEFINITIONS.find((d) => d.action === 'fold')!),
        action: 'fold',
        category: 'Actions',
        disabled: !isPlayerTurn,
      },
      {
        id: 'check',
        label: 'Check',
        shortcut: formatShortcut(SHORTCUT_DEFINITIONS.find((d) => d.action === 'check')!),
        action: 'check',
        category: 'Actions',
        disabled: !isPlayerTurn,
      },
      {
        id: 'call',
        label: 'Call',
        shortcut: formatShortcut(SHORTCUT_DEFINITIONS.find((d) => d.action === 'call')!),
        action: 'call',
        category: 'Actions',
        disabled: !isPlayerTurn,
      },
      {
        id: 'raise',
        label: 'Raise',
        shortcut: formatShortcut(SHORTCUT_DEFINITIONS.find((d) => d.action === 'raise')!),
        action: 'raise',
        category: 'Actions',
        disabled: !isPlayerTurn,
      },
      {
        id: 'shove',
        label: 'All In',
        shortcut: formatShortcut(SHORTCUT_DEFINITIONS.find((d) => d.action === 'shove')!),
        action: 'shove',
        category: 'Actions',
        disabled: !isPlayerTurn,
      },
    ];

    return [...baseCommands, ...pokerActions, ...customCommands];
  }, [isConnected, isPlayerTurn, customCommands]);

  // Filter commands by search string
  const filteredCommands = useMemo(() => {
    if (!filter.trim()) return commands;
    const lowerFilter = filter.toLowerCase();
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(lowerFilter) ||
        cmd.category?.toLowerCase().includes(lowerFilter),
    );
  }, [commands, filter]);

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  // Focus input when palette opens
  useEffect(() => {
    if (isOpen) {
      setFilter('');
      setSelectedIndex(0);
      // Delay focus to ensure modal is rendered
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setSelectedIndex((prev) =>
            prev < filteredCommands.length - 1 ? prev + 1 : 0,
          );
          break;
        case 'ArrowUp':
          event.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : filteredCommands.length - 1,
          );
          break;
        case 'Enter': {
          event.preventDefault();
          const selected = filteredCommands[selectedIndex];
          if (selected && !selected.disabled) {
            if (typeof selected.action === 'function') {
              selected.action();
            } else {
              onAction(selected.action);
            }
            onClose();
          }
          break;
        }
        case 'Escape':
          event.preventDefault();
          onClose();
          break;
        case 'Tab':
          // Trap focus within palette (AC-2.4)
          event.preventDefault();
          if (event.shiftKey) {
            setSelectedIndex((prev) =>
              prev > 0 ? prev - 1 : filteredCommands.length - 1,
            );
          } else {
            setSelectedIndex((prev) =>
              prev < filteredCommands.length - 1 ? prev + 1 : 0,
            );
          }
          break;
      }
    },
    [filteredCommands, selectedIndex, onAction, onClose],
  );

  // Scroll selected item into view
  useEffect(() => {
    const selectedEl = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    selectedEl?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Handle Escape to close (AC-2.4)
  useKeyboardShortcuts({
    enabled: isOpen,
    onAction: {
      closeModal: onClose,
    },
  });

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      {/* AC-5.5: Motion honors prefers-reduced-motion via CSS */}
      <div
        className="w-full max-w-lg rounded-xl bg-white shadow-2xl dark:bg-zinc-900 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-4 motion-safe:duration-150"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* AC-5.9, AC-5.11: Label with proper association */}
        <div className="flex items-center border-b border-zinc-200 px-4 dark:border-zinc-800">
          <label htmlFor="command-palette-input" className="flex items-center">
            <svg
              className="h-5 w-5 text-zinc-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <span className="sr-only">Search commands</span>
          </label>
          {/* AC-4.10: Uncontrolled input with onChange to avoid heavy re-renders */}
          {/* AC-5.10: Correct input type; AC-5.14: Typographic ellipsis; AC-5.15: autocomplete="off" */}
          <input
            ref={inputRef}
            id="command-palette-input"
            type="search"
            placeholder="Type a command…"
            className="h-14 flex-1 bg-transparent px-3 text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100 dark:placeholder:text-zinc-500"
            onChange={(e) => setFilter(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-autocomplete="list"
            aria-controls="command-palette-list"
            aria-activedescendant={
              filteredCommands[selectedIndex]
                ? `command-${filteredCommands[selectedIndex].id}`
                : undefined
            }
          />
          <kbd className="hidden rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-500 sm:inline dark:bg-zinc-800 dark:text-zinc-400">
            Esc
          </kbd>
        </div>

        {/* AC-5.3: aria-live announces updates */}
        <ul
          ref={listRef}
          id="command-palette-list"
          role="listbox"
          aria-live="polite"
          className="max-h-80 overflow-y-auto overscroll-contain p-2"
        >
          {filteredCommands.length === 0 ? (
            <li className="px-3 py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
              No matching commands
            </li>
          ) : (
            filteredCommands.map((cmd, index) => (
              <li
                key={cmd.id}
                id={`command-${cmd.id}`}
                role="option"
                aria-selected={index === selectedIndex}
                aria-disabled={cmd.disabled}
                className={`flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                  index === selectedIndex
                    ? 'bg-zinc-100 dark:bg-zinc-800'
                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                } ${cmd.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
                onClick={() => {
                  if (!cmd.disabled) {
                    if (typeof cmd.action === 'function') {
                      cmd.action();
                    } else {
                      onAction(cmd.action);
                    }
                    onClose();
                  }
                }}
              >
                <span className="text-zinc-900 dark:text-zinc-100">{cmd.label}</span>
                {cmd.shortcut && (
                  <kbd className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400">
                    {cmd.shortcut}
                  </kbd>
                )}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

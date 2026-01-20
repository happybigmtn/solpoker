/**
 * Tests for CommandPalette component.
 *
 * AC-2.1: Global shortcut (Cmd/Ctrl+K) opens command palette with all actions.
 * AC-2.4: Focus is always visible; no keyboard trap; Esc closes modals/panels.
 * AC-5.3: Announces updates with aria-live.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// Mock useKeyboardShortcuts hook to avoid side effects
vi.mock('@/hooks/use-keyboard-shortcuts', () => ({
  useKeyboardShortcuts: vi.fn(),
  SHORTCUT_DEFINITIONS: [
    { key: 'k', cmdOrCtrl: true, action: 'openCommandPalette', label: 'Open Command Palette' },
    { key: 'Escape', action: 'closeModal', label: 'Close Modal' },
    { key: 'f', action: 'fold', label: 'Fold', requirePlayerTurn: true, requireNoFocus: true },
    { key: 'x', action: 'check', label: 'Check', requirePlayerTurn: true, requireNoFocus: true },
    { key: 'c', action: 'call', label: 'Call', requirePlayerTurn: true, requireNoFocus: true },
    { key: 'r', action: 'raise', label: 'Raise', requirePlayerTurn: true, requireNoFocus: true },
    { key: 's', action: 'shove', label: 'All In', requirePlayerTurn: true, requireNoFocus: true },
  ],
  formatShortcut: vi.fn((shortcut) => {
    if (shortcut.cmdOrCtrl) return `Ctrl+${shortcut.key.toUpperCase()}`;
    if (shortcut.key === 'Escape') return 'Esc';
    return shortcut.key.toUpperCase();
  }),
  getShortcutsForAction: vi.fn(),
}));

import { CommandPalette } from './command-palette';

describe('CommandPalette (AC-2.1, AC-2.4, AC-5.3)', () => {
  const mockOnClose = vi.fn();
  const mockOnAction = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('AC-2.1: Command palette contents', () => {
    it('renders nothing when closed', () => {
      const { container } = render(
        <CommandPalette
          isOpen={false}
          onClose={mockOnClose}
          onAction={mockOnAction}
        />
      );

      expect(container.firstChild).toBeNull();
    });

    it('renders dialog when open', () => {
      render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
        />
      );

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByLabelText('Command palette')).toBeInTheDocument();
    });

    it('shows wallet connect when not connected', () => {
      render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
          isConnected={false}
        />
      );

      expect(screen.getByRole('option', { name: /Connect Wallet/i })).toBeInTheDocument();
    });

    it('hides wallet connect when connected', () => {
      render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
          isConnected={true}
        />
      );

      expect(screen.queryByRole('option', { name: /Connect Wallet/i })).not.toBeInTheDocument();
    });

    it('shows table actions: join, leave, start hand', () => {
      render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
          isConnected={true}
        />
      );

      expect(screen.getByRole('option', { name: /Join Table/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Leave Table/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Start Hand/i })).toBeInTheDocument();
    });

    it('shows poker actions: fold, check, call, raise, all in', () => {
      render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
          isPlayerTurn={true}
        />
      );

      expect(screen.getByRole('option', { name: /Fold/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Check/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Call/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Raise/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /All In/i })).toBeInTheDocument();
    });

    it('shows keyboard shortcuts inline with actions', () => {
      render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
          isPlayerTurn={true}
        />
      );

      // Poker actions should show their shortcut keys
      expect(screen.getByText('F')).toBeInTheDocument(); // Fold shortcut
      expect(screen.getByText('X')).toBeInTheDocument(); // Check shortcut
      expect(screen.getByText('C')).toBeInTheDocument(); // Call shortcut
      expect(screen.getByText('R')).toBeInTheDocument(); // Raise shortcut
      expect(screen.getByText('S')).toBeInTheDocument(); // Shove shortcut
    });

    it('disables poker actions when not player turn', () => {
      render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
          isPlayerTurn={false}
        />
      );

      const foldOption = screen.getByRole('option', { name: /Fold/i });
      expect(foldOption).toHaveAttribute('aria-disabled', 'true');
    });

    it('enables poker actions when player turn', () => {
      render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
          isPlayerTurn={true}
        />
      );

      const foldOption = screen.getByRole('option', { name: /Fold/i });
      expect(foldOption).not.toHaveAttribute('aria-disabled', 'true');
    });
  });

  describe('AC-2.1: Search/filter functionality', () => {
    it('filters commands by search input', () => {
      render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
          isPlayerTurn={true}
        />
      );

      const input = screen.getByRole('searchbox');
      fireEvent.change(input, { target: { value: 'fold' } });

      // Only Fold should remain visible
      expect(screen.getByRole('option', { name: /Fold/i })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: /Check/i })).not.toBeInTheDocument();
    });

    it('filters by category', () => {
      render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
          isConnected={true}
        />
      );

      const input = screen.getByRole('searchbox');
      fireEvent.change(input, { target: { value: 'table' } });

      // Table category actions should be visible
      expect(screen.getByRole('option', { name: /Join Table/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Leave Table/i })).toBeInTheDocument();
    });

    it('shows no results message when filter matches nothing', () => {
      render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
        />
      );

      const input = screen.getByRole('searchbox');
      fireEvent.change(input, { target: { value: 'xyznonexistent' } });

      expect(screen.getByText(/No matching commands/i)).toBeInTheDocument();
    });
  });

  describe('AC-2.4: Keyboard navigation', () => {
    it('navigates with ArrowDown', () => {
      render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
          isConnected={true}
        />
      );

      const input = screen.getByRole('searchbox');
      fireEvent.keyDown(input, { key: 'ArrowDown' });

      // Second item should be selected
      const options = screen.getAllByRole('option');
      expect(options[1]).toHaveAttribute('aria-selected', 'true');
    });

    it('navigates with ArrowUp', () => {
      render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
          isConnected={true}
        />
      );

      const input = screen.getByRole('searchbox');
      // Go down then up
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowUp' });

      // First item should be selected again
      const options = screen.getAllByRole('option');
      expect(options[0]).toHaveAttribute('aria-selected', 'true');
    });

    it('wraps around at the end of list', () => {
      render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
          isConnected={false}
          isPlayerTurn={false}
        />
      );

      const input = screen.getByRole('searchbox');
      // Press ArrowUp from first item to wrap to last
      fireEvent.keyDown(input, { key: 'ArrowUp' });

      const options = screen.getAllByRole('option');
      expect(options[options.length - 1]).toHaveAttribute('aria-selected', 'true');
    });

    it('navigates with Tab (focus trap)', () => {
      render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
          isConnected={true}
        />
      );

      const input = screen.getByRole('searchbox');
      fireEvent.keyDown(input, { key: 'Tab' });

      // Tab should move selection forward (same as ArrowDown)
      const options = screen.getAllByRole('option');
      expect(options[1]).toHaveAttribute('aria-selected', 'true');
    });

    it('navigates with Shift+Tab (reverse)', () => {
      render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
          isConnected={true}
        />
      );

      const input = screen.getByRole('searchbox');
      fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });

      // Shift+Tab should move selection backward (wrap to last)
      const options = screen.getAllByRole('option');
      expect(options[options.length - 1]).toHaveAttribute('aria-selected', 'true');
    });

    it('selects action with Enter', () => {
      render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
          isConnected={true}
        />
      );

      const input = screen.getByRole('searchbox');
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(mockOnAction).toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalled();
    });

    it('does not select disabled action with Enter', () => {
      render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
          isConnected={false} // Not connected = table actions disabled
        />
      );

      const input = screen.getByRole('searchbox');
      // Navigate to a disabled item
      fireEvent.keyDown(input, { key: 'ArrowDown' }); // Move to Join Table (disabled)
      fireEvent.keyDown(input, { key: 'Enter' });

      // Should not trigger action on disabled item
      expect(mockOnAction).not.toHaveBeenCalled();
    });

    it('closes with Escape', () => {
      render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
        />
      );

      const input = screen.getByRole('searchbox');
      fireEvent.keyDown(input, { key: 'Escape' });

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe('AC-2.4: Focus management', () => {
    it('focuses search input when opened', async () => {
      render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
        />
      );

      // Wait for focus to be set (happens in requestAnimationFrame)
      await new Promise((r) => setTimeout(r, 50));

      const input = screen.getByRole('searchbox');
      expect(document.activeElement).toBe(input);
    });

    it('resets filter and selection when re-opened', async () => {
      const { rerender } = render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
        />
      );

      const input = screen.getByRole('searchbox');
      fireEvent.change(input, { target: { value: 'test' } });
      fireEvent.keyDown(input, { key: 'ArrowDown' });

      // Close
      rerender(
        <CommandPalette
          isOpen={false}
          onClose={mockOnClose}
          onAction={mockOnAction}
        />
      );

      // Re-open
      rerender(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
        />
      );

      const newInput = screen.getByRole('searchbox');
      expect(newInput).toHaveValue('');
    });
  });

  describe('AC-5.3: Accessibility - aria-live announcements', () => {
    it('has aria-modal attribute', () => {
      render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
        />
      );

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
    });

    it('has aria-live on command list', () => {
      render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
        />
      );

      const list = screen.getByRole('listbox');
      expect(list).toHaveAttribute('aria-live', 'polite');
    });

    it('uses aria-activedescendant for selection', () => {
      render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
          isConnected={false}
        />
      );

      const input = screen.getByRole('searchbox');
      expect(input).toHaveAttribute('aria-controls', 'command-palette-list');
      expect(input).toHaveAttribute('aria-activedescendant');
    });
  });

  describe('Mouse interaction', () => {
    it('selects action on click', async () => {
      const user = userEvent.setup();
      render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
          isConnected={false}
        />
      );

      const connectWallet = screen.getByRole('option', { name: /Connect Wallet/i });
      await user.click(connectWallet);

      expect(mockOnAction).toHaveBeenCalledWith('connectWallet');
      expect(mockOnClose).toHaveBeenCalled();
    });

    it('closes on backdrop click', async () => {
      const user = userEvent.setup();
      render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
        />
      );

      // Click on the backdrop (the outer div)
      const backdrop = screen.getByRole('dialog');
      await user.click(backdrop);

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('does not close on palette click', async () => {
      const user = userEvent.setup();
      render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
        />
      );

      // Click on the input (inside the palette)
      const input = screen.getByRole('searchbox');
      await user.click(input);

      // Should not close (onClose from backdrop shouldn't fire)
      expect(mockOnClose).toHaveBeenCalledTimes(0);
    });
  });

  describe('Custom commands', () => {
    it('renders custom commands', () => {
      render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
          customCommands={[
            { id: 'custom1', label: 'Custom Action', action: 'fold' },
          ]}
        />
      );

      expect(screen.getByRole('option', { name: /Custom Action/i })).toBeInTheDocument();
    });

    it('executes custom command function', async () => {
      const customFn = vi.fn();
      const user = userEvent.setup();

      render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onAction={mockOnAction}
          customCommands={[
            { id: 'custom1', label: 'Run Custom', action: customFn },
          ]}
        />
      );

      const customOption = screen.getByRole('option', { name: /Run Custom/i });
      await user.click(customOption);

      expect(customFn).toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalled();
    });
  });
});

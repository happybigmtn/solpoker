/**
 * Tests for PokerActions component.
 *
 * AC-2.2: Primary poker actions have single-key shortcuts (F/X/C/R/S).
 * AC-2.3: Raise amount adjustable with +/-/arrows, confirmed with Enter.
 * AC-2.4: Focus visible; Esc closes raise mode.
 * AC-5.12: Buttons stay enabled until request starts; show spinner during.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';

// Track the callback passed to useKeyboardShortcuts
let capturedShortcutCallbacks: Record<string, (() => void) | undefined> = {};

// Mock useKeyboardShortcuts to capture registered callbacks
vi.mock('@/hooks/use-keyboard-shortcuts', () => ({
  useKeyboardShortcuts: vi.fn((config) => {
    capturedShortcutCallbacks = config.onAction || {};
  }),
  SHORTCUT_DEFINITIONS: [
    { key: 'f', action: 'fold', label: 'Fold', requirePlayerTurn: true, requireNoFocus: true },
    { key: 'x', action: 'check', label: 'Check', requirePlayerTurn: true, requireNoFocus: true },
    { key: 'c', action: 'call', label: 'Call', requirePlayerTurn: true, requireNoFocus: true },
    { key: 'r', action: 'raise', label: 'Raise', requirePlayerTurn: true, requireNoFocus: true },
    { key: 's', action: 'shove', label: 'All In', requirePlayerTurn: true, requireNoFocus: true },
    { key: 'ArrowUp', action: 'increaseRaise', label: 'Increase Raise', requirePlayerTurn: true, requireNoFocus: false },
    { key: 'ArrowDown', action: 'decreaseRaise', label: 'Decrease Raise', requirePlayerTurn: true, requireNoFocus: false },
    { key: '+', action: 'increaseRaise', label: 'Increase Raise', requirePlayerTurn: true, requireNoFocus: false },
    { key: '-', action: 'decreaseRaise', label: 'Decrease Raise', requirePlayerTurn: true, requireNoFocus: false },
    { key: 'Enter', action: 'confirmRaise', label: 'Confirm Raise', requirePlayerTurn: true, requireNoFocus: false },
  ],
  formatShortcut: vi.fn((shortcut) => {
    if (shortcut.key === 'ArrowUp') return '↑';
    if (shortcut.key === 'ArrowDown') return '↓';
    return shortcut.key.toUpperCase();
  }),
  getShortcutsForAction: vi.fn(),
}));

import { PokerActions } from './poker-actions';

describe('PokerActions (AC-2.2, AC-2.3, AC-2.4)', () => {
  const mockOnAction = vi.fn();
  const mockOnRaiseAmountChange = vi.fn();

  const defaultProps = {
    isPlayerTurn: true,
    toCall: 100,
    minRaise: 200,
    maxRaise: 1000,
    raiseAmount: 200,
    onRaiseAmountChange: mockOnRaiseAmountChange,
    onAction: mockOnAction,
    canCheck: false,
    isSubmitting: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    capturedShortcutCallbacks = {};
  });

  describe('Rendering based on turn state', () => {
    it('shows waiting message when not player turn', () => {
      render(<PokerActions {...defaultProps} isPlayerTurn={false} />);

      expect(screen.getByText(/Waiting for your turn/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Fold/i })).not.toBeInTheDocument();
    });

    it('shows action buttons when player turn', () => {
      render(<PokerActions {...defaultProps} />);

      expect(screen.getByRole('button', { name: /Fold/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Call/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Raise/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /All In/i })).toBeInTheDocument();
    });

    it('shows Check button when canCheck is true', () => {
      render(<PokerActions {...defaultProps} canCheck={true} toCall={0} />);

      expect(screen.getByRole('button', { name: /Check/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Call/i })).not.toBeInTheDocument();
    });

    it('shows Call button with amount when canCheck is false', () => {
      render(<PokerActions {...defaultProps} canCheck={false} toCall={100} />);

      expect(screen.getByRole('button', { name: /Call.*100/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Check/i })).not.toBeInTheDocument();
    });
  });

  describe('AC-2.2: Single-key shortcuts displayed on buttons', () => {
    it('shows F shortcut on Fold button', () => {
      render(<PokerActions {...defaultProps} />);

      const foldBtn = screen.getByRole('button', { name: /Fold/i });
      expect(within(foldBtn).getByText('F')).toBeInTheDocument();
    });

    it('shows X shortcut on Check button', () => {
      render(<PokerActions {...defaultProps} canCheck={true} />);

      const checkBtn = screen.getByRole('button', { name: /Check/i });
      expect(within(checkBtn).getByText('X')).toBeInTheDocument();
    });

    it('shows C shortcut on Call button', () => {
      render(<PokerActions {...defaultProps} canCheck={false} />);

      const callBtn = screen.getByRole('button', { name: /Call/i });
      expect(within(callBtn).getByText('C')).toBeInTheDocument();
    });

    it('shows R shortcut on Raise button', () => {
      render(<PokerActions {...defaultProps} />);

      const raiseBtn = screen.getByRole('button', { name: /Raise/i });
      expect(within(raiseBtn).getByText('R')).toBeInTheDocument();
    });

    it('shows S shortcut on All In button', () => {
      render(<PokerActions {...defaultProps} />);

      const shoveBtn = screen.getByRole('button', { name: /All In/i });
      expect(within(shoveBtn).getByText('S')).toBeInTheDocument();
    });
  });

  describe('AC-2.2: Keyboard shortcuts trigger actions', () => {
    it('registers fold callback with useKeyboardShortcuts', () => {
      render(<PokerActions {...defaultProps} />);

      expect(capturedShortcutCallbacks.fold).toBeDefined();
      capturedShortcutCallbacks.fold?.();
      expect(mockOnAction).toHaveBeenCalledWith('fold');
    });

    it('registers check callback when canCheck is true', () => {
      render(<PokerActions {...defaultProps} canCheck={true} />);

      expect(capturedShortcutCallbacks.check).toBeDefined();
      capturedShortcutCallbacks.check?.();
      expect(mockOnAction).toHaveBeenCalledWith('check');
    });

    it('registers call callback when canCheck is false', () => {
      render(<PokerActions {...defaultProps} canCheck={false} />);

      expect(capturedShortcutCallbacks.call).toBeDefined();
      capturedShortcutCallbacks.call?.();
      expect(mockOnAction).toHaveBeenCalledWith('call');
    });

    it('registers shove callback', () => {
      render(<PokerActions {...defaultProps} />);

      expect(capturedShortcutCallbacks.shove).toBeDefined();
      capturedShortcutCallbacks.shove?.();
      expect(mockOnAction).toHaveBeenCalledWith('shove', 1000);
    });

    it('passes isPlayerTurn=false to hook when not player turn', async () => {
      // Import the mocked module to check its call arguments
      const { useKeyboardShortcuts } = await import('@/hooks/use-keyboard-shortcuts');
      render(<PokerActions {...defaultProps} isPlayerTurn={false} />);

      // Hook should receive isPlayerTurn: false so it won't activate shortcuts
      expect(useKeyboardShortcuts).toHaveBeenCalledWith(
        expect.objectContaining({ isPlayerTurn: false })
      );
    });
  });

  describe('AC-2.3: Raise mode and amount adjustment', () => {
    it('enters raise mode on first R press', () => {
      render(<PokerActions {...defaultProps} />);

      const raiseBtn = screen.getByRole('button', { name: /Raise/i });
      fireEvent.click(raiseBtn);

      // Raise input should appear
      expect(screen.getByRole('spinbutton', { name: /Raise amount/i })).toBeInTheDocument();
    });

    it('shows raise input with current amount', () => {
      render(<PokerActions {...defaultProps} raiseAmount={500} />);

      const raiseBtn = screen.getByRole('button', { name: /Raise/i });
      fireEvent.click(raiseBtn);

      const input = screen.getByRole('spinbutton', { name: /Raise amount/i });
      expect(input).toHaveValue(500);
    });

    it('shows +/- buttons in raise mode', () => {
      render(<PokerActions {...defaultProps} />);

      const raiseBtn = screen.getByRole('button', { name: /Raise/i });
      fireEvent.click(raiseBtn);

      expect(screen.getByRole('button', { name: /Increase raise amount/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Decrease raise amount/i })).toBeInTheDocument();
    });

    it('increase button calls onRaiseAmountChange', () => {
      render(<PokerActions {...defaultProps} raiseAmount={200} />);

      // Enter raise mode
      const raiseBtn = screen.getByRole('button', { name: /Raise/i });
      fireEvent.click(raiseBtn);

      // Click increase
      const increaseBtn = screen.getByRole('button', { name: /Increase raise amount/i });
      fireEvent.click(increaseBtn);

      expect(mockOnRaiseAmountChange).toHaveBeenCalled();
    });

    it('decrease button calls onRaiseAmountChange', () => {
      render(<PokerActions {...defaultProps} raiseAmount={500} />);

      // Enter raise mode
      const raiseBtn = screen.getByRole('button', { name: /Raise/i });
      fireEvent.click(raiseBtn);

      // Click decrease
      const decreaseBtn = screen.getByRole('button', { name: /Decrease raise amount/i });
      fireEvent.click(decreaseBtn);

      expect(mockOnRaiseAmountChange).toHaveBeenCalled();
    });

    it('decrease button is disabled at minRaise', () => {
      render(<PokerActions {...defaultProps} raiseAmount={200} minRaise={200} />);

      const raiseBtn = screen.getByRole('button', { name: /Raise/i });
      fireEvent.click(raiseBtn);

      const decreaseBtn = screen.getByRole('button', { name: /Decrease raise amount/i });
      expect(decreaseBtn).toBeDisabled();
    });

    it('increase button is disabled at maxRaise', () => {
      render(<PokerActions {...defaultProps} raiseAmount={1000} maxRaise={1000} />);

      const raiseBtn = screen.getByRole('button', { name: /Raise/i });
      fireEvent.click(raiseBtn);

      const increaseBtn = screen.getByRole('button', { name: /Increase raise amount/i });
      expect(increaseBtn).toBeDisabled();
    });

    it('input change updates raise amount', () => {
      render(<PokerActions {...defaultProps} raiseAmount={200} />);

      const raiseBtn = screen.getByRole('button', { name: /Raise/i });
      fireEvent.click(raiseBtn);

      const input = screen.getByRole('spinbutton', { name: /Raise amount/i });
      fireEvent.change(input, { target: { value: '500' } });

      expect(mockOnRaiseAmountChange).toHaveBeenCalledWith(500);
    });

    it('clamps input value to min/max', () => {
      render(<PokerActions {...defaultProps} raiseAmount={200} minRaise={200} maxRaise={1000} />);

      const raiseBtn = screen.getByRole('button', { name: /Raise/i });
      fireEvent.click(raiseBtn);

      const input = screen.getByRole('spinbutton', { name: /Raise amount/i });
      fireEvent.change(input, { target: { value: '5000' } }); // Over max

      // Should clamp to max
      expect(mockOnRaiseAmountChange).toHaveBeenLastCalledWith(1000);
    });

    it('confirms raise on Enter key', () => {
      render(<PokerActions {...defaultProps} raiseAmount={500} />);

      // Enter raise mode
      const raiseBtn = screen.getByRole('button', { name: /Raise/i });
      fireEvent.click(raiseBtn);

      // Press Enter in input
      const input = screen.getByRole('spinbutton', { name: /Raise amount/i });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(mockOnAction).toHaveBeenCalledWith('raise', 500);
    });

    it('cancels raise mode on Escape key (AC-2.4)', () => {
      render(<PokerActions {...defaultProps} />);

      // Enter raise mode
      const raiseBtn = screen.getByRole('button', { name: /Raise/i });
      fireEvent.click(raiseBtn);

      expect(screen.getByRole('spinbutton', { name: /Raise amount/i })).toBeInTheDocument();

      // Press Escape
      const input = screen.getByRole('spinbutton', { name: /Raise amount/i });
      fireEvent.keyDown(input, { key: 'Escape' });

      // Raise input should be hidden
      expect(screen.queryByRole('spinbutton', { name: /Raise amount/i })).not.toBeInTheDocument();
    });

    it('shows Enter shortcut on confirm button in raise mode', () => {
      render(<PokerActions {...defaultProps} />);

      const raiseBtn = screen.getByRole('button', { name: /Raise/i });
      fireEvent.click(raiseBtn);

      // Raise button should now show "Enter" instead of "R"
      const confirmBtn = screen.getByRole('button', { name: /Confirm/i });
      expect(within(confirmBtn).getByText('Enter')).toBeInTheDocument();
    });

    it('registers increaseRaise shortcut in raise mode', () => {
      render(<PokerActions {...defaultProps} />);

      // Enter raise mode
      const raiseBtn = screen.getByRole('button', { name: /Raise/i });
      fireEvent.click(raiseBtn);

      // Callback should be registered now
      expect(capturedShortcutCallbacks.increaseRaise).toBeDefined();
    });

    it('registers decreaseRaise shortcut in raise mode', () => {
      render(<PokerActions {...defaultProps} />);

      // Enter raise mode
      const raiseBtn = screen.getByRole('button', { name: /Raise/i });
      fireEvent.click(raiseBtn);

      expect(capturedShortcutCallbacks.decreaseRaise).toBeDefined();
    });

    it('registers confirmRaise shortcut in raise mode', () => {
      render(<PokerActions {...defaultProps} />);

      // Enter raise mode
      const raiseBtn = screen.getByRole('button', { name: /Raise/i });
      fireEvent.click(raiseBtn);

      expect(capturedShortcutCallbacks.confirmRaise).toBeDefined();
    });
  });

  describe('Button click actions', () => {
    it('Fold button triggers fold action', () => {
      render(<PokerActions {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /Fold/i }));
      expect(mockOnAction).toHaveBeenCalledWith('fold');
    });

    it('Check button triggers check action', () => {
      render(<PokerActions {...defaultProps} canCheck={true} />);

      fireEvent.click(screen.getByRole('button', { name: /Check/i }));
      expect(mockOnAction).toHaveBeenCalledWith('check');
    });

    it('Call button triggers call action', () => {
      render(<PokerActions {...defaultProps} canCheck={false} />);

      fireEvent.click(screen.getByRole('button', { name: /Call/i }));
      expect(mockOnAction).toHaveBeenCalledWith('call');
    });

    it('All In button triggers shove action with maxRaise', () => {
      render(<PokerActions {...defaultProps} maxRaise={1000} />);

      fireEvent.click(screen.getByRole('button', { name: /All In/i }));
      expect(mockOnAction).toHaveBeenCalledWith('shove', 1000);
    });

    it('Raise button enters raise mode on first click', () => {
      render(<PokerActions {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /Raise/i }));

      // Should now be in raise mode
      expect(screen.getByRole('spinbutton', { name: /Raise amount/i })).toBeInTheDocument();
      expect(mockOnAction).not.toHaveBeenCalled();
    });

    it('Raise button confirms on second click (in raise mode)', () => {
      render(<PokerActions {...defaultProps} raiseAmount={500} />);

      // First click enters raise mode
      fireEvent.click(screen.getByRole('button', { name: /Raise/i }));

      // Second click confirms
      fireEvent.click(screen.getByRole('button', { name: /Confirm/i }));

      expect(mockOnAction).toHaveBeenCalledWith('raise', 500);
    });
  });

  describe('AC-5.12: Button states during submission', () => {
    it('disables all buttons when submitting', () => {
      render(<PokerActions {...defaultProps} isSubmitting={true} />);

      // When submitting, text is replaced with spinner so buttons have shortcut as name
      const buttons = screen.getAllByRole('button');
      // All action buttons should be disabled
      buttons.forEach((btn) => {
        expect(btn).toBeDisabled();
      });
    });

    it('shows spinner in buttons when submitting', () => {
      render(<PokerActions {...defaultProps} isSubmitting={true} />);

      // Each button should contain a spinner (svg)
      const spinners = screen.getAllByRole('button').map((btn) =>
        btn.querySelector('svg[class*="animate-spin"]')
      );

      // At least one spinner should be present
      expect(spinners.some((s) => s !== null)).toBe(true);
    });

    it('does not trigger action when submitting', () => {
      render(<PokerActions {...defaultProps} isSubmitting={true} />);

      // When submitting, text is replaced with spinner, so find button containing "F" kbd
      const buttons = screen.getAllByRole('button');
      const foldBtn = buttons.find((btn) => btn.textContent?.includes('F'));
      expect(foldBtn).toBeDefined();
      fireEvent.click(foldBtn!);

      expect(mockOnAction).not.toHaveBeenCalled();
    });

    it('disables raise input controls when submitting', () => {
      const { rerender } = render(<PokerActions {...defaultProps} />);

      // Enter raise mode
      fireEvent.click(screen.getByRole('button', { name: /Raise/i }));

      // Re-render with submitting=true
      rerender(<PokerActions {...defaultProps} isSubmitting={true} />);

      const input = screen.getByRole('spinbutton', { name: /Raise amount/i });
      expect(input).toBeDisabled();
    });
  });

  describe('Raise mode reset', () => {
    it('resets raise mode when turn ends', () => {
      const { rerender } = render(<PokerActions {...defaultProps} isPlayerTurn={true} />);

      // Enter raise mode
      fireEvent.click(screen.getByRole('button', { name: /Raise/i }));
      expect(screen.getByRole('spinbutton', { name: /Raise amount/i })).toBeInTheDocument();

      // Turn ends - raise mode UI should be hidden (component shows "Waiting for your turn")
      rerender(<PokerActions {...defaultProps} isPlayerTurn={false} />);
      expect(screen.queryByRole('spinbutton', { name: /Raise amount/i })).not.toBeInTheDocument();
      expect(screen.getByText(/Waiting for your turn/i)).toBeInTheDocument();

      // When turn returns, raise mode can resume (UX: allows continuing where you left off)
      // This is intentional derived state behavior - isRaiseMode = isPlayerTurn && isRaiseModeInternal
      rerender(<PokerActions {...defaultProps} isPlayerTurn={true} />);
      expect(screen.getByRole('spinbutton', { name: /Raise amount/i })).toBeInTheDocument();
    });
  });

  describe('AC-6.6: Numeric formatting', () => {
    it('formats call amount with number format', () => {
      render(<PokerActions {...defaultProps} toCall={5000} canCheck={false} />);

      // Should display "5,000" with comma
      expect(screen.getByText('5,000')).toBeInTheDocument();
    });

    it('formats All In amount with number format', () => {
      render(<PokerActions {...defaultProps} maxRaise={10000} />);

      expect(screen.getByText('10,000')).toBeInTheDocument();
    });

    it('formats confirm raise amount with number format', () => {
      render(<PokerActions {...defaultProps} raiseAmount={5000} />);

      fireEvent.click(screen.getByRole('button', { name: /Raise/i }));

      // Confirm button should show formatted amount
      expect(screen.getByText('5,000')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('has visible focus styles (AC-2.4)', () => {
      render(<PokerActions {...defaultProps} />);

      const foldBtn = screen.getByRole('button', { name: /Fold/i });
      // Focus-visible classes are present
      expect(foldBtn.className).toContain('focus-visible:outline');
    });

    it('uses touch-action-manipulation for mobile (AC-8.1)', () => {
      render(<PokerActions {...defaultProps} />);

      const foldBtn = screen.getByRole('button', { name: /Fold/i });
      expect(foldBtn.className).toContain('touch-action-manipulation');
    });

    it('raise input has correct inputMode for mobile keyboard', () => {
      render(<PokerActions {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /Raise/i }));

      const input = screen.getByRole('spinbutton', { name: /Raise amount/i });
      expect(input).toHaveAttribute('inputMode', 'numeric');
    });

    it('raise input uses tabular-nums for alignment (AC-6.1)', () => {
      render(<PokerActions {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /Raise/i }));

      const input = screen.getByRole('spinbutton', { name: /Raise amount/i });
      expect(input.className).toContain('tabular-nums');
    });
  });
});

import { describe, it, expect } from 'vitest';
import {
  SHORTCUT_DEFINITIONS,
  getShortcutsForAction,
  formatShortcut,
  type PokerAction,
  type GlobalAction,
  type ShortcutAction,
} from './use-keyboard-shortcuts';

/**
 * Shortcut mapping tests per plan:
 * "Programmatic: shortcut mapping test (unit or e2e) verifies all primary actions"
 *
 * This tests the shortcut definitions (AC-2.1, AC-2.2, AC-2.3) without requiring DOM.
 */
describe('SHORTCUT_DEFINITIONS', () => {
  it('defines all primary poker actions with single-key shortcuts (AC-2.2)', () => {
    const pokerActions: PokerAction[] = ['fold', 'check', 'call', 'raise', 'shove'];

    for (const action of pokerActions) {
      const shortcuts = getShortcutsForAction(action);
      expect(shortcuts.length).toBeGreaterThan(0);

      // Each poker action should have a single-key shortcut (no modifiers)
      const singleKey = shortcuts.find(
        (s) => !s.cmdOrCtrl && !s.modifiers?.ctrl && !s.modifiers?.meta,
      );
      expect(singleKey).toBeDefined();
      expect(singleKey?.requirePlayerTurn).toBe(true);
    }
  });

  it('maps correct keys to poker actions (F/X/C/R/S per AC-2.2)', () => {
    const expectedMappings: Record<string, PokerAction> = {
      f: 'fold',
      x: 'check',
      c: 'call',
      r: 'raise',
      s: 'shove',
    };

    for (const [key, expectedAction] of Object.entries(expectedMappings)) {
      const shortcut = SHORTCUT_DEFINITIONS.find(
        (s) => s.key.toLowerCase() === key && s.action === expectedAction,
      );
      expect(shortcut).toBeDefined();
      expect(shortcut?.action).toBe(expectedAction);
    }
  });

  it('defines command palette shortcut with Cmd/Ctrl+K (AC-2.1)', () => {
    const paletteShortcut = SHORTCUT_DEFINITIONS.find(
      (s) => s.action === 'openCommandPalette',
    );
    expect(paletteShortcut).toBeDefined();
    expect(paletteShortcut?.key.toLowerCase()).toBe('k');
    expect(paletteShortcut?.cmdOrCtrl).toBe(true);
  });

  it('defines Escape to close modals (AC-2.4)', () => {
    const escShortcut = SHORTCUT_DEFINITIONS.find((s) => s.action === 'closeModal');
    expect(escShortcut).toBeDefined();
    expect(escShortcut?.key).toBe('Escape');
  });

  it('defines raise amount adjustment shortcuts (AC-2.3)', () => {
    const increaseShortcuts = getShortcutsForAction('increaseRaise');
    const decreaseShortcuts = getShortcutsForAction('decreaseRaise');
    const confirmShortcut = getShortcutsForAction('confirmRaise');

    // Should have arrow keys and +/- for adjustment
    expect(increaseShortcuts.length).toBeGreaterThanOrEqual(2);
    expect(decreaseShortcuts.length).toBeGreaterThanOrEqual(1);

    // Confirm with Enter
    expect(confirmShortcut.length).toBeGreaterThan(0);
    expect(confirmShortcut[0].key).toBe('Enter');
  });

  it('all poker action shortcuts require no input focus (AC-2.4)', () => {
    const pokerActions: PokerAction[] = ['fold', 'check', 'call', 'raise', 'shove'];

    for (const action of pokerActions) {
      const shortcuts = getShortcutsForAction(action);
      for (const shortcut of shortcuts) {
        expect(shortcut.requireNoFocus).toBe(true);
      }
    }
  });

  it('all shortcuts have a label for display', () => {
    for (const shortcut of SHORTCUT_DEFINITIONS) {
      expect(shortcut.label).toBeDefined();
      expect(shortcut.label.length).toBeGreaterThan(0);
    }
  });
});

describe('formatShortcut', () => {
  it('formats single-key shortcuts as uppercase letter', () => {
    const foldShortcut = SHORTCUT_DEFINITIONS.find((s) => s.action === 'fold')!;
    const formatted = formatShortcut(foldShortcut);
    expect(formatted).toBe('F');
  });

  it('formats Escape as Esc', () => {
    const escShortcut = SHORTCUT_DEFINITIONS.find((s) => s.action === 'closeModal')!;
    const formatted = formatShortcut(escShortcut);
    expect(formatted).toBe('Esc');
  });

  it('formats arrow keys with symbols', () => {
    const upShortcut = SHORTCUT_DEFINITIONS.find(
      (s) => s.key === 'ArrowUp' && s.action === 'increaseRaise',
    )!;
    const formatted = formatShortcut(upShortcut);
    expect(formatted).toBe('↑');
  });

  it('includes Ctrl prefix for cmdOrCtrl shortcuts on non-Mac', () => {
    // Mock non-Mac platform
    const originalPlatform = Object.getOwnPropertyDescriptor(
      globalThis.navigator,
      'platform',
    );
    Object.defineProperty(globalThis.navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    });

    const paletteShortcut = SHORTCUT_DEFINITIONS.find(
      (s) => s.action === 'openCommandPalette',
    )!;
    const formatted = formatShortcut(paletteShortcut);
    expect(formatted).toBe('Ctrl+K');

    // Restore
    if (originalPlatform) {
      Object.defineProperty(globalThis.navigator, 'platform', originalPlatform);
    }
  });
});

describe('getShortcutsForAction', () => {
  it('returns all shortcuts for a given action', () => {
    const increaseShortcuts = getShortcutsForAction('increaseRaise');

    // Should include ArrowUp, +, and =
    const keys = increaseShortcuts.map((s) => s.key);
    expect(keys).toContain('ArrowUp');
    expect(keys).toContain('+');
    expect(keys).toContain('=');
  });

  it('returns empty array for unknown action', () => {
    const shortcuts = getShortcutsForAction('unknownAction' as ShortcutAction);
    expect(shortcuts).toEqual([]);
  });
});

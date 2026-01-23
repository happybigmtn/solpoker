/**
 * CSS compliance checks for UI spec primitives.
 *
 * AC-UI5.4: Reduced motion preference disables non-essential motion.
 * AC-UI6.2: Safe-area inset utilities are available.
 * AC-UI6.3: Touch-action manipulation utility is available.
 * AC-UI8.2: Focus indicators are visible via :focus-visible.
 * AC-UI1.2: Tabular numerals utility exists for numeric UI.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf-8');

function getCssVar(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) {
    throw new Error(`Missing CSS variable: --${name}`);
  }
  return match[1].trim();
}

type Rgba = { r: number; g: number; b: number; a: number };

function parseColor(input: string): Rgba {
  const value = input.trim();
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return { r, g, b, a: 1 };
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return { r, g, b, a: 1 };
    }
  }
  if (value.startsWith('rgb')) {
    const inner = value
      .replace('rgba(', '')
      .replace('rgb(', '')
      .replace(')', '');
    const parts = inner.split(',').map((part) => part.trim());
    const r = Number(parts[0]);
    const g = Number(parts[1]);
    const b = Number(parts[2]);
    const a = parts.length > 3 ? Number(parts[3]) : 1;
    return { r, g, b, a: Number.isNaN(a) ? 1 : a };
  }
  throw new Error(`Unsupported color format: ${input}`);
}

function composite(foreground: Rgba, background: Rgba): Rgba {
  if (foreground.a >= 1) return foreground;
  const alpha = foreground.a;
  return {
    r: Math.round(foreground.r * alpha + background.r * (1 - alpha)),
    g: Math.round(foreground.g * alpha + background.g * (1 - alpha)),
    b: Math.round(foreground.b * alpha + background.b * (1 - alpha)),
    a: 1,
  };
}

function relativeLuminance({ r, g, b }: Rgba): number {
  const toLinear = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const rLin = toLinear(r);
  const gLin = toLinear(g);
  const bLin = toLinear(b);
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

function contrastRatio(fg: Rgba, bg: Rgba): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('globals.css UI spec utilities', () => {
  it('defines core UI palette variables (AC-UI1.1)', () => {
    const requiredVars = [
      'surface-void',
      'surface-elevated',
      'surface-hover',
      'text-primary',
      'text-secondary',
      'text-muted',
      'accent-gold',
      'accent-bone',
      'accent-crimson',
      'accent-ink',
      'signal-confirm',
      'signal-pending',
      'signal-error',
    ];

    for (const name of requiredVars) {
      expect(() => getCssVar(name)).not.toThrow();
    }
  });

  it('defines typography tokens for display/body/numeric (AC-UI1.2)', () => {
    expect(() => getCssVar('font-display')).not.toThrow();
    expect(() => getCssVar('font-body')).not.toThrow();
    expect(() => getCssVar('font-numeric')).not.toThrow();
  });

  it('meets contrast for primary text on surface (AC-UI1.4)', () => {
    const surface = parseColor(getCssVar('surface-void'));
    const text = parseColor(getCssVar('text-primary'));
    const composedText = composite(text, surface);
    const ratio = contrastRatio(composedText, surface);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('includes safe-area inset utilities (AC-UI6.2)', () => {
    expect(css).toContain('.safe-area-inset-top');
    expect(css).toContain('.safe-area-inset-bottom');
    expect(css).toContain('.safe-area-inset-left');
    expect(css).toContain('.safe-area-inset-right');
    expect(css).toContain('.safe-area-insets');
  });

  it('includes prefers-reduced-motion rules (AC-UI5.4)', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('animation-duration');
    expect(css).toContain('transition-duration');
  });

  it('includes focus-visible styling (AC-UI8.2)', () => {
    expect(css).toContain(':focus-visible');
    expect(css).toContain('outline');
  });

  it('includes tabular numeral utility (AC-UI1.2)', () => {
    expect(css).toContain('.tabular-nums');
    expect(css).toContain('font-variant-numeric');
  });

  it('includes color-blind mode cues (AC-UI8.4)', () => {
    expect(css).toContain('[data-color-blind="true"]');
    expect(css).toContain('data-action-badge');
    expect(css).toContain('data-seat-status');
    expect(css).toContain('outline: 2px dashed');
  });

  it('includes touch-action utility (AC-UI6.3)', () => {
    expect(css).toContain('.touch-action-manipulation');
    expect(css).toContain('touch-action: manipulation');
  });

  it('defines card flip and win animations (AC-UI5.1, AC-UI5.2)', () => {
    expect(css).toContain('@keyframes card-flip');
    expect(css).toContain('.card-flip');
    expect(css).toContain('600ms');
    expect(css).toContain('@keyframes win-pulse');
    expect(css).toContain('.card-winning');
    expect(css).toContain('500ms');
  });

  it('defines dealing overlay animation (AC-UI5.1)', () => {
    expect(css).toContain('@keyframes dealing-pop');
    expect(css).toContain('.dealing-overlay');
    expect(css).toContain('400ms');
  });
});

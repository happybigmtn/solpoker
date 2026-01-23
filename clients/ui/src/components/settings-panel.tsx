'use client';

/**
 * Settings panel with accessibility options.
 *
 * AC-UI8.4: Color-blind mode is available in settings.
 * AC-UI9.2: Non-critical panels can be lazy-loaded.
 */

import { useEffect, useState } from 'react';

export function SettingsPanel() {
  const [colorBlindMode, setColorBlindMode] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('colorBlindMode');
    if (stored !== null) {
      setColorBlindMode(stored === 'true');
    }
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (colorBlindMode) {
      root.setAttribute('data-color-blind', 'true');
    } else {
      root.removeAttribute('data-color-blind');
    }
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('colorBlindMode', colorBlindMode ? 'true' : 'false');
    }
  }, [colorBlindMode]);

  return (
    <div className="rounded-lg bg-zinc-100 p-4 dark:bg-zinc-800">
      <h3 className="font-medium">Settings</h3>
      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
            Color-blind mode
          </p>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            Adds patterns and outlines so states aren&apos;t color-only.
          </p>
        </div>
        <label className="inline-flex items-center gap-2">
          <span className="sr-only">Toggle color-blind mode</span>
          <input
            type="checkbox"
            checked={colorBlindMode}
            onChange={(e) => setColorBlindMode(e.target.checked)}
            className="h-4 w-4 accent-[var(--accent-gold)]"
          />
        </label>
      </div>
    </div>
  );
}

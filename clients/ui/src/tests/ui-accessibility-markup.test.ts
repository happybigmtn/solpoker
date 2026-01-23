/**
 * Markup checks for icon-only buttons and color-blind toggle wiring.
 *
 * AC-UI8.2: Focus indicators + keyboard coverage handled elsewhere.
 * AC-UI8.3: Icon-only buttons include aria-label; decorative icons are aria-hidden.
 * AC-UI8.4: Color-blind mode toggle exists in settings.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const createTableForm = readFileSync(
  resolve(process.cwd(), 'src/components/create-table-form.tsx'),
  'utf-8'
);
const balanceDisplay = readFileSync(
  resolve(process.cwd(), 'src/components/balance-display.tsx'),
  'utf-8'
);
const tableContent = readFileSync(
  resolve(process.cwd(), 'src/app/table/[[...id]]/content.tsx'),
  'utf-8'
);

describe('icon-only buttons + decorative icons', () => {
  it('icon-only buttons include aria-label (AC-UI8.3)', () => {
    expect(createTableForm).toContain('aria-label="Close create table form"');
    expect(balanceDisplay).toContain('aria-label="Refresh balances"');
  });

  it('decorative icons are aria-hidden (AC-UI8.3)', () => {
    expect(createTableForm).toContain('aria-hidden="true"');
    expect(balanceDisplay).toContain('aria-hidden="true"');
  });
});

describe('color-blind mode toggle', () => {
  it('settings include a color-blind mode toggle (AC-UI8.4)', () => {
    expect(tableContent).toContain('Color-blind mode');
    expect(tableContent).toContain('data-color-blind');
  });
});

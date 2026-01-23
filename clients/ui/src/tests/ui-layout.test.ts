/**
 * Static layout checks for responsive/touch requirements.
 *
 * AC-UI6.2: Action bar fixed on mobile and respects safe-area insets.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const content = readFileSync(
  resolve(process.cwd(), 'src/app/table/[[...id]]/content.tsx'),
  'utf-8'
);

describe('table layout classes', () => {
  it('fixes action bar on mobile with safe-area insets (AC-UI6.2)', () => {
    expect(content).toContain('fixed bottom-0');
    expect(content).toContain('safe-area-inset-bottom');
    expect(content).toContain('lg:static');
  });
});

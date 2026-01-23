/**
 * Bundle and lazy-loading checks for table view.
 *
 * AC-UI9.2: JS bundle for table view is <200KB gz; non-critical panels are lazy-loaded.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const content = readFileSync(
  resolve(process.cwd(), 'src/app/table/[[...id]]/content.tsx'),
  'utf-8'
);

describe('table bundle budget (AC-UI9.2)', () => {
  it('lazy-loads non-critical panels', () => {
    expect(content).toContain('const ActionHistory = lazy');
    expect(content).toContain("import('@/components/action-history')");
    expect(content).toContain('const SettingsPanel = lazy');
    expect(content).toContain("import('@/components/settings-panel')");
    expect(content).toContain('<Suspense');
  });

  it('keeps table route chunk under 200KB gz', () => {
    const nextDir = resolve(process.cwd(), '.next');
    if (!existsSync(nextDir)) {
      throw new Error('Missing .next build output. Run `npm run build` before this test.');
    }

    const chunkDir = resolve(
      nextDir,
      'static/chunks/app/table/[[...id]]'
    );

    if (!existsSync(chunkDir)) {
      throw new Error('Missing table route chunk. Run `npm run build` before this test.');
    }

    const chunkFiles = readdirSync(chunkDir).filter(
      (name) => name.startsWith('page-') && name.endsWith('.js')
    );

    expect(chunkFiles.length).toBeGreaterThan(0);

    const combined = chunkFiles
      .map((file) => readFileSync(resolve(chunkDir, file)))
      .reduce((acc, buf) => Buffer.concat([acc, buf]), Buffer.alloc(0));

    const gzBytes = gzipSync(combined).byteLength;
    const budgetBytes = 200 * 1024;

    expect(gzBytes).toBeLessThan(budgetBytes);
  });
});

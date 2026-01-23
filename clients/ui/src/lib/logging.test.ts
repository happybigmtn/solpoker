/**
 * Tests for UI structured logging.
 *
 * AC-OPS1.1: Structured logs include request IDs and table IDs.
 */

import { describe, it, expect } from 'vitest';
import { logUiEvent } from './logging';

describe('logUiEvent (AC-OPS1.1)', () => {
  it('includes request_id and table_id fields', () => {
    const entries: ReturnType<typeof logUiEvent>[] = [];

    logUiEvent('info', 'ui_action', 'UI action', {
      requestId: 'req-ui-1',
      tableId: 99n,
      output: (entry) => entries.push(entry),
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].request_id).toBe('req-ui-1');
    expect(entries[0].table_id).toBe('99');
    expect(entries[0].data).toMatchObject({ service: 'ui' });
  });
});

/**
 * Tests for structured logging schema.
 *
 * AC-OPS1.1: Structured logs include request IDs and table IDs.
 */

import { describe, it, expect } from 'vitest';
import { createStructuredLogEntry, serializeStructuredLogEntry } from './logging.js';

describe('structured logging schema (AC-OPS1.1)', () => {
  it('includes request_id and table_id fields in entries', () => {
    const entry = createStructuredLogEntry('info', 'script', 'Script event', {
      requestId: 123n,
      tableId: 'table-9',
      data: { ok: true },
    });

    expect(entry.request_id).toBe('123');
    expect(entry.table_id).toBe('table-9');
    expect(entry.data).toEqual({ ok: true });
  });

  it('serializes entries with required keys', () => {
    const entry = createStructuredLogEntry('info', 'script', 'Serialized event', {
      requestId: 'req-7',
      tableId: 42,
    });

    const serialized = serializeStructuredLogEntry(entry);
    const parsed = JSON.parse(serialized) as typeof entry;

    expect(parsed.request_id).toBe('req-7');
    expect(parsed.table_id).toBe('42');
    expect(parsed.operation).toBe('script');
    expect(parsed.message).toBe('Serialized event');
  });
});

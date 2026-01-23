export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  operation: string;
  message: string;
  request_id: string | null;
  table_id: string | null;
  data?: Record<string, unknown>;
}

export interface StructuredLogOptions {
  requestId?: string | number | bigint;
  tableId?: string | number | bigint;
  data?: Record<string, unknown>;
  timestamp?: string;
  output?: (entry: StructuredLogEntry, serialized: string) => void;
}

function normalizeLogId(value: string | number | bigint | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return value.toString();
  return value;
}

export function createStructuredLogEntry(
  level: LogLevel,
  operation: string,
  message: string,
  options: StructuredLogOptions = {}
): StructuredLogEntry {
  return {
    timestamp: options.timestamp ?? new Date().toISOString(),
    level,
    operation,
    message,
    request_id: normalizeLogId(options.requestId),
    table_id: normalizeLogId(options.tableId),
    data: options.data,
  };
}

export function serializeStructuredLogEntry(entry: StructuredLogEntry): string {
  return JSON.stringify(entry, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  );
}

export function logStructured(
  level: LogLevel,
  operation: string,
  message: string,
  options: StructuredLogOptions = {}
): StructuredLogEntry {
  const entry = createStructuredLogEntry(level, operation, message, options);
  const serialized = serializeStructuredLogEntry(entry);

  if (options.output) {
    options.output(entry, serialized);
    return entry;
  }

  switch (level) {
    case 'error':
      console.error(serialized);
      break;
    case 'warn':
      console.warn(serialized);
      break;
    default:
      console.log(serialized);
      break;
  }

  return entry;
}

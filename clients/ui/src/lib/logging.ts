import {
  logStructured,
  type LogLevel,
  type StructuredLogEntry,
  type StructuredLogOptions,
} from '@robopoker/client';

export type UiLogOptions = StructuredLogOptions;

export function logUiEvent(
  level: LogLevel,
  operation: string,
  message: string,
  options: UiLogOptions = {}
): StructuredLogEntry {
  return logStructured(level, operation, message, {
    ...options,
    data: { service: 'ui', ...options.data },
  });
}

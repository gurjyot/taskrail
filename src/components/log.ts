import type { LogEvent } from '../types.js';
import { log as formatBaseLog } from '../logging.js';

const sensitiveKey = /(authorization|cookie|password|passwd|secret|token|api[-_]?key|client[-_]?secret)/i;

export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value as object)) return '[Circular]';
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = sensitiveKey.test(key) ? '[REDACTED]' : redact(item, seen);
  }
  return output;
}

export function format(event: LogEvent): string {
  return formatBaseLog({ ...event, data: redact(event.data) });
}

export interface Logger {
  debug(message: string, data?: unknown): string;
  info(message: string, data?: unknown): string;
  warn(message: string, data?: unknown): string;
  error(message: string, data?: unknown): string;
}

export function scoped(scope: string, defaults: Record<string, unknown> = {}): Logger {
  const make = (level: LogEvent['level'], message: string, data?: unknown) => format({
    level,
    scope,
    message,
    data: data === undefined ? defaults : { ...defaults, ...(typeof data === 'object' && data !== null && !Array.isArray(data) ? data as Record<string, unknown> : { value: data }) },
  });
  return {
    debug: (message, data) => make('debug', message, data),
    info: (message, data) => make('info', message, data),
    warn: (message, data) => make('warn', message, data),
    error: (message, data) => make('error', message, data),
  };
}

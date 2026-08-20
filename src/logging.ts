import type { LogEvent } from './types.js';

export function log(event: LogEvent): string {
  return JSON.stringify({
    ts: new Date().toISOString(),
    level: event.level,
    scope: event.scope,
    message: event.message,
    data: event.data,
  });
}

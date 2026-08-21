export interface ComponentDefinition {
  name: string;
  version: string;
  description: string;
  purpose: string;
  stability: 'stable';
  source: string;
}

export const components: readonly ComponentDefinition[] = Object.freeze([
  { name: 'execution', version: '1', description: 'Stable execution context and IDs.', purpose: 'execution identity', stability: 'stable', source: 'execution.ts' },
  { name: 'state', version: '1', description: 'Isolated atomic local state.', purpose: 'local state', stability: 'stable', source: 'execution.ts' },
  { name: 'idempotency', version: '1', description: 'Atomic duplicate protection for side effects.', purpose: 'idempotent execution', stability: 'stable', source: 'execution.ts' },
  { name: 'retry', version: '1', description: 'Bounded retries with exponential backoff and jitter.', purpose: 'transient retry', stability: 'stable', source: 'execution.ts' },
  { name: 'timeout', version: '1', description: 'Hard asynchronous operation timeouts.', purpose: 'operation timeout', stability: 'stable', source: 'execution.ts' },
  { name: 'concurrency', version: '1', description: 'Bounded parallel mapping without a central queue.', purpose: 'bounded parallelism', stability: 'stable', source: 'execution.ts' },
  { name: 'http', version: '1', description: 'Safe generic HTTP with timeout, retry policy, status checks, and bounded responses.', purpose: 'http requests', stability: 'stable', source: 'components/http.ts' },
  { name: 'config', version: '1', description: 'Typed fail-fast configuration access.', purpose: 'configuration', stability: 'stable', source: 'components/config.ts' },
  { name: 'log', version: '1', description: 'Structured logging with secret-shaped key redaction.', purpose: 'structured logging', stability: 'stable', source: 'components/log.ts' },
  { name: 'fs-safe', version: '1', description: 'Atomic private file writes, JSON persistence, and JSONL append.', purpose: 'safe local files', stability: 'stable', source: 'components/fs-safe.ts' },
]);

export function listComponents() {
  return [...components];
}

export function getComponent(name: string) {
  return components.find((component) => component.name === name) ?? null;
}

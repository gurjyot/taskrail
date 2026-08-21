import { mkdir, open, readFile, rename, rm, stat, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { ExecutionPolicy } from './types.js';

export interface ExecutionContext {
  executionId: string;
  automation: string;
  startedAt: string;
  stateDir: string;
}

export interface DecisionRecord {
  ts: string;
  executionId: string;
  automation: string;
  decision: string;
  key?: string;
  reason?: string;
}

export interface HeartbeatRecord {
  automation: string;
  executionId: string;
  status: 'starting' | 'running' | 'ok' | 'failed';
  updatedAt: string;
  details?: string;
}

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter?: boolean;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

export interface IdempotencyClaim {
  claimed: boolean;
  key: string;
  path: string;
}

export interface IdempotentResult<T> {
  executed: boolean;
  value?: T;
}

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 72) || 'item';
}

function stableFileName(value: string) {
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 16);
  return `${safeName(value)}-${digest}`;
}

async function atomicWrite(file: string, content: string) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, content, { mode: 0o600 });
  await rename(temp, file);
}

export function createExecutionContext(automation: string, stateDir = 'state'): ExecutionContext {
  const startedAt = new Date().toISOString();
  const compact = startedAt.replace(/[-:.TZ]/g, '').slice(0, 14);
  return {
    executionId: `${safeName(automation)}-${compact}-${randomUUID().slice(0, 8)}`,
    automation,
    startedAt,
    stateDir: path.resolve(stateDir),
  };
}

export class LocalStateStore {
  constructor(private readonly root: string) {}

  private file(namespace: string, key: string) {
    return path.join(this.root, stableFileName(namespace), `${stableFileName(key)}.json`);
  }

  async get<T>(namespace: string, key: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(this.file(namespace, key), 'utf8')) as T;
    } catch (error: any) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async set(namespace: string, key: string, value: unknown) {
    await atomicWrite(this.file(namespace, key), `${JSON.stringify(value)}\n`);
  }

  async delete(namespace: string, key: string) {
    await rm(this.file(namespace, key), { force: true });
  }
}

export class IdempotencyStore {
  constructor(private readonly root: string) {}

  private file(scope: string, key: string) {
    return path.join(this.root, stableFileName(scope), `${stableFileName(key)}.json`);
  }

  async claim(scope: string, key: string, data: Record<string, unknown> = {}): Promise<IdempotencyClaim> {
    const target = this.file(scope, key);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      const handle = await open(target, 'wx', 0o600);
      try {
        await handle.writeFile(`${JSON.stringify({ key, scope, createdAt: new Date().toISOString(), ...data })}\n`);
      } finally {
        await handle.close();
      }
      return { claimed: true, key, path: target };
    } catch (error: any) {
      if (error?.code === 'EEXIST') return { claimed: false, key, path: target };
      throw error;
    }
  }

  async release(scope: string, key: string) {
    await rm(this.file(scope, key), { force: true });
  }

  async exists(scope: string, key: string) {
    return stat(this.file(scope, key)).then(() => true, () => false);
  }
}

export async function runIdempotent<T>(store: IdempotencyStore, scope: string, key: string, operation: () => Promise<T>): Promise<IdempotentResult<T>> {
  const claim = await store.claim(scope, key);
  if (!claim.claimed) return { executed: false };
  try {
    return { executed: true, value: await operation() };
  } catch (error) {
    await store.release(scope, key);
    throw error;
  }
}

export async function recordDecision(root: string, record: DecisionRecord) {
  const file = path.join(root, 'decisions.jsonl');
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

export async function writeHeartbeat(root: string, record: HeartbeatRecord) {
  await atomicWrite(path.join(root, 'health.json'), `${JSON.stringify(record)}\n`);
}

export async function readHeartbeat(root: string): Promise<HeartbeatRecord | null> {
  try {
    return JSON.parse(await readFile(path.join(root, 'health.json'), 'utf8')) as HeartbeatRecord;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export function heartbeatIsFresh(record: HeartbeatRecord | null, staleAfterMs: number, now = Date.now()) {
  if (!record) return false;
  const updated = Date.parse(record.updatedAt);
  return Number.isFinite(updated) && now - updated <= staleAfterMs;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(operation: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1) throw new Error('maxAttempts must be >= 1');
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= options.maxAttempts || options.shouldRetry?.(error, attempt) === false) throw error;
      const exponential = Math.min(options.maxDelayMs, options.baseDelayMs * (2 ** (attempt - 1)));
      const delay = options.jitter === false ? exponential : Math.floor(Math.random() * (exponential + 1));
      await sleep(delay);
    }
  }
  throw lastError;
}

export async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('timeoutMs must be > 0');
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`operation timed out after ${timeoutMs}ms`);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function mapConcurrent<T, R>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('concurrency limit must be >= 1');
  const results = new Array<R>(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

export function effectiveExecutionPolicy(policy?: ExecutionPolicy): Required<ExecutionPolicy> {
  return {
    timeoutMs: policy?.timeoutMs ?? 300_000,
    maxConcurrency: policy?.maxConcurrency ?? 4,
    staleAfterMs: policy?.staleAfterMs ?? 900_000,
    retry: {
      maxAttempts: policy?.retry?.maxAttempts ?? 3,
      baseDelayMs: policy?.retry?.baseDelayMs ?? 500,
      maxDelayMs: policy?.retry?.maxDelayMs ?? 10_000,
      jitter: policy?.retry?.jitter ?? true,
    },
  };
}

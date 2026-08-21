import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createExecutionContext,
  effectiveExecutionPolicy,
  heartbeatIsFresh,
  IdempotencyStore,
  LocalStateStore,
  mapConcurrent,
  readHeartbeat,
  recordDecision,
  withRetry,
  writeHeartbeat,
} from '../src/execution.js';

async function fixtureDir() {
  return await mkdtemp(path.join(os.tmpdir(), 'taskrail-execution-'));
}

test('execution contexts are unique and automation scoped', () => {
  const first = createExecutionContext('seo-agent', '/tmp/seo-state');
  const second = createExecutionContext('seo-agent', '/tmp/seo-state');
  assert.notEqual(first.executionId, second.executionId);
  assert.match(first.executionId, /^seo-agent-/);
  assert.equal(first.automation, 'seo-agent');
  assert.equal(first.stateDir, '/tmp/seo-state');
});

test('local state store isolates namespaces and writes atomically', async () => {
  const base = await fixtureDir();
  try {
    const state = new LocalStateStore(base);
    await state.set('seo', 'last-post', { slug: 'ai-seo-delhi' });
    await state.set('social', 'last-post', { slug: 'instagram-reel' });
    assert.deepEqual(await state.get('seo', 'last-post'), { slug: 'ai-seo-delhi' });
    assert.deepEqual(await state.get('social', 'last-post'), { slug: 'instagram-reel' });
    await state.delete('seo', 'last-post');
    assert.equal(await state.get('seo', 'last-post'), null);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('idempotency claim has a single winner under parallel calls', async () => {
  const base = await fixtureDir();
  try {
    const store = new IdempotencyStore(base);
    const results = await Promise.all(Array.from({ length: 20 }, () => store.claim('wordpress', 'post:123')));
    assert.equal(results.filter((item) => item.claimed).length, 1);
    assert.equal(await store.exists('wordpress', 'post:123'), true);
    await store.release('wordpress', 'post:123');
    assert.equal((await store.claim('wordpress', 'post:123')).claimed, true);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('decision journal is append only jsonl', async () => {
  const base = await fixtureDir();
  try {
    await recordDecision(base, {
      ts: new Date().toISOString(),
      executionId: 'run-1',
      automation: 'seo-agent',
      decision: 'skip-duplicate',
      key: 'topic:ai-seo',
      reason: 'published previously',
    });
    await recordDecision(base, {
      ts: new Date().toISOString(),
      executionId: 'run-2',
      automation: 'seo-agent',
      decision: 'publish',
      key: 'topic:local-seo',
    });
    const lines = (await readFile(path.join(base, 'decisions.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).decision, 'skip-duplicate');
    assert.equal(JSON.parse(lines[1]).decision, 'publish');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('heartbeat is atomic and freshness is deterministic', async () => {
  const base = await fixtureDir();
  try {
    const updatedAt = '2026-08-21T12:00:00.000Z';
    await writeHeartbeat(base, {
      automation: 'seo-agent',
      executionId: 'run-1',
      status: 'running',
      updatedAt,
    });
    const heartbeat = await readHeartbeat(base);
    assert.equal(heartbeat?.status, 'running');
    assert.equal(heartbeatIsFresh(heartbeat, 60_000, Date.parse('2026-08-21T12:00:30.000Z')), true);
    assert.equal(heartbeatIsFresh(heartbeat, 60_000, Date.parse('2026-08-21T12:02:00.000Z')), false);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('retry succeeds after transient failures with bounded attempts', async () => {
  let calls = 0;
  const value = await withRetry(async () => {
    calls += 1;
    if (calls < 3) throw new Error('transient');
    return 'ok';
  }, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, jitter: false });
  assert.equal(value, 'ok');
  assert.equal(calls, 3);
});

test('concurrency helper never exceeds its limit and preserves order', async () => {
  let active = 0;
  let peak = 0;
  const values = await mapConcurrent([1, 2, 3, 4, 5, 6], 2, async (item) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return item * 2;
  });
  assert.deepEqual(values, [2, 4, 6, 8, 10, 12]);
  assert.equal(peak <= 2, true);
});

test('execution policy has conservative defaults and accepts overrides', () => {
  const defaults = effectiveExecutionPolicy();
  assert.equal(defaults.maxConcurrency, 4);
  assert.equal(defaults.retry.maxAttempts, 3);
  assert.equal(defaults.retry.jitter, true);
  const custom = effectiveExecutionPolicy({ maxConcurrency: 8, retry: { maxAttempts: 5 } });
  assert.equal(custom.maxConcurrency, 8);
  assert.equal(custom.retry.maxAttempts, 5);
});

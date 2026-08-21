import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeHeartbeat } from '../src/execution.js';
import { inspectTarget, inspectTargets, unhealthyTargets } from '../src/supervisor.js';

async function fixtureDir() {
  return await mkdtemp(path.join(os.tmpdir(), 'taskrail-supervisor-'));
}

test('supervisor distinguishes healthy stale failed and missing targets', async () => {
  const base = await fixtureDir();
  const now = Date.parse('2026-08-21T12:00:00.000Z');
  try {
    const healthy = path.join(base, 'healthy');
    const stale = path.join(base, 'stale');
    const failed = path.join(base, 'failed');
    await writeHeartbeat(healthy, {
      automation: 'healthy',
      executionId: 'run-1',
      status: 'ok',
      updatedAt: '2026-08-21T11:59:30.000Z',
    });
    await writeHeartbeat(stale, {
      automation: 'stale',
      executionId: 'run-2',
      status: 'running',
      updatedAt: '2026-08-21T11:50:00.000Z',
    });
    await writeHeartbeat(failed, {
      automation: 'failed',
      executionId: 'run-3',
      status: 'failed',
      updatedAt: '2026-08-21T11:59:50.000Z',
      details: 'upstream unavailable',
    });

    assert.equal((await inspectTarget({ name: 'healthy', stateDir: healthy, staleAfterMs: 60_000 }, now)).status, 'healthy');
    assert.equal((await inspectTarget({ name: 'stale', stateDir: stale, staleAfterMs: 60_000 }, now)).status, 'stale');
    assert.equal((await inspectTarget({ name: 'failed', stateDir: failed, staleAfterMs: 60_000 }, now)).status, 'failed');
    assert.equal((await inspectTarget({ name: 'missing', stateDir: path.join(base, 'missing'), staleAfterMs: 60_000 }, now)).status, 'missing');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('workspace supervision remains bounded and filters unhealthy targets', async () => {
  const base = await fixtureDir();
  const now = Date.parse('2026-08-21T12:00:00.000Z');
  try {
    const a = path.join(base, 'a');
    const b = path.join(base, 'b');
    await writeHeartbeat(a, { automation: 'a', executionId: 'a-1', status: 'ok', updatedAt: '2026-08-21T11:59:50.000Z' });
    await writeHeartbeat(b, { automation: 'b', executionId: 'b-1', status: 'failed', updatedAt: '2026-08-21T11:59:50.000Z' });
    const results = await inspectTargets([
      { name: 'a', stateDir: a, staleAfterMs: 60_000 },
      { name: 'b', stateDir: b, staleAfterMs: 60_000 },
    ], 1, now);
    assert.equal(results.length, 2);
    assert.deepEqual(unhealthyTargets(results).map((item) => item.name), ['b']);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { IdempotencyStore, mapConcurrent, writeHeartbeat } from '../src/execution.js';
import { inspectTargets } from '../src/supervisor.js';

test('supervisor handles 1000 isolated automations without serialization', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-scale-'));
  try {
    const now = new Date().toISOString();
    const targets = Array.from({ length: 1000 }, (_, index) => ({
      name: `agent-${index}`,
      stateDir: path.join(root, `agent-${index}`),
      staleAfterMs: 60_000,
    }));
    await mapConcurrent(targets, 64, async (target, index) => {
      await writeHeartbeat(target.stateDir, {
        automation: target.name,
        executionId: `run-${index}`,
        status: 'ok',
        updatedAt: now,
      });
    });
    const results = await inspectTargets(targets, 128, Date.parse(now) + 1000);
    assert.equal(results.length, 1000);
    assert.equal(results.every((result) => result.status === 'healthy'), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('parallel duplicate claims still have one winner', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-scale-idempotency-'));
  try {
    const store = new IdempotencyStore(root);
    const claims = await Promise.all(Array.from({ length: 250 }, () => store.claim('external-write', 'same-action')));
    assert.equal(claims.filter((claim) => claim.claimed).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

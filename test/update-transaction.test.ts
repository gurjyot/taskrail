import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  canTransitionUpdate,
  createUpdateCheckpoint,
  readUpdateCheckpoint,
  requireRollbackReady,
  rollbackReadiness,
  transitionUpdate,
} from '../src/update-transaction.js';

async function fixtureDir() {
  return await mkdtemp(path.join(os.tmpdir(), 'taskrail-update-'));
}

test('update transaction requires a proven rollback path before activation', async () => {
  const root = await fixtureDir();
  try {
    const created = await createUpdateCheckpoint(root, {
      targetKind: 'capability',
      targetName: 'telegram-send',
      changeClass: 'minor',
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      currentRelease: 'cap-1.0.0',
      currentReleasePath: '/releases/cap-1.0.0',
      lastKnownGoodRelease: 'cap-1.0.0',
      lastKnownGoodReleasePath: '/releases/cap-1.0.0',
      affectedAutomations: ['beta', 'alpha', 'alpha'],
    });
    assert.equal(created.phase, 'discovered');
    assert.deepEqual(created.affectedAutomations, ['alpha', 'beta']);
    assert.equal(canTransitionUpdate('discovered', 'impact-checked'), true);
    assert.equal(canTransitionUpdate('discovered', 'activated'), false);

    await transitionUpdate(root, 'capability', 'telegram-send', 'impact-checked');
    await transitionUpdate(root, 'capability', 'telegram-send', 'checkpointed');
    await transitionUpdate(root, 'capability', 'telegram-send', 'staged');
    await transitionUpdate(root, 'capability', 'telegram-send', 'validated');
    await transitionUpdate(root, 'capability', 'telegram-send', 'simulated');
    await assert.rejects(
      transitionUpdate(root, 'capability', 'telegram-send', 'rollback-ready'),
      /cannot mark rollback ready/,
    );
    assert.equal((await readUpdateCheckpoint(root, 'capability', 'telegram-send'))?.phase, 'simulated');

    await transitionUpdate(root, 'capability', 'telegram-send', 'rollback-ready', 'last known good verified', {
      recovery: {
        previousReleaseVerified: true,
        configurationVerified: true,
        migrationCompatible: true,
      },
    });
    await transitionUpdate(root, 'capability', 'telegram-send', 'activated');
    await transitionUpdate(root, 'capability', 'telegram-send', 'verified');
    const committed = await transitionUpdate(root, 'capability', 'telegram-send', 'committed');
    assert.equal(committed.history.length, 10);
    assert.equal((await readUpdateCheckpoint(root, 'capability', 'telegram-send'))?.phase, 'committed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('invalid transition fails without corrupting the durable checkpoint', async () => {
  const root = await fixtureDir();
  try {
    const created = await createUpdateCheckpoint(root, {
      targetKind: 'automation',
      targetName: 'seo-agent',
      changeClass: 'patch',
      currentRelease: 'rel-a',
      currentReleasePath: '/releases/rel-a',
      lastKnownGoodRelease: 'rel-a',
      lastKnownGoodReleasePath: '/releases/rel-a',
      affectedAutomations: ['seo-agent'],
    });
    await assert.rejects(
      transitionUpdate(root, 'automation', 'seo-agent', 'activated'),
      /invalid update transition/,
    );
    const persisted = await readUpdateCheckpoint(root, 'automation', 'seo-agent');
    assert.equal(persisted?.transactionId, created.transactionId);
    assert.equal(persisted?.phase, 'discovered');
    assert.equal(persisted?.history.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('active or recovery-required transaction cannot be replaced by another update', async () => {
  const root = await fixtureDir();
  try {
    const input = {
      targetKind: 'framework' as const,
      targetName: 'taskrail',
      changeClass: 'minor' as const,
      fromVersion: '2.0.8',
      toVersion: '3.0.0',
      currentRelease: '2.0.8',
      currentReleasePath: '/releases/2.0.8',
      lastKnownGoodRelease: '2.0.8',
      lastKnownGoodReleasePath: '/releases/2.0.8',
      affectedAutomations: [],
    };
    await createUpdateCheckpoint(root, input);
    await assert.rejects(createUpdateCheckpoint(root, input), /active update transaction already exists/);
    await transitionUpdate(root, 'framework', 'taskrail', 'recovery-required', 'simulated interruption');
    await assert.rejects(createUpdateCheckpoint(root, input), /active update transaction already exists/);
    assert.equal(canTransitionUpdate('recovery-required', 'rollback-required'), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rollback after failure is revalidated before restore', async () => {
  const root = await fixtureDir();
  try {
    await createUpdateCheckpoint(root, {
      targetKind: 'automation',
      targetName: 'publisher',
      changeClass: 'breaking',
      currentRelease: 'rel-new',
      currentReleasePath: '/releases/rel-new',
      lastKnownGoodRelease: 'rel-old',
      lastKnownGoodReleasePath: '/releases/rel-old',
      affectedAutomations: ['publisher'],
      recovery: {},
    });
    await transitionUpdate(root, 'automation', 'publisher', 'impact-checked');
    await transitionUpdate(root, 'automation', 'publisher', 'checkpointed');
    await transitionUpdate(root, 'automation', 'publisher', 'rollback-required');
    const blocked = await readUpdateCheckpoint(root, 'automation', 'publisher');
    assert.equal(rollbackReadiness(blocked!).ok, false);
    await assert.rejects(requireRollbackReady(root, 'automation', 'publisher'), /rollback is not ready/);

    const ready = await transitionUpdate(root, 'automation', 'publisher', 'rollback-validated', 'old release verified', {
      recovery: {
        previousReleaseVerified: true,
        configurationVerified: true,
        migrationCompatible: true,
      },
    });
    assert.equal(rollbackReadiness(ready).ok, true);
    await requireRollbackReady(root, 'automation', 'publisher');
    await transitionUpdate(root, 'automation', 'publisher', 'restored');
    const committed = await transitionUpdate(root, 'automation', 'publisher', 'committed', 'rollback committed');
    assert.equal(committed.phase, 'committed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

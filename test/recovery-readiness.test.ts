import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createUpdateCheckpoint, transitionUpdate } from '../src/update-transaction.js';
import { recordRecoveryReadiness, validateLastKnownGoodRecovery } from '../src/recovery-readiness.js';

test('last-known-good recovery is validated before activation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-recovery-'));
  try {
    const release = path.join(root, 'releases', 'good');
    await mkdir(release, { recursive: true });
    await writeFile(path.join(release, 'healthy.txt'), 'ok');
    const readiness = await validateLastKnownGoodRecovery({
      state: {
        targetPath: path.join(root, 'live'),
        lastKnownGoodReleasePath: release,
        lastKnownGoodReleaseId: 'good',
      },
      health: { type: 'file', path: 'healthy.txt' },
      migrationCompatible: true,
    });
    assert.equal(readiness.ok, true);

    let checkpoint = await createUpdateCheckpoint(root, {
      targetKind: 'automation',
      targetName: 'publisher',
      changeClass: 'minor',
      lastKnownGoodRelease: 'good',
      affectedAutomations: ['publisher'],
    });
    checkpoint = await transitionUpdate(root, 'automation', 'publisher', 'impact-checked');
    checkpoint = await transitionUpdate(root, 'automation', 'publisher', 'checkpointed');
    checkpoint = await transitionUpdate(root, 'automation', 'publisher', 'staged');
    checkpoint = await transitionUpdate(root, 'automation', 'publisher', 'validated');
    checkpoint = await transitionUpdate(root, 'automation', 'publisher', 'simulated');
    checkpoint = await recordRecoveryReadiness(root, checkpoint, readiness);
    assert.equal(checkpoint.phase, 'rollback-ready');
    assert.equal(checkpoint.recovery?.previousReleaseVerified, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('missing or unhealthy previous release blocks recovery readiness', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-recovery-'));
  try {
    const missing = await validateLastKnownGoodRecovery({
      state: { targetPath: path.join(root, 'live'), lastKnownGoodReleasePath: path.join(root, 'missing') },
      health: { type: 'file', path: 'healthy.txt' },
      migrationCompatible: true,
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.releaseExists, false);

    const release = path.join(root, 'releases', 'bad');
    await mkdir(release, { recursive: true });
    const unhealthy = await validateLastKnownGoodRecovery({
      state: { targetPath: path.join(root, 'live'), lastKnownGoodReleasePath: release },
      health: { type: 'file', path: 'healthy.txt' },
      migrationCompatible: true,
    });
    assert.equal(unhealthy.ok, false);
    assert.equal(unhealthy.healthVerified, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('migration incompatibility blocks otherwise healthy rollback path', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-recovery-'));
  try {
    const release = path.join(root, 'releases', 'good');
    await mkdir(release, { recursive: true });
    await writeFile(path.join(release, 'healthy.txt'), 'ok');
    const readiness = await validateLastKnownGoodRecovery({
      state: { targetPath: path.join(root, 'live'), lastKnownGoodReleasePath: release },
      health: { type: 'file', path: 'healthy.txt' },
      migrationCompatible: false,
    });
    assert.equal(readiness.ok, false);
    assert.equal(readiness.reasons.some((reason) => reason.includes('migration rollback compatibility')), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

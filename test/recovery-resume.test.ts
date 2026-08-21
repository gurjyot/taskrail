import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createUpdateCheckpoint, transitionUpdate } from '../src/update-transaction.js';
import { recoverInterruptedAutomation } from '../src/recovery-resume.js';
import type { FrameworkManifest } from '../src/types.js';

async function fixture() { return mkdtemp(path.join(os.tmpdir(), 'taskrail-resume-')); }

function manifest(root: string): FrameworkManifest {
  return {
    name: 'demo',
    runtime: 'node',
    managed: true,
    sourceDir: path.join(root, 'src'),
    deployDir: path.join(root, 'live', 'demo'),
    validationCommand: 'node check.js',
    testCommand: 'node check.js',
    healthCheck: { type: 'file', path: 'healthy.txt' },
  };
}

async function writeState(root: string, state: object) {
  await mkdir(path.join(root, 'live'), { recursive: true });
  await writeFile(path.join(root, 'live', 'demo.deploy-state.json'), JSON.stringify(state, null, 2));
}

test('interrupted pre-activation transaction is safely aborted when LKG is still live and healthy', async () => {
  const root = await fixture();
  const lkg = path.join(root, 'releases', 'good');
  const live = path.join(root, 'live', 'demo');
  await mkdir(lkg, { recursive: true });
  await mkdir(live, { recursive: true });
  await writeFile(path.join(lkg, 'healthy.txt'), 'ok');
  await writeFile(path.join(live, 'healthy.txt'), 'ok');
  await writeState(root, { targetPath: live, releasePath: lkg, currentReleaseId: 'good', lastKnownGoodReleaseId: 'good', lastKnownGoodReleasePath: lkg });
  await createUpdateCheckpoint(root, {
    targetKind: 'automation', targetName: 'demo', changeClass: 'patch', currentRelease: 'good', currentReleasePath: lkg,
    lastKnownGoodRelease: 'good', lastKnownGoodReleasePath: lkg, affectedAutomations: ['demo'],
  });
  await transitionUpdate(root, 'automation', 'demo', 'impact-checked');
  await transitionUpdate(root, 'automation', 'demo', 'checkpointed');
  await transitionUpdate(root, 'automation', 'demo', 'staged');

  const result = await recoverInterruptedAutomation(manifest(root), root);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.action, 'aborted-pre-activation');
  assert.equal(result.checkpoint?.phase, 'aborted');
  await rm(root, { recursive: true, force: true });
});

test('interrupted post-activation transaction restores immutable LKG and repairs deployment metadata', async () => {
  const root = await fixture();
  const lkg = path.join(root, 'releases', 'good');
  const newer = path.join(root, 'releases', 'newer');
  const live = path.join(root, 'live', 'demo');
  for (const [dir, marker] of [[lkg, 'good'], [newer, 'newer'], [live, 'newer']] as const) {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'healthy.txt'), 'ok');
    await writeFile(path.join(dir, 'marker.txt'), marker);
  }
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'check.js'), 'process.exit(0)');
  await writeState(root, {
    targetPath: live,
    releasePath: newer,
    currentReleaseId: 'newer',
    lastKnownGoodReleaseId: 'good',
    lastKnownGoodReleasePath: lkg,
  });

  await createUpdateCheckpoint(root, {
    targetKind: 'automation', targetName: 'demo', changeClass: 'breaking', currentRelease: 'newer', currentReleasePath: newer,
    lastKnownGoodRelease: 'good', lastKnownGoodReleasePath: lkg, affectedAutomations: ['demo'],
    recovery: { previousReleaseVerified: true, configurationVerified: true, migrationCompatible: true },
  });
  await transitionUpdate(root, 'automation', 'demo', 'impact-checked');
  await transitionUpdate(root, 'automation', 'demo', 'checkpointed');
  await transitionUpdate(root, 'automation', 'demo', 'staged');
  await transitionUpdate(root, 'automation', 'demo', 'validated');
  await transitionUpdate(root, 'automation', 'demo', 'simulated');
  await transitionUpdate(root, 'automation', 'demo', 'rollback-ready');
  await transitionUpdate(root, 'automation', 'demo', 'activated');
  await transitionUpdate(root, 'automation', 'demo', 'recovery-required', 'process interrupted after activation');

  const result = await recoverInterruptedAutomation(manifest(root), root);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.action, 'restored');
  assert.equal(result.checkpoint?.phase, 'committed');
  assert.equal(await readFile(path.join(live, 'marker.txt'), 'utf8'), 'good');
  const state = JSON.parse(await readFile(path.join(root, 'live', 'demo.deploy-state.json'), 'utf8'));
  assert.equal(state.currentReleaseId, 'good');
  assert.equal(state.releasePath, lkg);
  await rm(root, { recursive: true, force: true });
});

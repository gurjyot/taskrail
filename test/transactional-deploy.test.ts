import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { safeDeploy } from '../src/deployment.js';
import { transactionalDeploy } from '../src/transactional-deploy.js';
import type { FrameworkManifest } from '../src/types.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-transactional-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  return root;
}

function manifest(root: string): FrameworkManifest {
  return {
    name: 'demo',
    runtime: 'node',
    managed: true,
    sourceDir: path.join(root, 'src'),
    deployDir: path.join(root, 'live', 'demo'),
    validationCommand: 'node check.js',
    testCommand: 'node check.js',
    healthCheck: { type: 'command', command: 'node health.js' },
    backup: { retain: 2 },
  };
}

async function writeReleaseSource(root: string, marker: string, healthy = true) {
  await writeFile(path.join(root, 'src', 'check.js'), 'process.exit(0)');
  await writeFile(path.join(root, 'src', 'health.js'), `process.exit(${healthy ? 0 : 1})`);
  await writeFile(path.join(root, 'src', 'marker.txt'), marker);
}

test('transactional update commits only after rollback readiness and health verification', async () => {
  const root = await fixture();
  await writeReleaseSource(root, 'v1');
  const config = manifest(root);
  const initial = await safeDeploy(config, undefined, { projectRoot: root, sourceRevision: 'v1' });
  assert.equal(initial.deployed, true);

  await writeReleaseSource(root, 'v2');
  const result = await transactionalDeploy(config, undefined, { projectRoot: root, sourceRevision: 'v2' });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.checkpoint?.phase, 'committed');
  assert.equal(await readFile(path.join(root, 'live', 'demo', 'marker.txt'), 'utf8'), 'v2');
  const phases = result.checkpoint?.history.map((item) => item.phase) ?? [];
  assert.ok(phases.indexOf('rollback-ready') < phases.indexOf('activated'));
  assert.ok(phases.indexOf('activated') < phases.indexOf('verified'));
  await rm(root, { recursive: true, force: true });
});

test('failed candidate health restores last-known-good and closes transaction safely', async () => {
  const root = await fixture();
  await writeReleaseSource(root, 'v1', true);
  const config = manifest(root);
  const initial = await safeDeploy(config, undefined, { projectRoot: root, sourceRevision: 'v1' });
  assert.equal(initial.deployed, true);

  await writeReleaseSource(root, 'v2-bad', false);
  const result = await transactionalDeploy(config, undefined, { projectRoot: root, sourceRevision: 'v2' });
  assert.equal(result.ok, false);
  assert.equal(result.outcome?.rolledBack, true);
  assert.equal(result.checkpoint?.phase, 'committed');
  assert.equal(await readFile(path.join(root, 'live', 'demo', 'marker.txt'), 'utf8'), 'v1');
  const phases = result.checkpoint?.history.map((item) => item.phase) ?? [];
  assert.ok(phases.includes('rollback-required'));
  assert.ok(phases.includes('rollback-validated'));
  assert.ok(phases.includes('restored'));
  await rm(root, { recursive: true, force: true });
});

test('transactional update refuses first deployment without a recovery point', async () => {
  const root = await fixture();
  await writeReleaseSource(root, 'v1');
  const result = await transactionalDeploy(manifest(root), undefined, { projectRoot: root });
  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
  assert.match(result.reason ?? '', /last-known-good/i);
  await rm(root, { recursive: true, force: true });
});

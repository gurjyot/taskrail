import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installTaskRailDropIn, managedServiceUnits, renderTaskRailDropIn } from '../src/systemd.js';
import { resolveFrameworkManifest } from '../src/framework.js';

test('systemd drop-in instruments services without changing business command', async () => {
  const manifest = resolveFrameworkManifest({
    name: 'demo', profile: 'smg-node-timer@1', runtime: 'node', managed: true,
    sourceDir: '.', deployDir: '/tmp/demo', validationCommand: 'true', testCommand: 'true',
  });
  assert.deepEqual(managedServiceUnits(manifest), ['demo.service']);
  const content = renderTaskRailDropIn(manifest);
  assert.match(content, /taskrail-heartbeat %N starting/);
  assert.match(content, /taskrail-heartbeat %N systemd/);
  assert.match(content, /MemoryMax=512M/);
  assert.match(content, /CPUQuota=100%/);
  assert.match(content, /TasksMax=64/);
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-systemd-'));
  try {
    const file = await installTaskRailDropIn('demo.service', manifest, root);
    assert.equal(await readFile(file, 'utf8'), content);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

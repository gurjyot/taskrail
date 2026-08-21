import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installTaskRailDropIn, managedServiceUnits, renderTaskRailDropIn, systemdIsolationDirectives } from '../src/systemd.js';
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
  assert.doesNotMatch(content, /ProtectSystem=/);
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-systemd-'));
  try {
    const file = await installTaskRailDropIn('demo.service', manifest, root);
    assert.equal(await readFile(file, 'utf8'), content);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('strict isolation renders read-only system with only declared automation write roots', () => {
  const manifest = resolveFrameworkManifest({
    name: 'isolated', profile: 'smg-node-service@1', runtime: 'node', managed: true,
    sourceDir: '.', deployDir: '/opt/apps/isolated', validationCommand: 'true', testCommand: 'true',
    statePath: '/var/lib/taskrail/isolated',
    isolation: {
      level: 'strict',
      writablePaths: ['/var/cache/taskrail/isolated'],
    },
  });
  const directives = systemdIsolationDirectives(manifest);
  assert.equal(directives.includes('ProtectSystem=strict'), true);
  assert.equal(directives.includes('ProtectHome=true'), true);
  assert.equal(directives.includes('PrivateTmp=true'), true);
  assert.equal(directives.includes('NoNewPrivileges=true'), true);
  assert.equal(directives.includes('ReadWritePaths="/var/lib/taskrail/isolated"'), true);
  assert.equal(directives.includes('ReadWritePaths="/var/cache/taskrail/isolated"'), true);
  const content = renderTaskRailDropIn(manifest);
  assert.match(content, /ProtectSystem=strict/);
  assert.match(content, /ReadWritePaths="\/var\/lib\/taskrail\/isolated"/);
  assert.doesNotMatch(content, /ReadWritePaths="\/opt\/apps\/isolated"/);
});

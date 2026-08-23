import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installTaskRailDropIn, managedServiceUnits, renderTaskRailDropIn, systemdIsolationDirectives, verifySystemdOperationalContext, verifySystemdRuntimeContext } from '../src/systemd.js';
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

test('systemd runtime verification detects service-user CHDIR and shared-file failures', () => {
  const manifest = resolveFrameworkManifest({
    name: 'demo', profile: 'smg-node-timer@1', runtime: 'node', managed: true,
    sourceDir: '.', deployDir: '/opt/apps/demo', validationCommand: 'true', testCommand: 'true',
    requiredSharedFiles: ['/opt/shared/.env'],
  });
  const spawn = ((command: string, args: readonly string[]) => {
    if (command === 'systemctl') {
      const property = args.find((arg) => arg.startsWith('--property='))?.slice('--property='.length);
      const values: Record<string, string> = { LoadState: 'loaded', User: 'smg-automation', Group: 'smg-automation', WorkingDirectory: '/opt/apps/demo' };
      return { status: 0, stdout: `${values[property ?? ''] ?? ''}\n`, stderr: '' };
    }
    if ((command === 'runuser' || command === 'sudo') && args.includes('/bin/sh')) return { status: 1, stdout: '', stderr: 'Permission denied' };
    if ((command === 'runuser' || command === 'sudo') && args.includes('/usr/bin/test')) return { status: 1, stdout: '', stderr: 'Permission denied' };
    return { status: 0, stdout: '', stderr: '' };
  }) as any;
  const [check] = verifySystemdRuntimeContext(manifest, { spawn });
  assert.equal(check.unit, 'demo.service');
  assert.equal(check.user, 'smg-automation');
  assert.equal(check.workingDirectory, '/opt/apps/demo');
  assert.equal(check.canTraverseWorkingDirectory, false);
  assert.deepEqual(check.unreadableSharedFiles, ['/opt/shared/.env']);
  assert.equal(check.passed, false);
});

test('systemd runtime verification handles environment-scoped shared-file rules', () => {
  const checkedFiles: string[] = [];
  const manifest = resolveFrameworkManifest({
    name: 'scoped', profile: 'smg-node-timer@1', runtime: 'node', managed: true,
    sourceDir: '.', deployDir: '/opt/apps/scoped', validationCommand: 'true', testCommand: 'true',
    requiredSharedFiles: [
      { path: '/opt/shared/prod.env', environments: ['production'] },
      { path: '/opt/shared/local.env', environments: ['local'] },
    ],
  });
  const spawn = ((command: string, args: readonly string[]) => {
    if (command === 'systemctl') {
      const property = args.find((arg) => arg.startsWith('--property='))?.slice('--property='.length);
      const values: Record<string, string> = { LoadState: 'loaded', User: 'root', Group: 'root', WorkingDirectory: '/opt/apps/scoped' };
      return { status: 0, stdout: `${values[property ?? ''] ?? ''}\n`, stderr: '' };
    }
    if (command === '/usr/bin/test') checkedFiles.push(String(args.at(-1)));
    return { status: 0, stdout: '', stderr: '' };
  }) as any;
  const [check] = verifySystemdRuntimeContext(manifest, { spawn, environment: 'production' });
  assert.equal(check.passed, true);
  assert.deepEqual(checkedFiles, ['/opt/shared/prod.env']);
  assert.deepEqual(check.readableSharedFiles, ['/opt/shared/prod.env']);
  assert.deepEqual(check.unreadableSharedFiles, []);
});

test('systemd operational verification fails when a declared timer is disabled', () => {
  const manifest = resolveFrameworkManifest({ name: 'timer-demo', profile: 'smg-node-timer@1' });
  const spawn = ((command: string, args: readonly string[]) => {
    if (command === 'systemctl' && args[0] === 'show') {
      const property = args.find((arg) => arg.startsWith('--property='))?.slice('--property='.length);
      const values: Record<string, string> = { LoadState: 'loaded', User: 'root', Group: 'root', WorkingDirectory: '/' };
      return { status: 0, stdout: `${values[property ?? ''] ?? ''}\n`, stderr: '' };
    }
    if (command === 'systemctl' && args[0] === 'is-enabled') return { status: 1, stdout: 'disabled\n', stderr: '' };
    if (command === 'systemctl' && args[0] === 'is-active') return { status: 0, stdout: 'active\n', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  }) as any;
  const result = verifySystemdOperationalContext(manifest, { spawn });
  assert.equal(result.runtimeChecks.every((item) => item.passed), true);
  assert.equal(result.timerChecks[0].enabled, false);
  assert.equal(result.passed, false);
});

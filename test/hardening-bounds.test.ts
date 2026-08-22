import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isStale } from '../src/locks.js';
import { runBoundedCommand } from '../src/bounded-command.js';
import { resolveFrameworkManifest } from '../src/framework.js';
import { preflight } from '../src/preflight.js';
import type { FrameworkManifest } from '../src/types.js';

test('a live local lock does not expire because of age', async () => {
  const root = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), 'taskrail-lock-')));
  const lockDir = path.join(root, 'lock');
  await mkdir(lockDir, { recursive: true });
  const lockFile = path.join(lockDir, 'lock.json');
  const host = process.env.HOSTNAME || 'unknown';
  await writeFile(lockFile, JSON.stringify({ pid: process.pid, host, startedAt: new Date(0).toISOString() }));
  const old = new Date(Date.now() - 60 * 60 * 1000);
  await utimes(lockFile, old, old);

  try {
    assert.equal(await isStale({ pid: process.pid, host, startedAt: new Date(0).toISOString() }, lockDir, 1), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('bounded command runner terminates hung commands', async () => {
  const result = await runBoundedCommand({
    command: 'node -e "setTimeout(() => {}, 10000)"',
    cwd: process.cwd(),
    timeoutMs: 50,
    maxOutputBytes: 1024,
  });
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.match(result.message, /timed out/i);
});

test('bounded command runner caps captured output', async () => {
  const result = await runBoundedCommand({
    command: 'node -e "process.stdout.write(\'x\'.repeat(10000))"',
    cwd: process.cwd(),
    timeoutMs: 5_000,
    maxOutputBytes: 128,
  });
  assert.equal(result.ok, true);
  assert.equal(result.truncated, true);
  assert.ok(result.stdout.length < 256);
  assert.match(result.stdout, /TRUNCATED/);
});

test('framework resolution rejects unknown profiles', () => {
  assert.throws(() => resolveFrameworkManifest({
    name: 'example',
    managed: true,
    profile: 'missing-profile@1',
    runtime: 'node',
    sourceDir: '.',
    deployDir: './live',
    validationCommand: 'node -e "process.exit(0)"',
    testCommand: 'node -e "process.exit(0)"',
  }), /unknown TaskRail profile/);
});

test('framework resolution rejects unknown framework capabilities', () => {
  assert.throws(() => resolveFrameworkManifest({
    name: 'example',
    managed: true,
    runtime: 'node',
    sourceDir: '.',
    deployDir: './live',
    validationCommand: 'node -e "process.exit(0)"',
    testCommand: 'node -e "process.exit(0)"',
    frameworkCapabilities: ['change-detections@1'],
  }), /unknown TaskRail framework capability/);
});

test('node runtime profile requires Node 22 or newer', () => {
  const manifest = resolveFrameworkManifest({
    name: 'example',
    managed: true,
    profile: 'portable-node@1',
    runtime: 'node',
    sourceDir: '.',
    deployDir: './live',
    validationCommand: 'node -e "process.exit(0)"',
    testCommand: 'node -e "process.exit(0)"',
  });
  assert.equal(manifest.runtimeVersion, '>=22.0.0');
});

test('preflight resolves relative dependency lockfiles from the automation workspace', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-relative-lockfile-'));
  const manifest: FrameworkManifest = {
    name: 'relative-lockfile',
    managed: true,
    runtime: 'shell',
    sourceDir: '.',
    deployDir: './live',
    validationCommand: 'true',
    testCommand: 'true',
    dependencyManager: { tool: 'npm', lockfile: 'package-lock.json' },
  };

  try {
    await writeFile(path.join(root, 'package-lock.json'), '{}\n');
    await writeFile(path.join(root, 'automation.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const result = await preflight(manifest, root);
    const lockfileCheck = result.checks.find((check) => check.name === 'lockfile:package-lock.json');
    assert.ok(lockfileCheck);
    assert.equal(lockfileCheck.ok, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

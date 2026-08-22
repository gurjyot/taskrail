import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isStale } from '../src/locks.js';
import { runBoundedCommand } from '../src/bounded-command.js';

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

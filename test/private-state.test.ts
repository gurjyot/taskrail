import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readPrivateState, sealLegacyPrivateState, writePrivateState } from '../src/private-state.js';

test('private state is atomic, owner-only on POSIX, and integrity verified', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-private-state-'));
  const file = path.join(root, 'nested', 'deploy-state.json');
  try {
    await writePrivateState(file, { currentReleaseId: 'rel-1', targetPath: 'live' });
    const parsed = JSON.parse(await readFile(file, 'utf8')) as any;
    assert.equal(parsed.currentReleaseId, 'rel-1');
    assert.equal(parsed._taskrailIntegrity.algorithm, 'sha256');
    const restored = await readPrivateState<any>(file, { allowLegacy: false });
    assert.equal(restored?.currentReleaseId, 'rel-1');
    assert.equal(restored?._taskrailIntegrity, undefined);
    if (process.platform !== 'win32') {
      assert.equal((await stat(file)).mode & 0o777, 0o600);
      assert.equal((await stat(path.dirname(file))).mode & 0o777, 0o700);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('tampered private state fails closed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-private-state-'));
  const file = path.join(root, 'state.json');
  try {
    await writePrivateState(file, { currentReleaseId: 'good' });
    const parsed = JSON.parse(await readFile(file, 'utf8')) as any;
    parsed.currentReleaseId = 'attacker-changed';
    await writeFile(file, `${JSON.stringify(parsed, null, 2)}\n`);
    await assert.rejects(readPrivateState(file, { allowLegacy: false }), /integrity verification failed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy state can be sealed without changing its payload contract', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-private-state-'));
  const file = path.join(root, 'legacy.json');
  try {
    await writeFile(file, JSON.stringify({ currentReleaseId: 'legacy' }), { mode: 0o644 });
    assert.equal((await readPrivateState<any>(file))?.currentReleaseId, 'legacy');
    assert.equal(await sealLegacyPrivateState(file), true);
    assert.equal((await readPrivateState<any>(file, { allowLegacy: false }))?.currentReleaseId, 'legacy');
    if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { rollbackFromState } from '../src/deployment.js';

test('legacy deployment state is resealed before rollback and tampering fails closed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-deploy-private-'));
  const target = path.join(root, 'live');
  const backup = path.join(root, 'backup');
  const stateFile = path.join(root, 'deploy-state.json');
  try {
    await mkdir(target, { recursive: true });
    await mkdir(backup, { recursive: true });
    await writeFile(path.join(target, 'old.txt'), 'old');
    await writeFile(path.join(backup, 'healthy.txt'), 'healthy');
    await writeFile(stateFile, JSON.stringify({ targetPath: target, backupPath: backup }, null, 2));

    const restored = await rollbackFromState(stateFile, { type: 'file', path: 'healthy.txt' });
    assert.equal(restored.ok, true);
    const sealed = JSON.parse(await readFile(stateFile, 'utf8'));
    assert.equal(sealed._taskrailIntegrity?.algorithm, 'sha256');
    assert.equal(typeof sealed._taskrailIntegrity?.digest, 'string');

    sealed.targetPath = path.join(root, 'attacker-controlled');
    await writeFile(stateFile, JSON.stringify(sealed, null, 2));
    await assert.rejects(
      rollbackFromState(stateFile, { type: 'file', path: 'healthy.txt' }),
      /integrity verification failed/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

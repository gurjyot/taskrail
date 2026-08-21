import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { auditFleetIsolation } from '../src/isolation-audit.js';

async function writeManifest(base: string, name: string, deployDir: string, statePath: string) {
  const dir = path.join(base, 'automations', name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'automation.json'), `${JSON.stringify({
    name,
    runtime: 'node',
    managed: true,
    sourceDir: '.',
    deployDir,
    statePath,
    validationCommand: 'node --version',
    testCommand: 'node --version',
  }, null, 2)}\n`);
}

test('isolation audit passes distinct automation roots', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'taskrail-isolation-'));
  try {
    await writeManifest(base, 'alpha', path.join(base, 'live', 'alpha'), path.join(base, 'state', 'alpha'));
    await writeManifest(base, 'beta', path.join(base, 'live', 'beta'), path.join(base, 'state', 'beta'));
    const audit = await auditFleetIsolation(base);
    assert.equal(audit.ok, true);
    assert.deepEqual(audit.conflicts, []);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('isolation audit rejects exact managed-root collision', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'taskrail-isolation-'));
  try {
    const shared = path.join(base, 'live', 'shared');
    await writeManifest(base, 'alpha', shared, path.join(base, 'state', 'alpha'));
    await writeManifest(base, 'beta', shared, path.join(base, 'state', 'beta'));
    const audit = await auditFleetIsolation(base);
    assert.equal(audit.ok, false);
    assert.equal(audit.conflicts.some((item) => item.reason === 'same-root'), true);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('isolation audit rejects nested managed roots across automations', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'taskrail-isolation-'));
  try {
    const alphaRoot = path.join(base, 'live', 'alpha');
    await writeManifest(base, 'alpha', alphaRoot, path.join(base, 'state', 'alpha'));
    await writeManifest(base, 'beta', path.join(alphaRoot, 'beta'), path.join(base, 'state', 'beta'));
    const audit = await auditFleetIsolation(base);
    assert.equal(audit.ok, false);
    assert.equal(audit.conflicts.some((item) => item.reason === 'nested-root'), true);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

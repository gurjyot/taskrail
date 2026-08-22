import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { preflight } from '../src/preflight.js';
import type { FrameworkManifest } from '../src/types.js';

test('preflight resolves relative dependency lockfiles from resolved sourceDir', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-preflight-source-'));
  const source = path.join(root, 'framework-managed', 'probe');
  const live = path.join(root, 'live');
  try {
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, 'package-lock.json'), '{}\n');

    const manifest: FrameworkManifest = {
      name: 'probe',
      taskrailCompatibility: '3.0.x',
      runtime: 'node',
      managed: true,
      sourceDir: source,
      deployDir: live,
      validationCommand: 'node --check main.js',
      testCommand: 'node --test',
      dependencyManager: {
        tool: 'npm',
        lockfile: 'package-lock.json',
        manifest: 'package.json',
        installCommand: 'npm ci --omit=dev',
      },
    };

    const result = await preflight(manifest, root);
    const lockfile = result.checks.find((check) => check.name === 'lockfile:package-lock.json');
    assert.equal(lockfile?.ok, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

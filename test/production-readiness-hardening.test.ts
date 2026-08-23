import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { doctor, safeDeploy } from '../src/deployment.js';
import type { FrameworkManifest } from '../src/types.js';
import { validateConfig } from '../src/validation.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-prod-hardening-'));
  const source = path.join(root, 'source');
  const deploy = path.join(root, 'deploy');
  await mkdir(source, { recursive: true });
  await mkdir(deploy, { recursive: true });
  await writeFile(path.join(source, 'check.js'), 'process.exit(0)');
  await writeFile(path.join(source, 'index.txt'), 'new');
  await writeFile(path.join(deploy, 'index.txt'), 'old');
  return { root, source, deploy };
}

function manifest(root: string, source: string, deploy: string, overrides: Partial<FrameworkManifest> = {}): FrameworkManifest {
  return {
    name: 'app',
    runtime: 'node',
    managed: true,
    sourceDir: source,
    deployDir: deploy,
    validationCommand: 'node check.js',
    testCommand: 'node check.js',
    healthCheck: { type: 'file', path: 'index.txt' },
    backup: { retain: 3 },
    requiredChecks: ['validation', 'test'],
    protectedPaths: [],
    ...overrides,
  };
}

test('manifest rejects simultaneous healthCheck and healthChecks', () => {
  const errors = validateConfig({
    projectName: 'app',
    environment: {},
    manifest: {
      name: 'app',
      runtime: 'node',
      managed: true,
      sourceDir: 'src',
      deployDir: 'deploy',
      validationCommand: 'node -e "process.exit(0)"',
      testCommand: 'node -e "process.exit(0)"',
      healthCheck: { type: 'file', path: 'ok' },
      healthChecks: [{ type: 'file', path: 'ok' }],
    },
  });
  assert.ok(errors.some((error) => error.includes('healthCheck or healthChecks')));
});

test('doctor exposes a declared plugin import failure and is not deployable', async () => {
  const { root, source, deploy } = await fixture();
  try {
    const result = await doctor(manifest(root, source, deploy, {
      plugins: [{ name: 'missing', module: './missing-plugin.mjs' }],
    }), { cwd: root });
    assert.equal(result.deployable, false);
    assert.ok(result.pluginError);
    assert.deepEqual(result.plugins, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('plugin validation runs even when requiredChecks is empty', async () => {
  const { root, source, deploy } = await fixture();
  try {
    let validations = 0;
    const result = await safeDeploy(manifest(root, source, deploy, {
      requiredChecks: [],
    }), {
      name: 'policy',
      validate() {
        validations += 1;
        return ['policy rejected candidate'];
      },
    }, { projectRoot: root });
    assert.equal(validations, 1);
    assert.equal(result.deployed, false);
    assert.match(result.failure || '', /plugin validation failed/);
    assert.equal(await readFile(path.join(deploy, 'index.txt'), 'utf8'), 'old');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('post-activation state commit exception restores the previous live files', async () => {
  const { root, source, deploy } = await fixture();
  const statePath = path.join(root, 'app.deploy-state.json');
  try {
    let healthCalls = 0;
    const result = await safeDeploy(manifest(root, source, deploy), {
      name: 'state-fault',
      healthCheck: async () => {
        healthCalls += 1;
        if (healthCalls === 1) await mkdir(statePath);
        return { ok: true };
      },
    }, { projectRoot: root });

    assert.equal(result.deployed, false);
    assert.equal(result.rolledBack, false);
    assert.equal(result.rollbackAttempted, true);
    assert.equal(result.rollbackSucceeded, false);
    assert.equal(result.recoveryRequired, true);
    assert.match(result.failure || '', /state commit failed/);
    assert.equal(await readFile(path.join(deploy, 'index.txt'), 'utf8'), 'old');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

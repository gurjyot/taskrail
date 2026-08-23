import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { rollbackFromState, runHealthCheck, safeDeploy } from '../src/deployment.js';
import { runGate } from '../src/gate.js';
import { readPrivateState } from '../src/private-state.js';
import { transactionalDeploy } from '../src/transactional-deploy.js';
import type { DeployState, FrameworkConfig, FrameworkManifest } from '../src/types.js';
import { validateConfig } from '../src/validation.js';

async function exists(target: string) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function basicFixture(withDeploy = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-final-correctness-'));
  const source = path.join(root, 'source');
  const deploy = path.join(root, 'deploy');
  await mkdir(source, { recursive: true });
  if (withDeploy) {
    await mkdir(deploy, { recursive: true });
    await writeFile(path.join(deploy, 'index.txt'), 'old');
  }
  await writeFile(path.join(source, 'check.js'), 'process.exit(0)');
  await writeFile(path.join(source, 'index.txt'), 'new');
  return { root, source, deploy };
}

function basicManifest(source: string, deploy: string, overrides: Partial<FrameworkManifest> = {}): FrameworkManifest {
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

function configFor(manifest: FrameworkManifest): FrameworkConfig {
  return { projectName: manifest.name, environment: {}, manifest };
}

test('failed live rollback is recovery-required and never reported as rolled back', async () => {
  const { root, source, deploy } = await basicFixture(true);
  try {
    const result = await safeDeploy(basicManifest(source, deploy), {
      name: 'break-rollback',
      healthCheck: async () => {
        const entries = await readdir(root);
        for (const entry of entries.filter((name) => name.startsWith('app.backup-'))) {
          await rm(path.join(root, entry), { recursive: true, force: true });
        }
        return { ok: false, details: 'force activation failure after deleting rollback backup' };
      },
    }, { projectRoot: root });

    assert.equal(result.deployed, false);
    assert.equal(result.rollbackAttempted, true);
    assert.equal(result.rollbackSucceeded, false);
    assert.equal(result.rolledBack, false);
    assert.equal(result.recoveryRequired, true);
    assert.match(result.failure || '', /recovery required/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('failed first deployment cleans partial activation without claiming rollback or recovery target', async () => {
  const { root, source, deploy } = await basicFixture(false);
  try {
    const result = await safeDeploy(basicManifest(source, deploy), {
      name: 'first-deploy-failure',
      healthCheck: () => ({ ok: false, details: 'forced first deploy failure' }),
    }, { projectRoot: root });

    assert.equal(result.deployed, false);
    assert.equal(result.rolledBack, false);
    assert.equal(result.rollbackAttempted, false);
    assert.equal(result.recoveryRequired, false);
    assert.equal(await exists(deploy), false);
    assert.match(result.failure || '', /first deployment cleaned up/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('manual rollback updates current and last-known-good deployment state', async () => {
  const { root, source, deploy } = await basicFixture(false);
  const manifest = basicManifest(source, deploy);
  const stateFile = path.join(root, 'app.deploy-state.json');
  try {
    await writeFile(path.join(source, 'index.txt'), 'v1');
    const first = await safeDeploy(manifest, undefined, { projectRoot: root, sourceRevision: 'v1' });
    assert.equal(first.deployed, true);

    await writeFile(path.join(source, 'index.txt'), 'v2');
    const second = await safeDeploy(manifest, undefined, { projectRoot: root, sourceRevision: 'v2' });
    assert.equal(second.deployed, true);

    const rollback = await rollbackFromState(stateFile, manifest.healthCheck, undefined, manifest);
    assert.equal(rollback.ok, true, rollback.failure);
    assert.equal(await readFile(path.join(deploy, 'index.txt'), 'utf8'), 'v1');

    const state = await readPrivateState<DeployState & Record<string, unknown>>(stateFile, { allowLegacy: true });
    assert.equal(state?.currentReleaseId, first.releaseId);
    assert.equal(state?.lastKnownGoodReleaseId, first.releaseId);
    assert.equal(state?.releasePath, first.releasePath);
    assert.equal(state?.lastKnownGoodReleasePath, first.releasePath);
    assert.equal(state?.previousReleasePath, second.releasePath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('malformed health definitions fail validation and runtime health fails closed', async () => {
  const malformed = basicManifest('source', 'deploy', {
    healthCheck: { type: 'htpp', url: 'https://example.com' } as any,
  });
  const errors = validateConfig(configFor(malformed));
  assert.ok(errors.some((error) => error.includes('healthCheck.type')));

  const runtime = await runHealthCheck({ type: 'htpp', url: 'https://example.com' } as any, process.cwd());
  assert.equal(runtime.ok, false);
  assert.match(runtime.details || '', /unknown health check type/i);
});

test('required build and migrate checks cannot be silently skipped', async () => {
  const { root, source, deploy } = await basicFixture(false);
  try {
    const buildManifest = basicManifest(source, deploy, { requiredChecks: ['build'] });
    const buildErrors = validateConfig(configFor(buildManifest));
    assert.ok(buildErrors.some((error) => error.includes('build requires manifest.buildCommand')));
    const buildGate = await runGate(buildManifest, root);
    assert.equal(buildGate.verdict, 'MISCONFIGURED');
    assert.equal(buildGate.steps.find((step) => step.name === 'build')?.ok, false);

    const migrateManifest = basicManifest(source, deploy, { requiredChecks: ['migrate'] });
    const migrateErrors = validateConfig(configFor(migrateManifest));
    assert.ok(migrateErrors.some((error) => error.includes('migrate requires manifest.migrations.checkCommand')));
    const migrateGate = await runGate(migrateManifest, root);
    assert.equal(migrateGate.verdict, 'MISCONFIGURED');
    assert.equal(migrateGate.steps.find((step) => step.name === 'migrate')?.ok, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('transaction cannot commit when live rollback target differs from healthy last-known-good release', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-live-lkg-'));
  const source = path.join(root, 'src');
  const live = path.join(root, 'live', 'demo');
  await mkdir(source, { recursive: true });
  const manifest: FrameworkManifest = {
    name: 'demo',
    runtime: 'node',
    managed: true,
    sourceDir: source,
    deployDir: live,
    validationCommand: 'node check.js',
    testCommand: 'node check.js',
    healthCheck: { type: 'command', command: 'node health.js' },
    backup: { retain: 2 },
  };
  const writeSource = async (marker: string, healthy: boolean) => {
    await writeFile(path.join(source, 'check.js'), 'process.exit(0)');
    await writeFile(path.join(source, 'health.js'), `process.exit(${healthy ? 0 : 1})`);
    await writeFile(path.join(source, 'marker.txt'), marker);
  };

  try {
    await writeSource('v1', true);
    const first = await safeDeploy(manifest, undefined, { projectRoot: root, sourceRevision: 'v1' });
    assert.equal(first.deployed, true);

    await writeSource('v2-bad', false);
    let healthCalls = 0;
    const result = await transactionalDeploy(manifest, {
      name: 'live-target-tamper',
      healthCheck: async () => {
        healthCalls += 1;
        if (healthCalls === 3) {
          await writeFile(path.join(live, 'release.json'), JSON.stringify({
            releaseId: 'wrong-live-release',
            project: 'demo',
            taskrailVersion: 'test',
            createdAt: new Date().toISOString(),
            path: live,
          }));
        }
        return { ok: true };
      },
    }, { projectRoot: root, sourceRevision: 'v2' });

    assert.equal(result.ok, false);
    assert.equal(result.outcome?.rolledBack, true);
    assert.equal(result.checkpoint?.phase, 'recovery-required');
    assert.match(result.checkpoint?.history.at(-1)?.note || '', /live rollback verification failed/i);
    assert.equal(await readFile(path.join(live, 'marker.txt'), 'utf8'), 'v1');
    assert.ok(first.releasePath && await exists(first.releasePath));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

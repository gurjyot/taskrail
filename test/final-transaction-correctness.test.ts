import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { rollbackFromState, runHealthCheck, safeDeploy } from '../src/deployment.js';
import { transactionalDeploy } from '../src/transactional-deploy.js';
import { runGate } from '../src/gate.js';
import { readPrivateState } from '../src/private-state.js';
import type { DeployState, FrameworkConfig, FrameworkManifest } from '../src/types.js';
import { validateConfig } from '../src/validation.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-final-correctness-'));
  const source = path.join(root, 'source');
  const deploy = path.join(root, 'deploy');
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'check.js'), 'process.exit(0)');
  await writeFile(path.join(source, 'index.txt'), 'R1');
  return { root, source, deploy, stateFile: path.join(root, 'app.deploy-state.json') };
}

function manifest(source: string, deploy: string, overrides: Partial<FrameworkManifest> = {}): FrameworkManifest {
  return {
    name: 'app',
    runtime: 'node',
    managed: true,
    sourceDir: source,
    deployDir: deploy,
    validationCommand: 'node check.js',
    testCommand: 'node check.js',
    healthCheck: { type: 'file', path: 'index.txt' },
    backup: { retain: 5 },
    requiredChecks: ['validation', 'test'],
    protectedPaths: [],
    ...overrides,
  };
}

function configFor(value: FrameworkManifest): FrameworkConfig {
  return { projectName: value.name, environment: {}, manifest: value };
}

test('failed live rollback is recovery-required and is never reported as rolled back', async () => {
  const { root, source, deploy, stateFile } = await fixture();
  try {
    const first = await safeDeploy(manifest(source, deploy), undefined, { projectRoot: root, sourceRevision: 'r1' });
    assert.equal(first.deployed, true);
    const firstState = await readPrivateState<DeployState & Record<string, unknown>>(stateFile, { allowLegacy: true });
    assert.ok(firstState?.lastKnownGoodReleasePath);
    assert.equal(await readFile(path.join(firstState.lastKnownGoodReleasePath!, 'index.txt'), 'utf8'), 'R1');

    const receipts = path.join(root, '.taskrail', 'receipts');
    await rm(receipts, { recursive: true, force: true });
    await writeFile(receipts, 'block receipt directory creation');
    await writeFile(path.join(source, 'index.txt'), 'R2');

    let healthCalls = 0;
    const result = await transactionalDeploy(manifest(source, deploy), {
      name: 'rollback-fault',
      healthCheck() {
        healthCalls += 1;
        return { ok: healthCalls < 3, details: healthCalls < 3 ? 'ready' : 'restored live target rejected' };
      },
    }, { projectRoot: root, sourceRevision: 'r2' });

    assert.equal(result.ok, false);
    assert.equal(result.checkpoint?.phase, 'recovery-required');
    assert.equal(result.outcome?.rolledBack, false);
    assert.equal(result.outcome?.rollbackAttempted, true);
    assert.equal(result.outcome?.rollbackSucceeded, false);
    assert.equal(result.outcome?.recoveryRequired, true);
    assert.equal(await readFile(path.join(deploy, 'index.txt'), 'utf8'), 'R1');

    const state = await readPrivateState<DeployState & Record<string, unknown>>(stateFile, { allowLegacy: true });
    assert.equal(state?.currentReleaseId, result.outcome?.releaseId);
    assert.notEqual(state?.currentReleaseId, firstState?.currentReleaseId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('successful manual rollback updates deployment state to match the restored live release', async () => {
  const { root, source, deploy, stateFile } = await fixture();
  try {
    const m = manifest(source, deploy);
    const first = await safeDeploy(m, undefined, { projectRoot: root, sourceRevision: 'r1' });
    assert.equal(first.deployed, true);
    await writeFile(path.join(source, 'index.txt'), 'R2');
    const second = await safeDeploy(m, undefined, { projectRoot: root, sourceRevision: 'r2' });
    assert.equal(second.deployed, true);

    const before = await readPrivateState<DeployState & Record<string, unknown>>(stateFile, { allowLegacy: true });
    assert.equal(before?.currentReleaseId, second.releaseId);
    assert.equal(before?.previousReleasePath, first.releasePath);

    const result = await rollbackFromState(stateFile, m.healthCheck, undefined, m);
    assert.equal(result.ok, true);
    assert.equal(await readFile(path.join(deploy, 'index.txt'), 'utf8'), 'R1');
    assert.equal((await lstat(deploy)).isSymbolicLink(), false);

    const after = await readPrivateState<DeployState & Record<string, unknown>>(stateFile, { allowLegacy: true });
    assert.equal(after?.releasePath, first.releasePath);
    assert.equal(after?.currentReleaseId, first.releaseId);
    assert.equal(after?.currentSha, 'r1');
    assert.equal(after?.lastKnownGoodReleasePath, first.releasePath);
    assert.equal(after?.lastKnownGoodReleaseId, first.releaseId);
    assert.equal(after?.previousReleasePath, second.releasePath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('malformed health definitions are rejected by validation and fail closed at runtime', async () => {
  const { root, source, deploy } = await fixture();
  try {
    const malformed = manifest(source, deploy, { healthCheck: { type: 'http', url: 'https://example.com' } });
    (malformed as any).healthCheck = { type: 'htpp', url: 'https://example.com' };
    const errors = validateConfig(configFor(malformed));
    assert.ok(errors.some((error) => error.includes('healthCheck.type')));

    const runtime = await runHealthCheck((malformed as any).healthCheck, root);
    assert.equal(runtime.ok, false);
    assert.match(runtime.details || '', /unsupported health check type/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('required build and migrate checks cannot silently pass without implementations', async () => {
  const { root, source, deploy } = await fixture();
  try {
    const buildRequired = manifest(source, deploy, { requiredChecks: ['validation', 'test', 'build'] });
    const buildErrors = validateConfig(configFor(buildRequired));
    assert.ok(buildErrors.some((error) => error.includes('required build check requires')));
    const buildGate = await runGate(buildRequired, root);
    assert.equal(buildGate.verdict, 'MISCONFIGURED');
    assert.equal(buildGate.steps.find((step) => step.name === 'build')?.ok, false);

    const migrateRequired = manifest(source, deploy, { requiredChecks: ['validation', 'test', 'migrate'] });
    const migrateErrors = validateConfig(configFor(migrateRequired));
    assert.ok(migrateErrors.some((error) => error.includes('required migrate check requires')));
    const migrateGate = await runGate(migrateRequired, root);
    assert.equal(migrateGate.verdict, 'MISCONFIGURED');
    assert.equal(migrateGate.steps.find((step) => step.name === 'migrate')?.ok, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('first deployment failure cleans partial activation without claiming rollback or recovery target', async () => {
  const { root, source, deploy, stateFile } = await fixture();
  try {
    let calls = 0;
    const result = await safeDeploy(manifest(source, deploy), {
      name: 'first-deploy-state-fault',
      async healthCheck() {
        calls += 1;
        if (calls === 1) await mkdir(stateFile);
        return { ok: true };
      },
    }, { projectRoot: root, sourceRevision: 'first' });

    assert.equal(result.deployed, false);
    assert.equal(result.rolledBack, false);
    assert.equal(result.rollbackAttempted, false);
    assert.equal(result.rollbackSucceeded, false);
    assert.equal(result.recoveryRequired, false);
    assert.match(result.failure || '', /partial first deployment cleaned up/);
    await assert.rejects(readFile(path.join(deploy, 'index.txt'), 'utf8'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

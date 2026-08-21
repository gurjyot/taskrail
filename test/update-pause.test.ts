import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { preflight } from '../src/preflight.js';
import { pauseAutomationUpdates, readUpdatePause, resumeAutomationUpdates } from '../src/update-pause.js';
import { pauseSharedUpdateConsumers, resumeSharedUpdateConsumers } from '../src/shared-update-control.js';
import type { FrameworkManifest } from '../src/types.js';
import type { SharedUpdatePlan } from '../src/update-plan.js';

async function root() { return mkdtemp(path.join(os.tmpdir(), 'taskrail-pause-')); }

function manifest(base: string, name = 'demo', deployRoot = base): FrameworkManifest {
  return {
    name,
    runtime: 'node',
    managed: true,
    sourceDir: path.join(base, 'src'),
    deployDir: path.join(deployRoot, 'live', name),
    validationCommand: 'node check.js',
    testCommand: 'node check.js',
  };
}

async function prepare(base: string) {
  await mkdir(path.join(base, 'src'), { recursive: true });
  await writeFile(path.join(base, 'src', 'check.js'), 'process.exit(0)');
}

test('preflight fails closed while an automation update pause is active', async () => {
  const base = await root();
  await prepare(base);
  const config = manifest(base);
  await pauseAutomationUpdates(config, base, { reason: 'shared capability migration', targetKind: 'capability', targetName: 'demo-api' });
  const paused = await preflight(config, base);
  assert.equal(paused.ok, false);
  assert.equal(paused.checks.find((item) => item.name === 'update-pause')?.ok, false);
  await resumeAutomationUpdates(config, base);
  const resumed = await preflight(config, base);
  assert.equal(resumed.checks.find((item) => item.name === 'update-pause')?.ok, true);
  await rm(base, { recursive: true, force: true });
});

test('breaking shared update pauses only the declared impact scope and resumes by target', async () => {
  const base = await root();
  const plan: SharedUpdatePlan = {
    targetKind: 'capability',
    targetName: 'shared-api',
    fromVersion: '1.0.0',
    toVersion: '2.0.0',
    changeClass: 'breaking',
    exists: true,
    affectedAutomations: ['alpha', 'beta'],
    affectedCount: 2,
    pauseRequired: true,
    pauseScope: ['alpha', 'beta'],
    action: 'migration-required',
    reasons: ['breaking change affects 2 automation(s)'],
  };
  for (const name of ['alpha', 'beta', 'gamma']) {
    const app = path.join(base, 'automations', name);
    await mkdir(path.join(app, 'src'), { recursive: true });
    await writeFile(path.join(app, 'src', 'check.js'), 'process.exit(0)');
    await writeFile(path.join(app, 'automation.json'), JSON.stringify({
      name,
      runtime: 'node',
      managed: true,
      sourceDir: 'src',
      deployDir: path.join(base, 'live', name),
      validationCommand: 'node check.js',
      testCommand: 'node check.js',
    }, null, 2));
  }

  const result = await pauseSharedUpdateConsumers(base, plan, 'tx-1');
  assert.equal(result.ok, true);
  assert.deepEqual(result.paused, ['alpha', 'beta']);

  for (const name of ['alpha', 'beta']) {
    const app = path.join(base, 'automations', name);
    assert.equal((await readUpdatePause(manifest(app, name, base), app))?.targetName, 'shared-api');
  }
  const gammaApp = path.join(base, 'automations', 'gamma');
  assert.equal(await readUpdatePause(manifest(gammaApp, 'gamma', base), gammaApp), null);

  const resumed = await resumeSharedUpdateConsumers(base, 'capability', 'shared-api');
  assert.equal(resumed.ok, true);
  assert.deepEqual(resumed.resumed, ['alpha', 'beta']);
  await rm(base, { recursive: true, force: true });
});

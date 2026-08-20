import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { validateConfig } from '../src/validation.js';
import { detectDrift } from '../src/drift.js';
import { runGate } from '../src/gate.js';
import { inspectChange } from '../src/change.js';
import { safeDeploy } from '../src/deployment.js';
import type { FrameworkManifest } from '../src/types.js';

const cli = path.resolve('dist/src/cli.js');

async function fixtureDir() {
  return await mkdtemp(path.join(os.tmpdir(), 'taskrail-fix-'));
}

async function writeFixture(base: string, files: Record<string, string>) {
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(base, file);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }
}

async function gitInit(dir: string) {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'taskrail@example.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'TaskRail'], { cwd: dir, stdio: 'ignore' });
}

function baseManifest(base: string, overrides: Partial<FrameworkManifest> = {}): FrameworkManifest {
  return {
    name: 'demo',
    taskrailCompatibility: '1.2.x',
    runtime: 'node',
    managed: true,
    sourceDir: path.join(base, 'src'),
    deployDir: path.join(base, 'deploy'),
    validationCommand: 'true',
    testCommand: 'true',
    healthCheck: { type: 'file', path: 'index.txt' },
    backup: { retain: 2 },
    requiredChecks: ['validation', 'test'],
    protectedPaths: [],
    plugins: [],
    ...overrides,
  };
}

test('gate fails closed when validation or test fails', async () => {
  const base = await fixtureDir();
  await writeFixture(base, { 'src/index.txt': 'x', 'deploy/index.txt': 'y' });
  const result = await runGate(baseManifest(base, { validationCommand: 'false' }), base);
  assert.equal(result.verdict, 'FAIL');
  const misconfigured = await runGate(baseManifest(base, { requiredChecks: ['health'], healthCheck: undefined }), base);
  assert.equal(misconfigured.verdict, 'MISCONFIGURED');
  await rm(base, { recursive: true, force: true });
});

test('deploy blocks protected changes before replacing target', async () => {
  const base = await fixtureDir();
  await gitInit(base);
  await writeFixture(base, {
    'src/index.txt': 'v1',
    'src/secret.txt': 'secret',
    'deploy/index.txt': 'old',
  });
  execFileSync('git', ['add', '.'], { cwd: base, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'base'], { cwd: base, stdio: 'ignore' });
  await writeFile(path.join(base, 'src', 'secret.txt'), 'changed');
  const result = await safeDeploy(baseManifest(base, { protectedPaths: ['src/secret.txt'] }));
  assert.equal(result.deployed, false);
  assert.equal(await readFile(path.join(base, 'deploy/index.txt'), 'utf8'), 'old');
  await rm(base, { recursive: true, force: true });
});

test('verify-change writes evidence and blocks protected paths', async () => {
  const base = await fixtureDir();
  await gitInit(base);
  await writeFixture(base, {
    'src/index.txt': 'v1',
    'src/secret.txt': 'secret',
    'deploy/index.txt': 'old',
  });
  execFileSync('git', ['add', '.'], { cwd: base, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'base'], { cwd: base, stdio: 'ignore' });
  await writeFile(path.join(base, 'src', 'secret.txt'), 'changed');
  const result = await inspectChange(baseManifest(base, { protectedPaths: ['src/secret.txt'] }), base);
  assert.equal(result.deployAllowed, false);
  const evidence = JSON.parse(await readFile(path.join(base, '.taskrail/evidence/latest.json'), 'utf8'));
  assert.equal(evidence.kind, 'verify-change');
  assert.deepEqual(evidence.protectedPaths, ['src/secret.txt']);
  await rm(base, { recursive: true, force: true });
});

test('drift ignores release metadata', async () => {
  const base = await fixtureDir();
  await writeFixture(base, {
    'live/main.js': 'a',
    'release/main.js': 'a',
    'release/release.json': '{"x":1}',
  });
  const drift = await detectDrift(path.join(base, 'live'), path.join(base, 'release'));
  assert.equal(drift.drifted, false);
  await rm(base, { recursive: true, force: true });
});

test('rollback CLI uses the active manifest state file', async () => {
  const base = await fixtureDir();
  await gitInit(base);
  await writeFixture(base, {
    'src/index.txt': 'v1',
    'deploy/index.txt': 'old',
  });
  await writeFile(path.join(base, 'automation.json'), JSON.stringify(baseManifest(base), null, 2));
  const deployed = await safeDeploy(baseManifest(base));
  assert.equal(deployed.deployed, true);
  const output = execFileSync(process.execPath, [cli, 'rollback'], { cwd: base, encoding: 'utf8' });
  assert.match(output, /rollback/);
  await rm(base, { recursive: true, force: true });
});

test('missing executable returns a clean gate failure', async () => {
  const base = await fixtureDir();
  await writeFixture(base, { 'src/index.txt': 'x', 'deploy/index.txt': 'y' });
  const result = await runGate(baseManifest(base, { validationCommand: 'definitely-not-a-real-command' }), base);
  assert.equal(result.verdict, 'MISCONFIGURED');
  assert.match(result.steps.find((step) => step.name === 'validation')?.message ?? '', /missing executable/i);
  await rm(base, { recursive: true, force: true });
});

test('template manifest validates', () => {
  const errors = validateConfig({
    projectName: 'taskrail-template',
    environment: {},
    manifest: {
      name: 'taskrail-template',
      taskrailCompatibility: '1.2.x',
      runtime: 'node',
      managed: true,
      sourceDir: 'src',
      deployDir: 'deploy',
      validationCommand: 'true',
      testCommand: 'true',
    },
  });
  assert.deepEqual(errors, []);
});

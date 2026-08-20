import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateConfig } from '../src/validation.js';
import { log } from '../src/logging.js';
import { rollbackFromState, safeDeploy } from '../src/deployment.js';

async function fixtureDir() {
  return await mkdtemp(path.join(os.tmpdir(), 'laf-'));
}

async function writeFixture(base: string, files: Record<string, string>) {
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(base, file);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }
}

test('validateConfig accepts the minimal manifest', () => {
  const errors = validateConfig({
    projectName: 'x',
    environment: {},
    manifest: {
      name: 'x',
      runtime: 'node',
      managed: true,
      sourceDir: 'src',
      deployDir: 'deploy',
      validationCommand: 'node -e "process.exit(0)"',
      testCommand: 'node -e "process.exit(0)"',
    },
  });
  assert.deepEqual(errors, []);
});

test('log emits structured json', () => {
  const event = JSON.parse(log({ level: 'info', message: 'hello' }));
  assert.equal(event.level, 'info');
  assert.equal(event.message, 'hello');
});

test('valid deployment succeeds and creates backup', async () => {
  const base = await fixtureDir();
  const source = path.join(base, 'source');
  const deploy = path.join(base, 'deploy');
  await writeFixture(source, { 'index.txt': 'v1', 'check.js': 'process.exit(0)' });
  await writeFixture(deploy, { 'index.txt': 'old' });
  const result = await safeDeploy({
    name: 'app',
    runtime: 'node',
    managed: true,
    sourceDir: source,
    deployDir: deploy,
    validationCommand: 'node check.js',
    testCommand: 'node check.js',
    healthCheck: { type: 'file', path: 'index.txt' },
    backup: { retain: 3 },
  });
  assert.equal(result.deployed, true);
  assert.equal(result.rolledBack, false);
  assert.equal(await readFile(path.join(deploy, 'index.txt'), 'utf8'), 'v1');
  await rm(base, { recursive: true, force: true });
});

test('validation failure blocks deployment', async () => {
  const base = await fixtureDir();
  const source = path.join(base, 'source');
  const deploy = path.join(base, 'deploy');
  await writeFixture(source, { 'check.js': 'process.exit(1)', 'index.txt': 'v1' });
  await writeFixture(deploy, { 'index.txt': 'old' });
  const result = await safeDeploy({
    name: 'app',
    runtime: 'node',
    managed: true,
    sourceDir: source,
    deployDir: deploy,
    validationCommand: 'node check.js',
    testCommand: 'node -e "process.exit(0)"',
  });
  assert.equal(result.deployed, false);
  assert.equal(await readFile(path.join(deploy, 'index.txt'), 'utf8'), 'old');
  await rm(base, { recursive: true, force: true });
});

test('candidate invalid does not overwrite target', async () => {
  const base = await fixtureDir();
  const source = path.join(base, 'source');
  const deploy = path.join(base, 'deploy');
  await writeFixture(source, { 'check.js': 'process.exit(0)', 'index.txt': 'v1' });
  await writeFixture(deploy, { 'index.txt': 'old' });
  const result = await safeDeploy({
    name: 'app',
    runtime: 'node',
    managed: true,
    sourceDir: source,
    deployDir: deploy,
    validationCommand: 'node check.js',
    testCommand: 'node -e "process.exit(1)"',
  });
  assert.equal(result.deployed, false);
  assert.equal(await readFile(path.join(deploy, 'index.txt'), 'utf8'), 'old');
  await rm(base, { recursive: true, force: true });
});

test('health failure triggers rollback and restores content', async () => {
  const base = await fixtureDir();
  const source = path.join(base, 'source');
  const deploy = path.join(base, 'deploy');
  await writeFixture(source, { 'check.js': 'process.exit(0)', 'index.txt': 'new' });
  await writeFixture(deploy, { 'index.txt': 'old' });
  const result = await safeDeploy({
    name: 'app',
    runtime: 'node',
    managed: true,
    sourceDir: source,
    deployDir: deploy,
    validationCommand: 'node check.js',
    testCommand: 'node check.js',
    healthCheck: { type: 'command', command: 'node -e "process.exit(1)"' },
  });
  assert.equal(result.deployed, false);
  assert.equal(result.rolledBack, true);
  assert.equal(await readFile(path.join(deploy, 'index.txt'), 'utf8'), 'old');
  await rm(base, { recursive: true, force: true });
});

test('rollback reports failure clearly when state is missing', async () => {
  const base = await fixtureDir();
  const result = await rollbackFromState(path.join(base, 'missing.json'), { type: 'command', command: 'node -e "process.exit(0)"' });
  assert.equal(result.ok, false);
  assert.equal(result.failure, 'missing rollback state');
  await rm(base, { recursive: true, force: true });
});

test('malformed manifest is rejected', () => {
  const errors = validateConfig({
    projectName: '',
    environment: {},
    manifest: {
      name: '',
      runtime: 'node',
      managed: true,
      sourceDir: '',
      deployDir: '',
      validationCommand: '',
      testCommand: '',
    },
  });
  assert.ok(errors.length > 0);
});

test('failed rollback is reported clearly', async () => {
  const base = await fixtureDir();
  const stateFile = path.join(base, 'app.deploy-state.json');
  await writeFile(stateFile, JSON.stringify({ backupPath: path.join(base, 'missing-backup'), targetPath: path.join(base, 'target') }));
  const result = await rollbackFromState(stateFile, { type: 'command', command: 'node -e "process.exit(0)"' });
  assert.equal(result.ok, false);
  assert.equal(result.failure, 'rollback failed');
  await rm(base, { recursive: true, force: true });
});

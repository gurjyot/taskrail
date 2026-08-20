import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, appendFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateConfig } from '../src/validation.js';
import { log } from '../src/logging.js';
import { rollbackFromState, safeDeploy } from '../src/deployment.js';
import { runGate } from '../src/gate.js';
import { inspectChange } from '../src/change.js';

async function fixtureDir() {
  return await mkdtemp(path.join(os.tmpdir(), 'taskrail-'));
}

async function writeFixture(base: string, files: Record<string, string>) {
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(base, file);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }
}

async function gitInit(dir: string) {
  await appendFile(path.join(dir, '.gitkeep'), 'x');
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'taskrail@example.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'TaskRail'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['add', '.gitkeep'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
}

function manifest(base: string, overrides: Partial<{ requiredChecks: string[]; protectedPaths: string[]; healthCheck: any; taskrailCompatibility: string; testCommand: string }> = {}) {
  return {
    name: 'demo',
    taskrailCompatibility: '1.1.x',
    runtime: 'node',
    managed: true,
    sourceDir: path.join(base, 'source'),
    deployDir: path.join(base, 'deploy'),
    validationCommand: 'node check.js',
    testCommand: 'node check.js',
    healthCheck: { type: 'file', path: 'index.txt' },
    backup: { retain: 3 },
    plugins: [],
    requiredChecks: ['validation', 'test'],
    protectedPaths: [],
    ...overrides,
  } as any;
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

test('gate pass fail and misconfigured are deterministic', async () => {
  const base = await fixtureDir();
  await writeFixture(base, { 'source/check.js': 'process.exit(0)', 'deploy/index.txt': 'old' });
  const pass = await runGate(manifest(base, { protectedPaths: [] }), base);
  assert.equal(pass.verdict, 'PASS');
  const fail = await runGate(manifest(base, { requiredChecks: ['validation', 'test'], protectedPaths: [], testCommand: 'node -e "process.exit(1)"' }), base);
  assert.equal(fail.verdict, 'FAIL');
  const misconfigured = await runGate(manifest(base, { requiredChecks: ['health'], healthCheck: undefined }), base);
  assert.equal(misconfigured.verdict, 'MISCONFIGURED');
  await rm(base, { recursive: true, force: true });
});

test('verify-change reports protected path risk and deploy eligibility', async () => {
  const base = await fixtureDir();
  await gitInit(base);
  await writeFixture(base, {
    'automation.json': JSON.stringify({ name: 'demo', runtime: 'node', managed: true, sourceDir: 'source', deployDir: 'deploy', validationCommand: 'node -e "process.exit(0)"', testCommand: 'node -e "process.exit(0)"', backup: { retain: 3 }, protectedPaths: ['src/secure'], requiredChecks: ['validation', 'test'] }, null, 2),
    'src/secure/secret.ts': 'export const x = 1;'
  });
  const result = await inspectChange({
    name: 'demo',
    runtime: 'node',
    managed: true,
    sourceDir: path.join(base, 'source'),
    deployDir: path.join(base, 'deploy'),
    validationCommand: 'node -e "process.exit(0)"',
    testCommand: 'node -e "process.exit(0)"',
    backup: { retain: 3 },
    protectedPaths: ['src/secure'],
    requiredChecks: ['validation', 'test'],
  } as any, base);
  assert.ok(result.changedFiles.some((f) => f === 'src/secure/secret.ts' || f === 'automation.json'));
  assert.equal(result.protectedPaths.length > 0, true);
  assert.equal(typeof result.deployAllowed, 'boolean');
  const evidence = JSON.parse(await readFile(path.join(base, '.taskrail/evidence/latest.json'), 'utf8'));
  assert.equal(evidence.kind, 'verify-change');
  await rm(base, { recursive: true, force: true });
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

test('doctor returns compatibility and health readiness', async () => {
  const base = await fixtureDir();
  await writeFixture(base, { 'source/check.js': 'process.exit(0)', 'deploy/index.txt': 'old' });
  await mkdir(path.join(base, 'deploy'), { recursive: true });
  await mkdir(path.join(base, 'source'), { recursive: true });
  await writeFile(path.join(base, 'deploy', 'index.txt'), 'old');
  await writeFile(path.join(base, 'source', 'check.js'), 'process.exit(0)');
  const result = await (await import('../src/deployment.js')).doctor(manifest(base, { taskrailCompatibility: '1.1.x' }) as any);
  assert.equal(result.version, (await import('../src/version.js')).TASKRAIL_VERSION);
  assert.equal(result.compatible, true);
  await rm(base, { recursive: true, force: true });
});

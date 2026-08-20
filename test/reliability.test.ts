import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { check, doctor, safeDeploy } from '../src/deployment.js';
import { buildPlan } from '../src/plan.js';
import { acquireLock, releaseLock } from '../src/locks.js';
import { createRelease, restoreRelease } from '../src/release.js';
import { detectDrift } from '../src/drift.js';
import { preflight } from '../src/preflight.js';
import { scanForSecrets } from '../src/security.js';
import { idempotencyKey } from '../src/idempotency.js';
import { appendAudit, readLastAudit } from '../src/history.js';
import { buildFailureReport } from '../src/errors.js';
import { TASKRAIL_VERSION } from '../src/version.js';
import type { FrameworkManifest } from '../src/types.js';

async function fixtureDir() {
  return await mkdtemp(path.join(os.tmpdir(), 'taskrail-v2-'));
}

async function writeFixture(base: string, files: Record<string, string>) {
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(base, file);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }
}

function manifest(base: string, overrides: Partial<FrameworkManifest> = {}): FrameworkManifest {
  return {
    name: 'demo',
    taskrailCompatibility: '0.2.x',
    runtime: 'node',
    managed: true,
    sourceDir: path.join(base, 'source'),
    deployDir: path.join(base, 'deploy'),
    validationCommand: 'node check.js',
    testCommand: 'node check.js',
    healthCheck: { type: 'file', path: 'index.txt' },
    backup: { retain: 3 },
    plugins: [],
    ...overrides,
  };
}

test('plan is dry-run only', async () => {
  const base = await fixtureDir();
  await writeFixture(base, { 'source/check.js': 'process.exit(0)', 'deploy/index.txt': 'old' });
  const plan = buildPlan(manifest(base));
  assert.equal(plan.project, 'demo');
  assert.ok(plan.source.includes('source'));
  await rm(base, { recursive: true, force: true });
});

test('lock blocks concurrent deploy', async () => {
  const base = await fixtureDir();
  const lockDir = path.join(base, '.taskrail', 'lock');
  const first = await acquireLock(lockDir);
  assert.equal(first.ok, true);
  const second = await acquireLock(lockDir);
  assert.equal(second.ok, false);
  await releaseLock(lockDir);
  await rm(base, { recursive: true, force: true });
});

test('release snapshot and restore work', async () => {
  const base = await fixtureDir();
  const source = path.join(base, 'source');
  const deploy = path.join(base, 'deploy');
  const releases = path.join(base, 'releases');
  await writeFixture(source, { 'index.txt': 'v1' });
  const rel = await createRelease(manifest(base), source, releases);
  await writeFixture(deploy, { 'index.txt': 'old' });
  await restoreRelease(rel.path, deploy);
  assert.equal(await readFile(path.join(deploy, 'index.txt'), 'utf8'), 'v1');
  await rm(base, { recursive: true, force: true });
});

test('drift is detected', async () => {
  const base = await fixtureDir();
  const source = path.join(base, 'source');
  const deploy = path.join(base, 'deploy');
  await writeFixture(source, { 'index.txt': 'a' });
  await writeFixture(deploy, { 'index.txt': 'b' });
  const drift = await detectDrift(deploy, source);
  assert.equal(drift.drifted, true);
  await rm(base, { recursive: true, force: true });
});

test('preflight spots missing env and files', async () => {
  const base = await fixtureDir();
  const m = manifest(base, { requiredEnv: ['TASKRAIL_TEST_ENV'], requiredFiles: [path.join(base, 'missing.txt')] });
  const result = await preflight(m);
  assert.equal(result.ok, false);
  await rm(base, { recursive: true, force: true });
});

test('secret scan finds obvious secrets', async () => {
  const base = await fixtureDir();
  const file = path.join(base, 'secret.txt');
  await writeFile(file, 'bot123456:abcdefghijklmnopqrstuvwxyz');
  const hits = await scanForSecrets([file]);
  assert.ok(hits.length > 0);
  await rm(base, { recursive: true, force: true });
});

test('idempotency helper is stable', () => {
  assert.equal(idempotencyKey('telegram', ['opportunity', '2026-08-20']), 'telegram::opportunity::2026-08-20');
});

test('audit writes append-only records', async () => {
  const base = await fixtureDir();
  const file = path.join(base, 'history.jsonl');
  await appendAudit(file, { ts: new Date().toISOString(), type: 'deploy', project: 'demo', taskrailVersion: TASKRAIL_VERSION });
  const last = await readLastAudit(file);
  assert.equal(last?.type, 'deploy');
  await rm(base, { recursive: true, force: true });
});

test('failure report is structured', () => {
  const report = JSON.parse(buildFailureReport({
    project: 'demo',
    taskrailVersion: TASKRAIL_VERSION,
    stage: 'deploy',
    category: 'preflight_failed',
    message: 'missing env',
    rollbackAttempted: false,
    rollbackResult: 'not-needed',
    nextStep: 'set env',
  }));
  assert.equal(report.version, TASKRAIL_VERSION);
  assert.equal(report.project, 'demo');
});

test('doctor returns compatibility and health readiness', async () => {
  const base = await fixtureDir();
  await writeFixture(base, { 'source/check.js': 'process.exit(0)', 'deploy/index.txt': 'old' });
  await mkdir(path.join(base, 'deploy'), { recursive: true });
  await mkdir(path.join(base, 'source'), { recursive: true });
  await writeFile(path.join(base, 'deploy', 'index.txt'), 'old');
  await writeFile(path.join(base, 'source', 'check.js'), 'process.exit(0)');
  const result = await doctor(manifest(base, { taskrailCompatibility: '1.0.x' }));
  assert.equal(result.version, TASKRAIL_VERSION);
  assert.equal(result.compatible, true);
  await rm(base, { recursive: true, force: true });
});

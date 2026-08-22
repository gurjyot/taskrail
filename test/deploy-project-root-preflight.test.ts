import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { safeDeploy } from '../src/deployment.js';
import { preflight } from '../src/preflight.js';

async function write(root: string, relative: string, content: string) {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

test('safeDeploy runs preflight from the automation project root', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'taskrail-deploy-root-'));
  const app = path.join(base, 'app');

  await write(base, 'capabilities/telegram-bot/capability.json', JSON.stringify({
    name: 'telegram-bot',
    version: '1.0.0',
    description: 'Telegram fixture',
    runtime: 'node',
    canonicalPath: 'index.js',
  }, null, 2));
  await write(base, 'capabilities/telegram-bot/index.js', 'export default {};\n');
  await write(app, 'src/main.js', 'process.exit(0);\n');
  await write(app, 'src/package-lock.json', JSON.stringify({ name: 'fixture', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'fixture', version: '1.0.0' } } }, null, 2));
  await mkdir(path.join(app, 'deploy'), { recursive: true });

  const manifest = {
    name: 'ads-shaped-fixture',
    taskrailCompatibility: '3.0.x',
    runtime: 'node',
    managed: true,
    sourceDir: 'src',
    deployDir: 'deploy',
    validationCommand: 'node --check main.js',
    testCommand: 'node --check main.js',
    healthCheck: { type: 'command', command: 'node --check main.js' },
    dependencyManager: {
      tool: 'npm',
      lockfile: 'package-lock.json',
      installCommand: 'node --check main.js',
    },
    capabilities: ['telegram-bot'],
    capabilityRoots: ['../capabilities'],
    requiredChecks: ['validation', 'test', 'health'],
  } as any;

  const result = await safeDeploy(manifest, undefined, { projectRoot: app });
  assert.equal(result.deployed, true, result.failure || result.report);

  await rm(base, { recursive: true, force: true });
});

test('production preflight allows a missing deploy target when its immediate parent is writable', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'taskrail-first-deploy-'));
  const app = path.join(base, 'app');
  const runtimeRoot = path.join(base, 'runtime');
  await mkdir(path.join(app, 'src'), { recursive: true });
  await mkdir(runtimeRoot, { recursive: true });
  await write(app, 'src/main.js', 'process.exit(0);\n');

  const manifest = {
    name: 'first-production-deploy',
    taskrailCompatibility: '3.0.x',
    runtime: 'shell',
    managed: true,
    sourceDir: 'src',
    deployDir: path.join(runtimeRoot, 'first-production-deploy'),
    validationCommand: 'true',
    testCommand: 'true',
    requiredChecks: ['validation', 'test'],
  } as any;

  const before = process.env.TASKRAIL_ENV;
  process.env.TASKRAIL_ENV = 'production';
  try {
    const result = await preflight(manifest, app);
    assert.equal(result.ok, true, JSON.stringify(result.checks));
    assert.equal(result.checks.find((check) => check.name === 'deployDir')?.ok, true);
    assert.equal(result.checks.find((check) => check.name === 'deployWritable')?.ok, true);
  } finally {
    if (before === undefined) delete process.env.TASKRAIL_ENV;
    else process.env.TASKRAIL_ENV = before;
    await rm(base, { recursive: true, force: true });
  }
});

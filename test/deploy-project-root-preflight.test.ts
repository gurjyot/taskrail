import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { safeDeploy } from '../src/deployment.js';

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

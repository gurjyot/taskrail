import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadManifest } from '../src/config.js';
import { inferProfile, resolveFrameworkManifest } from '../src/framework.js';

const cli = path.resolve('dist/src/cli.js');

async function fixtureDir() {
  return await mkdtemp(path.join(os.tmpdir(), 'taskrail-upgrade-'));
}

async function writeFixture(base: string, files: Record<string, string>) {
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(base, file);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }
}

test('profile resolution keeps manifests small and deterministic', async () => {
  const root = path.resolve('examples/smg');
  const twenty = resolveFrameworkManifest(await loadManifest(path.join(root, 'twenty-followup-reminder', 'automation.json')));
  const ads = resolveFrameworkManifest(await loadManifest(path.join(root, 'ads-agent', 'automation.json')));
  assert.equal(twenty.profile, 'smg-node-timer@1');
  assert.equal(twenty.deployDir, '/opt/smg-automations/automations/twenty-followup-reminder');
  assert.equal(ads.profile, 'smg-node-timer@1');
  assert.equal(ads.dependencyManager?.tool, 'npm');
  assert.equal(ads.serviceManager?.units.length, 4);
});

test('shared capability defaults benefit multiple automations without per-automation edits', async () => {
  const first = resolveFrameworkManifest({
    name: 'alpha',
    profile: 'smg-node-timer@1',
    taskrailCompatibility: '2.0.x',
    runtime: 'node',
    managed: true,
    sourceDir: '.',
    deployDir: '/tmp/alpha',
    validationCommand: 'node -e "process.exit(0)"',
    testCommand: 'node -e "process.exit(0)"',
  });
  const second = resolveFrameworkManifest({
    name: 'beta',
    profile: 'smg-node-timer@1',
    taskrailCompatibility: '2.0.x',
    runtime: 'node',
    managed: true,
    sourceDir: '.',
    deployDir: '/tmp/beta',
    validationCommand: 'node -e "process.exit(0)"',
    testCommand: 'node -e "process.exit(0)"',
  });
  assert.deepEqual(first.frameworkCapabilities, second.frameworkCapabilities);
  assert.equal(first.runtimeVersion, '>=18.0.0 <23.0.0');
  assert.equal(second.runtimePaths?.includes('node_modules'), true);
});

test('upgrade infers profile, writes safe declarative manifest, and is idempotent', async () => {
  const base = await fixtureDir();
  await writeFixture(base, {
    'src/main.js': 'process.exit(0)',
    'tests/self-test.js': 'process.exit(0)',
    'package.json': '{"name":"demo","version":"1.0.0"}',
    'package-lock.json': '{"name":"demo","lockfileVersion":3,"packages":{"":{"name":"demo","version":"1.0.0"}}}',
    'automation.json': JSON.stringify({
      name: 'demo',
      taskrailCompatibility: '2.0.x',
      runtime: 'node',
      managed: true,
      sourceDir: 'src',
      deployDir: '/opt/smg-automations/automations/demo',
      validationCommand: 'node main.js',
      testCommand: 'node ../tests/self-test.js',
      serviceManager: {
        type: 'systemd',
        units: [
          { name: 'demo.service', kind: 'service', oneshotOkay: true },
          { name: 'demo.timer', kind: 'timer' },
        ],
      },
    }, null, 2),
  });
  const first = execFileSync(process.execPath, [cli, 'upgrade', '--write'], { cwd: base, encoding: 'utf8', env: { ...process.env, TASKRAIL_ENV: 'local' } });
  assert.match(first, /STATUS: PASS/);
  const afterFirst = await readFile(path.join(base, 'automation.json'), 'utf8');
  const parsed = JSON.parse(afterFirst);
  assert.equal(parsed.profile, 'smg-node-timer@1');
  const second = execFileSync(process.execPath, [cli, 'upgrade', '--write'], { cwd: base, encoding: 'utf8', env: { ...process.env, TASKRAIL_ENV: 'local' } });
  assert.match(second, /STATUS: PASS/);
  const afterSecond = await readFile(path.join(base, 'automation.json'), 'utf8');
  assert.equal(afterFirst, afterSecond);
  await rm(base, { recursive: true, force: true });
});

test('upgrade infers timer profile from project unit files and drops redundant shared capability roots', async () => {
  const base = await fixtureDir();
  await writeFixture(base, {
    'framework-managed/capabilities/telegram-send/capability.json': JSON.stringify({
      name: 'telegram-send',
      version: '1.0.0',
      description: 'Send Telegram',
      runtime: 'node',
      canonicalPath: 'index.js',
    }, null, 2),
    'framework-managed/capabilities/telegram-send/index.js': 'module.exports = {}',
    'framework-managed/demo/src/main.js': 'process.exit(0)',
    'framework-managed/demo/tests/self-test.js': 'process.exit(0)',
    'framework-managed/demo/service/demo.service': '[Service]',
    'framework-managed/demo/timer/demo.timer': '[Timer]',
    'framework-managed/demo/automation.json': JSON.stringify({
      name: 'demo',
      taskrailCompatibility: '2.0.x',
      runtime: 'node',
      managed: true,
      sourceDir: '.',
      deployDir: '/opt/smg-automations/automations/demo',
      validationCommand: 'node src/main.js',
      testCommand: 'node tests/self-test.js',
      capabilities: ['telegram-send'],
      capabilityRoots: ['../capabilities'],
    }, null, 2),
  });
  const cwd = path.join(base, 'framework-managed/demo');
  const output = execFileSync(process.execPath, [cli, 'upgrade', '--write'], { cwd, encoding: 'utf8', env: { ...process.env, TASKRAIL_ENV: 'local' } });
  assert.match(output, /STATUS: PASS/);
  const parsed = JSON.parse(await readFile(path.join(cwd, 'automation.json'), 'utf8'));
  assert.equal(parsed.profile, 'smg-node-timer@1');
  assert.equal('capabilityRoots' in parsed, false);
  const second = execFileSync(process.execPath, [cli, 'upgrade', '--write'], { cwd, encoding: 'utf8', env: { ...process.env, TASKRAIL_ENV: 'local' } });
  assert.match(second, /STATUS: PASS/);
  await rm(base, { recursive: true, force: true });
});

test('upgrade refuses ambiguous legacy manifests', async () => {
  const base = await fixtureDir();
  await writeFixture(base, {
    'src/main.js': 'process.exit(0)',
    'tests/self-test.js': 'process.exit(0)',
    'automation.json': JSON.stringify({
      name: 'demo',
      taskrailCompatibility: '2.0.x',
      runtime: 'node',
      managed: true,
      sourceDir: '.',
      deployDir: '/opt/smg-automations/automations/demo',
      validationCommand: 'node src/main.js',
      testCommand: 'node tests/self-test.js',
    }, null, 2),
  });
  try {
    execFileSync(process.execPath, [cli, 'upgrade', '--write'], { cwd: base, encoding: 'utf8', env: { ...process.env, TASKRAIL_ENV: 'local' } });
    assert.fail('expected upgrade to fail');
  } catch (error: any) {
    const body = `${error.stdout || ''}${error.stderr || ''}`;
    assert.match(body, /ambiguous profile upgrade/);
  }
  await rm(base, { recursive: true, force: true });
});

test('upgrade preserves exact released 2.0 patch declarations on TaskRail 3', async () => {
  const base = await fixtureDir();
  await writeFixture(base, {
    'src/main.js': 'process.exit(0)',
    'tests/self-test.js': 'process.exit(0)',
    'service/demo.service': '[Service]',
    'timer/demo.timer': '[Timer]',
    'automation.json': JSON.stringify({
      name: 'demo',
      taskrailCompatibility: '2.0.3',
      runtime: 'node',
      managed: true,
      sourceDir: '.',
      deployDir: '/opt/smg-automations/automations/demo',
      validationCommand: 'node src/main.js',
      testCommand: 'node tests/self-test.js',
    }, null, 2),
  });
  const output = execFileSync(process.execPath, [cli, 'upgrade', '--write'], { cwd: base, encoding: 'utf8', env: { ...process.env, TASKRAIL_ENV: 'local' } });
  assert.match(output, /STATUS: PASS/);
  const parsed = JSON.parse(await readFile(path.join(base, 'automation.json'), 'utf8'));
  assert.equal(parsed.taskrailCompatibility, '2.0.3');
  await rm(base, { recursive: true, force: true });
});

test('inferProfile preserves backward compatibility for current manifests', () => {
  assert.equal(inferProfile({
    name: 'demo',
    runtime: 'node',
    managed: true,
    sourceDir: '.',
    deployDir: '/tmp/demo',
    validationCommand: 'true',
    testCommand: 'true',
    serviceManager: {
      type: 'systemd',
      units: [
        { name: 'demo.service', kind: 'service', oneshotOkay: true },
        { name: 'demo.timer', kind: 'timer' },
      ],
    },
  } as any), 'smg-node-timer@1');
});

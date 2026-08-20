import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { capabilityImpact, capabilityRootsFor, discoverAutomationManifests, getCapability, listManagedAutomations } from '../src/capabilities.js';
import { validateConfig } from '../src/validation.js';
import { preflight } from '../src/preflight.js';
import { runGate } from '../src/gate.js';

const cli = path.resolve('dist/src/cli.js');

async function fixtureDir() {
  return await mkdtemp(path.join(os.tmpdir(), 'taskrail-cap-'));
}

async function writeFixture(base: string, files: Record<string, string>) {
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(base, file);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }
}

function automation(name: string, root: string, capabilities: string[] = []) {
  return ({
    name,
    runtime: 'node' as const,
    managed: true,
    sourceDir: path.join(root, 'src'),
    deployDir: path.join(root, 'deploy'),
    validationCommand: 'node -e "process.exit(0)"',
    testCommand: 'node -e "process.exit(0)"',
    requiredChecks: ['validation', 'test'] as const,
    capabilities,
    capabilityRoots: [path.join(root, 'capabilities')],
  } as any);
}

test('capability registry discovers, inspects, and tracks consumers', async () => {
  const base = await fixtureDir();
  await writeFixture(base, {
    'capabilities/telegram-send/capability.json': JSON.stringify({
      name: 'telegram-send',
      version: '1.0.0',
      description: 'Send Telegram messages',
      runtime: 'node' as const,
      canonicalPath: 'telegram/send.ts',
      requiredSharedFiles: ['/opt/shared/.env'],
      secretValue: 'hidden',
    }, null, 2),
    'capabilities/meta-api/capability.json': JSON.stringify({
      name: 'meta-api',
      version: '1.0.0',
      description: 'Meta API helpers',
      runtime: 'node',
      canonicalPath: 'meta/index.ts',
    }, null, 2),
    'alpha/automation.json': JSON.stringify(automation('alpha', path.join(base, 'alpha'), ['telegram-send']), null, 2),
    'alpha/src/index.ts': '',
    'alpha/deploy/index.ts': '',
    'beta/automation.json': JSON.stringify(automation('beta', path.join(base, 'beta'), ['telegram-send', 'meta-api']), null, 2),
    'beta/src/index.ts': '',
    'beta/deploy/index.ts': '',
  });

  const roots = capabilityRootsFor(automation('alpha', path.join(base, 'alpha'), ['telegram-send']), base);
  const capabilities = await getCapability('telegram-send', roots);
  assert.equal(capabilities?.name, 'telegram-send');
  assert.equal(capabilities?.description, 'Send Telegram messages');
  assert.equal((capabilities as any)?.secretValue, undefined);
  assert.equal((await listManagedAutomations(base)).length, 2);
  assert.deepEqual((await capabilityImpact('telegram-send', base)).map((item) => item.name), ['alpha', 'beta']);
  assert.deepEqual(await discoverAutomationManifests(base), [path.join(base, 'alpha', 'automation.json'), path.join(base, 'beta', 'automation.json')]);
  await rm(base, { recursive: true, force: true });
});

test('missing capability fails preflight and gate cleanly', async () => {
  const base = await fixtureDir();
  await writeFixture(base, {
    'src/index.ts': '',
    'deploy/index.ts': '',
  });
  const manifest = automation('demo', base, ['missing-capability']);
  const result = await preflight(manifest as any);
  assert.equal(result.ok, false);
  assert.match(result.checks.find((check) => check.name === 'capability:missing-capability')?.message ?? '', /missing capability/i);
  const gate = await runGate(manifest as any, base);
  assert.equal(gate.verdict, 'MISCONFIGURED');
  await rm(base, { recursive: true, force: true });
});

test('existing manifests without capabilities still validate', () => {
  const errors = validateConfig({
    projectName: 'demo',
    environment: {},
    manifest: {
      name: 'demo',
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

test('discovery commands emit concise json', async () => {
  const base = await fixtureDir();
  await writeFixture(base, {
    'capabilities/telegram-send/capability.json': JSON.stringify({ name: 'telegram-send', version: '1.0.0', description: 'Send Telegram messages', runtime: 'node', canonicalPath: 'telegram/send.ts' }, null, 2),
    'app/automation.json': JSON.stringify(automation('app', path.join(base, 'app'), ['telegram-send']), null, 2),
    'app/src/index.ts': '',
    'app/deploy/index.ts': '',
  });
  const list = JSON.parse(execFileSync(process.execPath, [cli, 'list'], { cwd: base, encoding: 'utf8' }));
  assert.equal(list[0].name, 'app');
  const caps = JSON.parse(execFileSync(process.execPath, [cli, 'capabilities'], { cwd: base, encoding: 'utf8' }));
  assert.equal(caps[0].name, 'telegram-send');
  const inspect = JSON.parse(execFileSync(process.execPath, [cli, 'inspect', 'app'], { cwd: base, encoding: 'utf8' }));
  assert.equal(inspect.name, 'app');
  const cap = JSON.parse(execFileSync(process.execPath, [cli, 'capability', 'telegram-send'], { cwd: base, encoding: 'utf8' }));
  assert.equal(cap.name, 'telegram-send');
  assert.equal(cap.secretValue, undefined);
  const impact = JSON.parse(execFileSync(process.execPath, [cli, 'capability-impact', 'telegram-send'], { cwd: base, encoding: 'utf8' }));
  assert.equal(impact[0].name, 'app');
  await rm(base, { recursive: true, force: true });
});

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

function automation(name: string, root: string, capabilities: string[] = [], overrides: Record<string, unknown> = {}) {
  return {
    name,
    taskrailCompatibility: '2.0.x',
    runtime: 'node' as const,
    managed: true,
    sourceDir: path.join(root, 'src'),
    deployDir: path.join(root, 'deploy'),
    validationCommand: 'node -e "process.exit(0)"',
    testCommand: 'node -e "process.exit(0)"',
    requiredChecks: ['validation', 'test'] as const,
    capabilities,
    capabilityRoots: [path.join(root, 'capabilities')],
    ...overrides,
  } as any;
}

test('relative and absolute capability canonicalPath resolve from the capability directory', async () => {
  const base = await fixtureDir();
  await writeFixture(base, {
    'capabilities/relative/capability.json': JSON.stringify({
      name: 'relative',
      version: '1.0.0',
      description: 'Relative capability',
      runtime: 'node',
      canonicalPath: 'index.js',
    }, null, 2),
    'capabilities/relative/index.js': 'module.exports = {}',
    'capabilities/absolute/capability.json': JSON.stringify({
      name: 'absolute',
      version: '1.0.0',
      description: 'Absolute capability',
      runtime: 'node',
      canonicalPath: path.join(base, 'capabilities', 'absolute', 'index.js'),
    }, null, 2),
    'capabilities/absolute/index.js': 'module.exports = {}',
  });
  const roots = [path.join(base, 'capabilities')];
  const relative = await getCapability('relative', roots);
  const absolute = await getCapability('absolute', roots);
  assert.equal(relative?.canonicalPath, path.join(base, 'capabilities', 'relative', 'index.js'));
  assert.equal(absolute?.canonicalPath, path.join(base, 'capabilities', 'absolute', 'index.js'));
  await rm(base, { recursive: true, force: true });
});


test('relative capability roots resolve from the project directory', async () => {
  const base = await fixtureDir();
  await writeFixture(base, {
    'caps/one/capability.json': JSON.stringify({ name: 'one', version: '1.0.0', description: 'One', runtime: 'node', canonicalPath: 'index.js' }, null, 2),
    'caps/one/index.js': 'module.exports = {}',
    'demo/src/index.ts': '',
    'demo/deploy/index.ts': '',
  });
  const roots = capabilityRootsFor(automation('demo', path.join(base, 'demo'), ['one'], { capabilityRoots: ['../caps'] }), base);
  const cap = await getCapability('one', roots);
  assert.equal(cap?.canonicalPath, path.join(base, 'caps', 'one', 'index.js'));
  await rm(base, { recursive: true, force: true });
});

test('framework-managed source discovers sibling shared capabilities without explicit roots', async () => {
  const base = await fixtureDir();
  await writeFixture(base, {
    'framework-managed/capabilities/telegram-send/capability.json': JSON.stringify({ name: 'telegram-send', version: '1.0.0', description: 'Send', runtime: 'node', canonicalPath: 'index.js' }, null, 2),
    'framework-managed/capabilities/telegram-send/index.js': 'module.exports = {}',
    'framework-managed/twenty/automation.json': JSON.stringify({
      name: 'twenty',
      taskrailCompatibility: '2.0.x',
      runtime: 'node',
      managed: true,
      sourceDir: '.',
      deployDir: '/opt/smg-automations/automations/twenty',
      validationCommand: 'node -e "process.exit(0)"',
      testCommand: 'node -e "process.exit(0)"',
      capabilities: ['telegram-send'],
    }, null, 2),
  });
  const manifest = JSON.parse(await readFile(path.join(base, 'framework-managed/twenty/automation.json'), 'utf8'));
  const roots = capabilityRootsFor(manifest, path.join(base, 'framework-managed/twenty'));
  const cap = await getCapability('telegram-send', roots);
  assert.equal(cap?.canonicalPath, path.join(base, 'framework-managed/capabilities/telegram-send/index.js'));
  await rm(base, { recursive: true, force: true });
});

test('capability registry discovers, inspects, and tracks consumers', async () => {
  const base = await fixtureDir();
  await writeFixture(base, {
    'capabilities/telegram-send/capability.json': JSON.stringify({
      name: 'telegram-send',
      version: '1.0.0',
      description: 'Send Telegram messages',
      runtime: 'node',
      canonicalPath: 'index.js',
      requiredSharedFiles: [path.join(base, 'shared', '.env')],
    }, null, 2),
    'capabilities/telegram-send/index.js': 'module.exports = {}',
    'shared/.env': 'SAFE=1',
    'capabilities/meta-api/capability.json': JSON.stringify({
      name: 'meta-api',
      version: '1.0.0',
      description: 'Meta API helpers',
      runtime: 'node',
      canonicalPath: 'index.js',
    }, null, 2),
    'capabilities/meta-api/index.js': 'module.exports = {}',
    'alpha/automation.json': JSON.stringify(automation('alpha', path.join(base, 'alpha'), ['telegram-send'], { capabilityRoots: ['../capabilities'] }), null, 2),
    'alpha/src/index.ts': '',
    'alpha/deploy/index.ts': '',
    'beta/automation.json': JSON.stringify(automation('beta', path.join(base, 'beta'), ['telegram-send', 'meta-api'], { capabilityRoots: ['../capabilities'] }), null, 2),
    'beta/src/index.ts': '',
    'beta/deploy/index.ts': '',
  });

  const roots = capabilityRootsFor(automation('alpha', path.join(base, 'alpha'), ['telegram-send'], { capabilityRoots: ['../capabilities'] }), base);
  const capabilities = await getCapability('telegram-send', roots);
  assert.equal(capabilities?.name, 'telegram-send');
  assert.equal(capabilities?.description, 'Send Telegram messages');
  assert.equal((capabilities as any)?.secretValue, undefined);
  assert.equal((await listManagedAutomations(base)).length, 2);
  assert.deepEqual((await capabilityImpact('telegram-send', base)).map((item) => item.name), ['alpha', 'beta']);
  assert.deepEqual(await discoverAutomationManifests(base), [path.join(base, 'alpha', 'automation.json'), path.join(base, 'beta', 'automation.json')]);
  await rm(base, { recursive: true, force: true });
});

test('missing capability implementation or shared file fails preflight', async () => {
  const base = await fixtureDir();
  await writeFixture(base, {
    'src/index.ts': '',
    'deploy/index.ts': '',
    'capabilities/broken/capability.json': JSON.stringify({
      name: 'broken',
      version: '1.0.0',
      description: 'Broken capability',
      runtime: 'node',
      canonicalPath: 'missing.js',
      requiredSharedFiles: [path.join(base, 'shared', '.env')],
    }, null, 2),
  });
  const manifest = automation('demo', path.join(base, 'demo'), ['broken'], { capabilityRoots: ['../capabilities'] });
  const result = await preflight(manifest as any);
  assert.equal(result.ok, false);
  assert.match(result.checks.find((check) => check.name === 'capability:broken')?.message ?? '', /missing capability|missing required shared files|missing canonical implementation/i);
  await rm(base, { recursive: true, force: true });
});

test('duplicate capability names across roots fail deterministically', async () => {
  const base = await fixtureDir();
  await writeFixture(base, {
    'root-a/dup/capability.json': JSON.stringify({ name: 'dup', version: '1.0.0', description: 'First', runtime: 'node', canonicalPath: 'index.js' }, null, 2),
    'root-a/dup/index.js': 'module.exports = {}',
    'root-b/dup/capability.json': JSON.stringify({ name: 'dup', version: '1.0.0', description: 'Second', runtime: 'node', canonicalPath: 'index.js' }, null, 2),
    'root-b/dup/index.js': 'module.exports = {}',
    'src/index.ts': '',
    'deploy/index.ts': '',
  });
  const roots = [path.join(base, 'root-a'), path.join(base, 'root-b')];
  const registry = await import('../src/capabilities.js').then((m) => m.loadCapabilities(roots));
  assert.equal(registry.capabilities.length, 0);
  assert.equal(registry.errors.length > 0, true);
  assert.match(registry.errors[0].message, /duplicate capability name/i);
  assert.ok((registry.errors[0].conflictingPaths ?? []).length === 2);
  const manifest = automation('demo', path.join(base, 'demo'), ['dup'], { capabilityRoots: roots });
  const result = await preflight(manifest as any);
  assert.equal(result.ok, false);
  assert.match(result.checks.find((check) => check.name.startsWith('capability-registry:dup'))?.message ?? '', /duplicate capability name/i);
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
    'capabilities/telegram-send/capability.json': JSON.stringify({ name: 'telegram-send', version: '1.0.0', description: 'Send Telegram messages', runtime: 'node', canonicalPath: 'index.js' }, null, 2),
    'capabilities/telegram-send/index.js': 'module.exports = {}',
    'app/automation.json': JSON.stringify(automation('app', path.join(base, 'app'), ['telegram-send'], { capabilityRoots: ['../capabilities'] }), null, 2),
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


test('obsolete requiredFiles is rejected', () => {
  const errors = validateConfig({
    projectName: 'demo',
    environment: {},
    manifest: {
      name: 'demo',
      runtime: 'node',
      managed: true,
      sourceDir: 'src',
      deployDir: 'deploy',
      validationCommand: 'node -e \"process.exit(0)\"',
      testCommand: 'node -e \"process.exit(0)\"',
      requiredFiles: ['shared/.env'],
    } as any,
  });
  assert.match(errors.join('\n'), /requiredFiles is not supported/);
});

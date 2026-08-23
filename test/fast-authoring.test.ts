import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scaffoldAutomation } from '../src/automation-scaffold.js';
import { resolveFrameworkManifest } from '../src/framework.js';

test('thin node timer manifest resolves all standard operational defaults', () => {
  const manifest = resolveFrameworkManifest({
    name: 'daily-report',
    profile: 'smg-node-timer@1',
    capabilities: ['telegram-bot'],
  });

  assert.equal(manifest.runtime, 'node');
  assert.equal(manifest.managed, true);
  assert.equal(manifest.sourceDir, '.');
  assert.equal(manifest.deployDir, '/opt/smg-automations/automations/daily-report');
  assert.equal(manifest.validationCommand, 'node --check src/main.js');
  assert.equal(manifest.testCommand, 'node --test tests/*.test.js');
  assert.deepEqual(manifest.healthCheck, { type: 'command', command: 'node --check src/main.js' });
  assert.deepEqual(manifest.requiredChecks, ['validation', 'test']);
  assert.deepEqual(manifest.serviceManager?.units, [
    { name: 'daily-report.service', kind: 'service', oneshotOkay: true },
    { name: 'daily-report.timer', kind: 'timer' },
  ]);
  assert.deepEqual(manifest.capabilities, ['telegram-bot']);
});

test('thin manifest keeps explicit exceptions as overrides', () => {
  const manifest = resolveFrameworkManifest({
    name: 'special-report',
    profile: 'smg-node-timer@1',
    validationCommand: 'node --check custom/entry.js',
    testCommand: 'node --test custom-tests/*.test.js',
    healthCheck: { type: 'command', command: 'node custom/health.js' },
  });

  assert.equal(manifest.validationCommand, 'node --check custom/entry.js');
  assert.equal(manifest.testCommand, 'node --test custom-tests/*.test.js');
  assert.deepEqual(manifest.healthCheck, { type: 'command', command: 'node custom/health.js' });
});

test('scaffold writes a three-field manifest and conventional node layout', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-fast-authoring-'));
  try {
    const result = await scaffoldAutomation({ name: 'quick-report', profile: 'smg-node-timer@1', root });
    const manifest = JSON.parse(await readFile(path.join(result.path, 'automation.json'), 'utf8'));
    const entry = await readFile(path.join(result.path, 'src/main.js'), 'utf8');
    const selfTest = await readFile(path.join(result.path, 'tests/self-test.test.js'), 'utf8');

    assert.deepEqual(manifest, {
      name: 'quick-report',
      profile: 'smg-node-timer@1',
      capabilities: [],
    });
    assert.match(entry, /export async function run/);
    assert.match(selfTest, /..\/src\/main\.js/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('shell and php profiles inherit their conventional commands', () => {
  const shell = resolveFrameworkManifest({ name: 'shell-job', profile: 'smg-shell-timer@1' });
  assert.equal(shell.runtime, 'shell');
  assert.equal(shell.validationCommand, 'bash -n src/main.sh');
  assert.equal(shell.testCommand, 'bash tests/self-test.sh');

  const php = resolveFrameworkManifest({ name: 'php-job', profile: 'smg-php-timer@1' });
  assert.equal(php.runtime, 'php');
  assert.equal(php.validationCommand, 'php -l src/main.php');
  assert.equal(php.testCommand, 'php tests/self-test.php');
});

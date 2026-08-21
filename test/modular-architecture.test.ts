import test from 'node:test';
import assert from 'node:assert/strict';
import { ValidationRegistry, validationModule } from '../src/validation-registry.js';
import { SecurityRegistry, securityControl } from '../src/security-registry.js';
import { planRebootRecovery, rebootRecoverySafe } from '../src/reboot-recovery.js';
import { planRetention } from '../src/retention-policy.js';
import { assessPerformanceBudget } from '../src/performance-budget.js';
import { assessBackwardCompatibility } from '../src/backward-compatibility.js';
import { managedSystemdUnits } from '../src/systemd.js';

test('validation modules are reusable across suites and dependencies run once', async () => {
  const registry = new ValidationRegistry()
    .register(validationModule({
      id: 'checksum', version: '1', description: 'verify checksum', contexts: ['install', 'update'], tags: ['integrity'],
      validate: () => [],
    }))
    .register(validationModule({
      id: 'installer-network', version: '1', description: 'installer network validation', contexts: ['install'], dependsOn: ['checksum'],
      validate: () => [],
    }));
  const install = await registry.run({ name: 'install', contexts: ['install'] }, {});
  assert.deepEqual(install.modules, ['checksum', 'installer-network']);
  const update = await registry.run({ name: 'update', contexts: ['update'], tags: ['integrity'] }, {});
  assert.deepEqual(update.modules, ['checksum']);
});

test('validation registry fails closed on unknown dependency and cycles', () => {
  const missing = new ValidationRegistry().register(validationModule({
    id: 'broken', version: '1', description: 'broken', contexts: ['install'], dependsOn: ['missing'], validate: () => [],
  }));
  assert.throws(() => missing.resolve({ name: 'x', modules: ['broken'] }), /unknown validation module/);

  const cyclic = new ValidationRegistry()
    .register(validationModule({ id: 'a', version: '1', description: 'a', contexts: ['install'], dependsOn: ['b'], validate: () => [] }))
    .register(validationModule({ id: 'b', version: '1', description: 'b', contexts: ['install'], dependsOn: ['a'], validate: () => [] }));
  assert.throws(() => cyclic.resolve({ name: 'x', modules: ['a'] }), /cycle/);
});

test('security controls compose by profile and strict mode escalates warnings', async () => {
  const registry = new SecurityRegistry()
    .register(securityControl({
      id: 'secrets', version: '1', description: 'secret check', contexts: ['source'], tags: ['baseline'],
      evaluate: () => [{ control: 'secrets', code: 'secret-warning', severity: 'warning', message: 'review value' }],
    }))
    .register(securityControl({
      id: 'network', version: '1', description: 'network check', contexts: ['network'], tags: ['baseline'],
      evaluate: () => [],
    }));
  const normal = await registry.run({ name: 'baseline', tags: ['baseline'] }, {});
  assert.equal(normal.ok, true);
  const strict = await registry.run({ name: 'strict', tags: ['baseline'], strict: true }, {});
  assert.equal(strict.ok, false);
  assert.equal(strict.findings[0].severity, 'error');
});

test('reboot recovery supports catch-up skip and manual policies without affecting disabled automations', () => {
  const actions = planRebootRecovery([
    { name: 'daily', enabled: true, managed: true, missedRuns: 1, missedRunPolicy: 'run-on-recovery' },
    { name: 'digest', enabled: true, managed: true, missedRuns: 2, missedRunPolicy: 'skip' },
    { name: 'payments', enabled: true, managed: true, missedRuns: 1, missedRunPolicy: 'manual' },
    { name: 'disabled', enabled: false, managed: true },
  ]);
  assert.deepEqual(actions.map((item) => [item.automation, item.action]), [
    ['daily', 'catch-up'],
    ['digest', 'skip-missed'],
    ['disabled', 'ignore'],
    ['payments', 'manual-review'],
  ]);
  assert.equal(rebootRecoverySafe(actions), false);
});

test('systemd reboot readiness includes both declared services and timers', () => {
  const units = managedSystemdUnits({
    name: 'example', managed: true, runtime: 'node', sourceDir: '.', deployDir: '/tmp/example', validationCommand: 'true', testCommand: 'true',
    serviceManager: { type: 'systemd', units: [
      { name: 'example.timer', kind: 'timer' },
      { name: 'example.service', kind: 'service' },
    ] },
  });
  assert.deepEqual(units, [
    { name: 'example.service', kind: 'service' },
    { name: 'example.timer', kind: 'timer' },
  ]);
});

test('retention prunes transient data but preserves deployment and failure history', () => {
  const now = new Date('2026-08-22T00:00:00.000Z');
  const result = planRetention([
    { id: 'old-health', kind: 'health', createdAt: '2026-07-01T00:00:00.000Z' },
    { id: 'recent-health', kind: 'health', createdAt: '2026-08-21T00:00:00.000Z' },
    { id: 'deployment', kind: 'deployment', createdAt: '2025-01-01T00:00:00.000Z' },
    { id: 'failure', kind: 'failure', createdAt: '2025-01-01T00:00:00.000Z' },
  ], now);
  assert.deepEqual(result.prune.map((item) => item.id), ['old-health']);
  assert.deepEqual(result.retain.map((item) => item.id), ['recent-health', 'deployment', 'failure']);
});

test('performance budget blocks framework bloat and slow validation', () => {
  assert.equal(assessPerformanceBudget({ compressedBytes: 190_000, unpackedBytes: 1_010_000, startupMs: 150, validationMs: 800, memoryMb: 48 }).ok, true);
  const failed = assessPerformanceBudget({ unpackedBytes: 3_000_000, validationMs: 10_000 });
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.violations.map((item) => item.metric), ['unpackedBytes', 'validationMs']);
});

test('backward compatibility requires a major release before removing stable contracts', () => {
  const previous = { schema: 1 as const, version: '2.0.8', publicExports: ['taskrail/components', 'taskrail/testing'], commands: ['doctor', 'ship'], manifestFields: ['name', 'runtime'] };
  const additive = { schema: 1 as const, version: '2.1.0', publicExports: [...previous.publicExports, 'taskrail/control'], commands: [...previous.commands, 'recover'], manifestFields: [...previous.manifestFields, 'components'] };
  assert.equal(assessBackwardCompatibility(previous, additive).compatible, true);
  const breaking = { ...additive, publicExports: ['taskrail/testing'], commands: ['doctor'], manifestFields: ['name'] };
  const assessment = assessBackwardCompatibility(previous, breaking);
  assert.equal(assessment.compatible, false);
  assert.equal(assessment.requiresMajorVersion, true);
  assert.deepEqual(assessment.changes.map((change) => change.kind), ['removed-export', 'removed-command', 'removed-manifest-field']);
});

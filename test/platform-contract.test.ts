import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  TASKRAIL_PLATFORM_API_VERSION,
  PlatformCommandGateway,
  PlatformEventBus,
  authorizePlatformCommand,
  resolvePlatformCommand,
  RunawayExecutionGuard,
  journalExecutionGuardTrip,
} from '../src/public/platform.js';

test('platform command hooks are role-gated and reject injection-shaped targets', async () => {
  assert.equal(authorizePlatformCommand('viewer', 'automation.start'), false);
  assert.equal(authorizePlatformCommand('operator', 'automation.start'), true);
  assert.equal(authorizePlatformCommand('operator', 'scheduler.disable'), false);
  assert.equal(authorizePlatformCommand('admin', 'scheduler.disable'), true);
  assert.throws(() => resolvePlatformCommand({ command: 'automation.start', target: 'demo;rm -rf /' }), /invalid platform command target/);

  let executions = 0;
  const gateway = new PlatformCommandGateway(async (command, context) => {
    executions += 1;
    assert.equal(Object.isFrozen(command), true);
    assert.equal(Object.isFrozen(context), true);
    return { ok: true, command: command.command, target: command.target };
  });

  await assert.rejects(
    gateway.execute({ command: 'automation.stop', target: 'daily-report' }, { role: 'viewer' }),
    /not authorized/,
  );
  assert.equal(executions, 0);

  const result = await gateway.execute(
    { command: 'automation.stop', target: 'daily-report' },
    { role: 'operator', actor: 'dashboard' },
  );
  assert.equal(result.ok, true);
  assert.equal(executions, 1);
});

test('platform event bus supports filtered real-time observers without network listeners', async () => {
  const bus = new PlatformEventBus({ defaultTimeoutMs: 100, maxSubscribers: 4 });
  const seen: string[] = [];
  bus.subscribe({
    name: 'dashboard-stream',
    kinds: ['tests.completed', 'guardrail.tripped'],
    handler(event) {
      seen.push(event.kind);
      assert.equal(Object.isFrozen(event), true);
      assert.equal(Object.isFrozen(event.data), true);
    },
  });
  bus.subscribe({
    name: 'other-automation',
    automation: 'other',
    handler(event) {
      seen.push(`other:${event.kind}`);
    },
  });

  const deliveries = await bus.publish({
    apiVersion: TASKRAIL_PLATFORM_API_VERSION,
    id: 'evt-1',
    at: new Date(0).toISOString(),
    kind: 'tests.completed',
    automation: 'daily-report',
    data: { passed: 15, failed: 1 },
  });

  assert.deepEqual(seen, ['tests.completed']);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0]?.ok, true);
});

test('runaway guard trips repeated-state loops and remains tripped', () => {
  const guard = new RunawayExecutionGuard({
    maxSteps: 100,
    maxElapsedMs: 10_000,
    maxRepeatedFingerprint: 2,
    maxConsecutiveFailures: 5,
  }, 1_000);

  assert.equal(guard.observe({ fingerprint: 'same', at: 1_001 }).tripped, false);
  assert.equal(guard.observe({ fingerprint: 'same', at: 1_002 }).tripped, false);
  const trip = guard.observe({ fingerprint: 'same', at: 1_003 });
  assert.equal(trip.tripped, true);
  if (!trip.tripped) throw new Error('expected guard trip');
  assert.equal(trip.reason, 'repeated-state');
  assert.equal(trip.repeatedCount, 3);
  assert.deepEqual(guard.observe({ fingerprint: 'different', at: 1_004 }), trip);
});

test('runaway guard trips elapsed time and consecutive failure budgets', () => {
  const elapsed = new RunawayExecutionGuard({
    maxSteps: 10,
    maxElapsedMs: 5,
    maxRepeatedFingerprint: 10,
    maxConsecutiveFailures: 10,
  }, 100);
  const elapsedTrip = elapsed.observe({ at: 106 });
  assert.equal(elapsedTrip.tripped, true);
  if (elapsedTrip.tripped) assert.equal(elapsedTrip.reason, 'max-elapsed');

  const failures = new RunawayExecutionGuard({
    maxSteps: 10,
    maxElapsedMs: 100,
    maxRepeatedFingerprint: 10,
    maxConsecutiveFailures: 2,
  }, 100);
  failures.observe({ ok: false, at: 101 });
  failures.observe({ ok: false, at: 102 });
  const failureTrip = failures.observe({ ok: false, at: 103 });
  assert.equal(failureTrip.tripped, true);
  if (failureTrip.tripped) assert.equal(failureTrip.reason, 'consecutive-failures');
});

test('guardrail trip journal stores only bounded operational metadata in a private file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-guard-'));
  const file = path.join(root, 'guardrails.jsonl');
  const guard = new RunawayExecutionGuard({
    maxSteps: 1,
    maxElapsedMs: 100,
    maxRepeatedFingerprint: 10,
    maxConsecutiveFailures: 10,
  }, 0);
  guard.observe({ at: 1 });
  const trip = guard.observe({ at: 2 });
  if (!trip.tripped) throw new Error('expected guard trip');

  await journalExecutionGuardTrip(file, {
    automation: 'demo',
    executionId: 'exec-1',
    trip,
    at: new Date(0),
  });

  const parsed = JSON.parse((await readFile(file, 'utf8')).trim());
  assert.equal(parsed.event, 'execution-guardrail-tripped');
  assert.equal(parsed.reason, 'max-steps');
  assert.equal('message' in parsed, false);
  if (process.platform !== 'win32') {
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  }
});

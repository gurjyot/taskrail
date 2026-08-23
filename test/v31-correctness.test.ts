import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scaffoldAutomation } from '../src/automation-scaffold.js';
import { listManagedAutomations, capabilityImpact } from '../src/capabilities.js';
import { buildUsageGraph, usageImpact } from '../src/usage-graph.js';
import { auditFleetIsolation } from '../src/isolation-audit.js';
import { evaluateConformance } from '../src/conformance.js';
import { runHealthCheck } from '../src/deployment.js';
import { acquireLock, releaseLock } from '../src/locks.js';
import { detectDrift } from '../src/drift.js';

test('three-field-style profile manifest is visible across fleet metadata after resolution', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-thin-fleet-'));
  try {
    const created = await scaffoldAutomation({ name: 'thin-report', profile: 'portable-node@1', root });
    const raw = JSON.parse(await readFile(path.join(created.path, 'automation.json'), 'utf8'));
    assert.equal(Object.keys(raw).length, 4);
    assert.equal(raw.taskrailCompatibility, '3.1.x');
    const listed = await listManagedAutomations(root);
    assert.equal(listed.some((item) => item.name === 'thin-report'), true);
    const graph = await buildUsageGraph(root);
    assert.equal(graph.automations.some((item) => item.name === 'thin-report'), true);
    assert.deepEqual(usageImpact(graph, 'profile', 'portable-node@1').transitiveAutomationConsumers, ['thin-report']);
    const isolation = await auditFleetIsolation(root);
    assert.equal(isolation.roots.some((item) => item.automation === 'thin-report'), true);
    const conformance = await evaluateConformance(root);
    assert.equal(conformance.automations, 1);
    assert.deepEqual(await capabilityImpact('missing-capability', root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('all declared health checks execute and any failure fails health', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-health-array-'));
  try {
    await writeFile(path.join(root, 'ok.txt'), 'ok');
    const result = await runHealthCheck([
      { type: 'file', path: 'ok.txt' },
      { type: 'command', command: 'node -e "process.exit(1)"' },
    ], root);
    assert.equal(result.ok, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('binary drift compares bytes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-binary-drift-'));
  const live = path.join(root, 'live');
  const release = path.join(root, 'release');
  try {
    await mkdir(live); await mkdir(release);
    await writeFile(path.join(live, 'asset.bin'), Buffer.from([0xff, 0x00, 0x01]));
    await writeFile(path.join(release, 'asset.bin'), Buffer.from([0xff, 0x00, 0x02]));
    const result = await detectDrift(live, release);
    assert.deepEqual(result.files, ['asset.bin']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('orphan lock directory is reclaimed after initialization grace', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-orphan-lock-'));
  const lock = path.join(root, 'lock');
  try {
    await mkdir(lock);
    const old = new Date(Date.now() - 10_000);
    await utimes(lock, old, old);
    const acquired = await acquireLock(lock, { operation: 'test' });
    assert.equal(acquired.ok, true);
    await releaseLock(lock);
    assert.equal(await stat(lock).then(() => true, () => false), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

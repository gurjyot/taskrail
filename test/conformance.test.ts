import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { evaluateConformance } from '../src/conformance.js';

async function writeManifest(base: string, name: string, manifest: Record<string, unknown>) {
  const root = path.join(base, 'automations', name);
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'automation.json'), `${JSON.stringify({
    name,
    runtime: 'node',
    managed: true,
    sourceDir: '.',
    deployDir: path.join(base, 'live', name),
    statePath: path.join(base, 'state', name),
    validationCommand: 'node --version',
    testCommand: 'node --version',
    healthCheck: { type: 'file', path: 'automation.json' },
    execution: { timeoutMs: 30_000, maxConcurrency: 4, retry: { maxAttempts: 3 } },
    ...manifest,
  }, null, 2)}\n`);
}

test('healthy bounded automation passes hard conformance', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'taskrail-conformance-'));
  try {
    await writeManifest(base, 'alpha', { components: ['http'] });
    const report = await evaluateConformance(base);
    assert.equal(report.ok, true);
    assert.equal(report.summary.errors, 0);
    assert.equal(report.automations, 1);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('missing health probe is a hard conformance failure', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'taskrail-conformance-'));
  try {
    await writeManifest(base, 'alpha', { healthCheck: undefined });
    const report = await evaluateConformance(base);
    assert.equal(report.ok, false);
    assert.equal(report.findings.some((item) => item.rule === 'health-required' && item.severity === 'error'), true);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('overlapping automation roots fail conformance through isolation audit', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'taskrail-conformance-'));
  try {
    const shared = path.join(base, 'live', 'shared');
    await writeManifest(base, 'alpha', { deployDir: shared });
    await writeManifest(base, 'beta', { deployDir: shared });
    const report = await evaluateConformance(base);
    assert.equal(report.ok, false);
    assert.equal(report.findings.some((item) => item.rule === 'managed-root-isolation'), true);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

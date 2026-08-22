import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { verifyEcosystem } from '../src/ecosystem.js';

async function json(file: string, value: unknown) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, `${JSON.stringify(value, null, 2)}\n`); }

test('ecosystem verifier validates first-party capability and automation repositories', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-ecosystem-'));
  await json(path.join(root, 'hub/capabilities/example/capability.json'), { name: 'example', version: '1.0.0', taskrailCompatibility: '3.0.x', description: 'Example integration', purpose: 'Example integration', domain: 'example', operations: ['read'], components: ['http'] });
  await json(path.join(root, 'automations/monitoring/example/automation.json'), { name: 'example', taskrailCompatibility: '3.0.x', profile: 'portable-node@1', runtime: 'node', managed: true, sourceDir: '.', deployDir: '../live', validationCommand: 'node --check src/main.mjs', testCommand: 'node --test test/*.test.mjs', healthCheck: { type: 'file', path: 'src/main.mjs' } });
  const result = await verifyEcosystem({ schema: 1, repositories: [
    { name: 'hub', kind: 'capabilities', path: 'hub', enforceCurrentMajor: true },
    { name: 'automations', kind: 'automations', path: 'automations', enforceCurrentMajor: true }
  ] }, { cwd: root, taskrailVersion: '3.0.0' });
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.repositories[0].publications, 1);
  assert.equal(result.repositories[1].publications, 1);
});

test('ecosystem verifier rejects stale first-party major compatibility', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-ecosystem-stale-'));
  await json(path.join(root, 'automations/example/automation.json'), { name: 'legacy', taskrailCompatibility: '2.0.x', profile: 'portable-node@1', runtime: 'node', managed: true, sourceDir: '.', deployDir: '../live', validationCommand: 'node --check src/main.mjs', testCommand: 'node --test test/*.test.mjs', healthCheck: { type: 'file', path: 'src/main.mjs' } });
  const result = await verifyEcosystem({ schema: 1, repositories: [{ name: 'automations', kind: 'automations', path: 'automations', enforceCurrentMajor: true }] }, { cwd: root, taskrailVersion: '3.0.0' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.includes('must target TaskRail 3.x')));
});

test('ecosystem verifier reports missing required repositories', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-ecosystem-missing-'));
  const result = await verifyEcosystem({ schema: 1, repositories: [{ name: 'private', kind: 'automations', path: 'missing', required: true }] }, { cwd: root, taskrailVersion: '3.0.0' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.includes('repository path missing')));
});

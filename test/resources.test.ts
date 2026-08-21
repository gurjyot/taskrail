import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSystemdResourceBlock, systemdResourceDirectives } from '../src/resources.js';
import { resolveFrameworkManifest } from '../src/framework.js';
import { validateConfig } from '../src/validation.js';

test('systemd resource directives are deterministic', () => {
  assert.deepEqual(systemdResourceDirectives({ memoryMaxMb: 256, cpuQuotaPercent: 75, tasksMax: 32, nice: 5 }), {
    MemoryMax: '256M', CPUQuota: '75%', TasksMax: '32', Nice: '5',
  });
  assert.equal(renderSystemdResourceBlock({ memoryMaxMb: 256, cpuQuotaPercent: 75 }), 'MemoryMax=256M\nCPUQuota=75%');
});

test('SMG profiles inherit isolated execution and resource defaults', () => {
  const manifest = resolveFrameworkManifest({
    name: 'demo-agent', profile: 'smg-node-timer@1', runtime: 'node', managed: true,
    sourceDir: '.', deployDir: '/tmp/demo', validationCommand: 'true', testCommand: 'true',
  });
  assert.equal(manifest.statePath, '/opt/smg-automations/state/demo-agent');
  assert.equal(manifest.execution?.maxConcurrency, 4);
  assert.equal(manifest.resources?.memoryMaxMb, 512);
  assert.equal(manifest.frameworkCapabilities?.includes('agent-execution@1'), true);
});

test('invalid resource guardrails fail manifest validation', () => {
  const manifest: any = {
    name: 'bad', runtime: 'node', managed: true, sourceDir: '.', deployDir: '/tmp/bad',
    validationCommand: 'true', testCommand: 'true', resources: { memoryMaxMb: 1, cpuQuotaPercent: 0, tasksMax: 0, nice: 30 },
  };
  const errors = validateConfig({ projectName: 'bad', environment: {}, manifest });
  assert.equal(errors.length, 4);
});

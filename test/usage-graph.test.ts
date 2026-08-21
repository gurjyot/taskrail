import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildUsageGraph, usageImpact } from '../src/usage-graph.js';

async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

test('usage graph tracks direct and transitive component consumers', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'taskrail-usage-'));
  try {
    const capabilityDir = path.join(base, 'capabilities', 'notify');
    await writeJson(path.join(capabilityDir, 'capability.json'), {
      name: 'notify',
      version: '1.0.0',
      description: 'Send a reusable notification',
      runtime: 'node',
      canonicalPath: 'index.js',
      purpose: 'send notification',
      domain: 'notifications',
      operations: ['send'],
      components: ['http', 'retry'],
    });
    await writeFile(path.join(capabilityDir, 'index.js'), 'export default {}\n');

    await writeJson(path.join(base, 'automations', 'alpha', 'automation.json'), {
      name: 'alpha',
      taskrailCompatibility: '2.0.x',
      profile: 'smg-node-timer@1',
      runtime: 'node',
      managed: true,
      sourceDir: '.',
      deployDir: 'deploy',
      validationCommand: 'node --version',
      testCommand: 'node --version',
      capabilities: ['notify'],
    });
    await writeJson(path.join(base, 'automations', 'beta', 'automation.json'), {
      name: 'beta',
      taskrailCompatibility: '2.0.x',
      profile: 'smg-node-service@1',
      runtime: 'node',
      managed: true,
      sourceDir: '.',
      deployDir: 'deploy',
      validationCommand: 'node --version',
      testCommand: 'node --version',
      components: ['state'],
    });

    const graph = await buildUsageGraph(base);
    assert.deepEqual(graph.errors, []);
    assert.equal(graph.automations.length, 2);

    const notify = graph.capabilities.find((item) => item.name === 'notify');
    assert.deepEqual(notify?.automationConsumers, ['alpha']);
    assert.deepEqual(notify?.components, ['http', 'retry']);

    const http = graph.components.find((item) => item.name === 'http');
    assert.deepEqual(http?.capabilityConsumers, ['notify']);
    assert.deepEqual(http?.automationConsumers, ['alpha']);

    const state = graph.components.find((item) => item.name === 'state');
    assert.deepEqual(state?.directAutomationConsumers, ['beta']);
    assert.deepEqual(state?.automationConsumers, ['beta']);

    const componentImpact = usageImpact(graph, 'component', 'http');
    assert.equal(componentImpact.count, 1);
    assert.deepEqual(componentImpact.transitiveAutomationConsumers, ['alpha']);

    const capabilityImpact = usageImpact(graph, 'capability', 'notify');
    assert.deepEqual(capabilityImpact.directConsumers, ['alpha']);

    const profileImpact = usageImpact(graph, 'profile', 'smg-node-timer@1');
    assert.deepEqual(profileImpact.directConsumers, ['alpha']);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('usage graph reports unknown component declarations', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'taskrail-usage-'));
  try {
    await writeJson(path.join(base, 'automations', 'bad', 'automation.json'), {
      name: 'bad',
      runtime: 'node',
      managed: true,
      sourceDir: '.',
      deployDir: 'deploy',
      validationCommand: 'node --version',
      testCommand: 'node --version',
      components: ['does-not-exist'],
    });
    const graph = await buildUsageGraph(base);
    assert.equal(graph.errors.some((error) => error.includes('unknown component')), true);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

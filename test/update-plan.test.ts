import test from 'node:test';
import assert from 'node:assert/strict';
import type { UsageGraph } from '../src/usage-graph.js';
import { classifyVersionChange, planSharedUpdate } from '../src/update-plan.js';

const graph: UsageGraph = {
  automations: [
    { name: 'alpha', manifestPath: '/a', components: [], capabilities: ['notify'] },
    { name: 'beta', manifestPath: '/b', components: ['http'], capabilities: [] },
    { name: 'gamma', manifestPath: '/c', components: [], capabilities: [] },
  ],
  capabilities: [
    { name: 'notify', version: '1.0.0', components: ['http'], automationConsumers: ['alpha'] },
  ],
  components: [
    {
      name: 'http',
      version: '1',
      directAutomationConsumers: ['beta'],
      capabilityConsumers: ['notify'],
      automationConsumers: ['alpha', 'beta'],
    },
  ],
  profiles: [],
  errors: [],
};

test('version change classification is conservative and deterministic', () => {
  assert.equal(classifyVersionChange('1.0.0', '1.0.1'), 'patch');
  assert.equal(classifyVersionChange('1.0.0', '1.1.0'), 'minor');
  assert.equal(classifyVersionChange('1.2.0', '2.0.0'), 'breaking');
  assert.equal(classifyVersionChange('1.2.0', '1.2.1', true), 'breaking');
  assert.equal(classifyVersionChange(undefined, '1.0.0'), 'minor');
});

test('non-breaking capability update does not pause consumers', () => {
  const plan = planSharedUpdate(graph, {
    targetKind: 'capability',
    targetName: 'notify',
    fromVersion: '1.0.0',
    toVersion: '1.1.0',
  });
  assert.equal(plan.action, 'safe-to-stage');
  assert.equal(plan.pauseRequired, false);
  assert.deepEqual(plan.affectedAutomations, ['alpha']);
  assert.deepEqual(plan.pauseScope, []);
});

test('breaking component update scopes pause to transitive consumers only', () => {
  const plan = planSharedUpdate(graph, {
    targetKind: 'component',
    targetName: 'http',
    fromVersion: '1.0.0',
    toVersion: '2.0.0',
  });
  assert.equal(plan.action, 'migration-required');
  assert.equal(plan.pauseRequired, true);
  assert.deepEqual(plan.pauseScope, ['alpha', 'beta']);
  assert.equal(plan.pauseScope.includes('gamma'), false);
});

test('untrustworthy graph blocks shared update', () => {
  const broken: UsageGraph = { ...graph, errors: ['unknown component'] };
  const plan = planSharedUpdate(broken, {
    targetKind: 'capability',
    targetName: 'notify',
    fromVersion: '1.0.0',
    toVersion: '1.0.1',
  });
  assert.equal(plan.action, 'blocked');
  assert.equal(plan.pauseRequired, false);
});

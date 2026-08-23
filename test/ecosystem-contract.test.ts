import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ecosystemRepositoryRules,
  validateAutomationPublication,
  validateHubCapabilityPublication,
} from '../src/ecosystem-contract.js';

test('Hub capability publication requires compatible TaskRail contract and known components', () => {
  const valid = validateHubCapabilityPublication({
    name: 'example-api',
    version: '1.0.0',
    taskrailCompatibility: '2.0.x',
    description: 'Example API integration',
    purpose: 'Call Example API',
    domain: 'example',
    operations: ['read'],
    components: ['http'],
  }, '2.0.8');
  assert.equal(valid.ok, true, valid.errors.join('; '));

  const additiveMinor = validateHubCapabilityPublication({
    name: 'example-api',
    version: '1.0.0',
    taskrailCompatibility: '3.0.x',
    description: 'Example API integration',
    purpose: 'Call Example API',
    domain: 'example',
    operations: ['read'],
    components: ['http'],
  }, '3.1.0');
  assert.equal(additiveMinor.ok, true, additiveMinor.errors.join('; '));

  const incompatible = validateHubCapabilityPublication({
    name: 'example-api',
    version: '1.0.0',
    taskrailCompatibility: '3.0.x',
    description: 'Example API integration',
    purpose: 'Call Example API',
    domain: 'example',
    operations: ['read'],
    components: ['not-a-component'],
  }, '2.0.8');
  assert.equal(incompatible.ok, false);
  assert.ok(incompatible.errors.some((item) => /does not satisfy/.test(item)));
  assert.ok(incompatible.errors.some((item) => /unknown TaskRail components/.test(item)));
});

test('reference automation publication requires compatibility and health contract', () => {
  const manifest = {
    name: 'reference',
    taskrailCompatibility: '2.0.x',
    profile: 'smg-node-service@1',
    runtime: 'node',
    managed: true,
    sourceDir: 'src',
    deployDir: 'deploy',
    validationCommand: 'node check.js',
    testCommand: 'node check.js',
    healthCheck: { type: 'file', path: 'index.js' },
  } as any;
  const result = validateAutomationPublication(manifest, '2.0.8');
  assert.equal(result.ok, true, result.errors.join('; '));

  manifest.taskrailCompatibility = '3.0.x';
  const additiveMinor = validateAutomationPublication(manifest, '3.1.0');
  assert.equal(additiveMinor.ok, true, additiveMinor.errors.join('; '));
});

test('repository roles keep core, Hub, and automation ownership separate', () => {
  assert.ok(ecosystemRepositoryRules('core').owns.includes('components'));
  assert.ok(ecosystemRepositoryRules('hub').owns.includes('governed-capabilities'));
  assert.ok(ecosystemRepositoryRules('automations').owns.includes('reference-automations'));
});

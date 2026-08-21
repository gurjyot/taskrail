import test from 'node:test';
import assert from 'node:assert/strict';
import { agentActions, authorizeAgentAction, mcpSecurityContract } from '../src/agent-surface.js';

test('agent surface defaults to read-only and keeps control actions denied', () => {
  const actions = agentActions();
  assert.equal(actions.some((item) => item.name === 'capabilities.find' && item.defaultAllowed), true);
  assert.equal(actions.some((item) => item.name === 'automation.update' && !item.defaultAllowed), true);
  assert.equal(authorizeAgentAction('status').allowed, true);
  assert.equal(authorizeAgentAction('automation.scaffold').allowed, false);
  assert.equal(authorizeAgentAction('automation.update', { allowWrite: true }).allowed, false);
  assert.equal(authorizeAgentAction('automation.update', { allowControl: true }).allowed, true);
});

test('explicit deny wins over broader authorization', () => {
  const result = authorizeAgentAction('automation.update', { allowControl: true, deny: ['automation.update'] });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'explicit-deny');
});

test('MCP contract has no network listener by default', () => {
  const contract = mcpSecurityContract();
  assert.equal(contract.transportDefault, 'stdio');
  assert.equal(contract.networkListenerDefault, false);
  assert.equal(contract.authorizationRequiredForMutation, true);
  assert.equal(contract.protocolTarget, '2026-07-28');
});

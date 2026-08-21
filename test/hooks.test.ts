import test from 'node:test';
import assert from 'node:assert/strict';
import { LifecycleBus } from '../src/hooks.js';

test('lifecycle hooks run deterministically by priority and name', async () => {
  const order: string[] = [];
  const bus = new LifecycleBus();
  bus.register({ name: 'second', event: 'activation:before', priority: 20, handler: () => { order.push('second'); } });
  bus.register({ name: 'first-b', event: 'activation:before', priority: 10, handler: () => { order.push('first-b'); } });
  bus.register({ name: 'first-a', event: 'activation:before', priority: 10, handler: () => { order.push('first-a'); } });
  const result = await bus.emit('activation:before', { automation: 'demo' });
  assert.equal(result.ok, true);
  assert.deepEqual(order, ['first-a', 'first-b', 'second']);
});

test('required hook failure fails closed while optional observer is reported', async () => {
  const bus = new LifecycleBus();
  bus.register({ name: 'optional', event: 'preflight:passed', required: false, handler: () => { throw new Error('optional failed'); } });
  bus.register({ name: 'required', event: 'preflight:passed', handler: () => { throw new Error('required failed'); } });
  const result = await bus.emit('preflight:passed');
  assert.equal(result.ok, false);
  assert.equal(result.outcomes.length, 2);
  assert.equal(result.outcomes.find((item) => item.name === 'optional')?.ok, false);
  assert.equal(result.outcomes.find((item) => item.name === 'required')?.required, true);
});

test('mutation handlers require explicit control-plane authorization', () => {
  const bus = new LifecycleBus();
  assert.throws(() => bus.register({
    name: 'mutator',
    event: 'activation:before',
    mode: 'mutate',
    handler: () => undefined,
  }), /not authorized/);

  const authorized = new LifecycleBus({ allowMutationHandlers: true });
  authorized.register({ name: 'mutator', event: 'activation:before', mode: 'mutate', handler: () => undefined });
  assert.equal(authorized.list('activation:before')[0].mode, 'mutate');
});

test('hook context is frozen and handlers are timeout bounded', async () => {
  const bus = new LifecycleBus({ defaultTimeoutMs: 10 });
  let frozen = false;
  bus.register({
    name: 'freeze-check',
    event: 'health:passed',
    handler: (context) => { frozen = Object.isFrozen(context) && Object.isFrozen(context.data); },
  });
  bus.register({
    name: 'slow',
    event: 'health:passed',
    timeoutMs: 5,
    required: false,
    handler: async () => { await new Promise((resolve) => setTimeout(resolve, 50)); },
  });
  const result = await bus.emit('health:passed', { data: { key: 'value' } });
  assert.equal(frozen, true);
  assert.equal(result.ok, true);
  assert.match(result.outcomes.find((item) => item.name === 'slow')?.error ?? '', /timeout/i);
});

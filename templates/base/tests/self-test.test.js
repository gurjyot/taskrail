import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../src/index.js';

test('automation entrypoint is healthy', () => {
  assert.equal(main(), 'ok');
});

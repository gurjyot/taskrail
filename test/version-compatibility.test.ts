import test from 'node:test';
import assert from 'node:assert/strict';
import { isTaskRailCompatible } from '../src/config.js';

test('TaskRail 3 accepts the released 2.0.x manifest line as a compatibility bridge', () => {
  assert.equal(isTaskRailCompatible('3.0.0', '2.0.x'), true);
  assert.equal(isTaskRailCompatible('3.0.0', '2.0.3'), true);
  assert.equal(isTaskRailCompatible('3.0.0', '2.0.8'), true);
});

test('TaskRail 3 does not broadly accept unrelated legacy majors or minors', () => {
  assert.equal(isTaskRailCompatible('3.0.0', '1.0.x'), false);
  assert.equal(isTaskRailCompatible('3.0.0', '2.1.x'), false);
  assert.equal(isTaskRailCompatible('3.0.0', '4.0.x'), false);
});

test('TaskRail 3 accepts native 3.0.x declarations normally', () => {
  assert.equal(isTaskRailCompatible('3.0.0', '3.0.x'), true);
  assert.equal(isTaskRailCompatible('3.0.0', '3.0.0'), true);
});

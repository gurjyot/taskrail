import test from 'node:test';
import assert from 'node:assert/strict';
import { isTaskRailCompatible } from '../src/config.js';

test('TaskRail 3 accepts the released 2.0.x manifest line as a compatibility bridge', () => {
  assert.equal(isTaskRailCompatible('3.0.0', '2.0.x'), true);
  assert.equal(isTaskRailCompatible('3.0.0', '2.0.3'), true);
  assert.equal(isTaskRailCompatible('3.1.0', '2.0.8'), true);
});

test('TaskRail 3 does not broadly accept unrelated legacy majors or minors', () => {
  assert.equal(isTaskRailCompatible('3.1.0', '1.0.x'), false);
  assert.equal(isTaskRailCompatible('3.1.0', '2.1.x'), false);
  assert.equal(isTaskRailCompatible('3.1.0', '4.0.x'), false);
});

test('TaskRail 3 accepts native wildcard minor lines up to the running additive minor', () => {
  assert.equal(isTaskRailCompatible('3.0.0', '3.0.x'), true);
  assert.equal(isTaskRailCompatible('3.1.0', '3.0.x'), true);
  assert.equal(isTaskRailCompatible('3.1.0', '3.1.x'), true);
  assert.equal(isTaskRailCompatible('3.1.0', '3.2.x'), false);
});

test('exact native versions remain exact', () => {
  assert.equal(isTaskRailCompatible('3.1.0', '3.1.0'), true);
  assert.equal(isTaskRailCompatible('3.1.0', '3.0.8'), false);
});

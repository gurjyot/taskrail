import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { capabilityRootsFor, workspaceCapabilityRoots } from '../src/capabilities.js';
test('workspace and automation discovery include framework-managed capabilities', async () => {
  const cwd = path.resolve('fixture-workspace');
  const expected = path.join(cwd, 'framework-managed', 'capabilities');
  assert.ok((await workspaceCapabilityRoots(cwd)).includes(expected));
  assert.ok(capabilityRootsFor(undefined, cwd).includes(expected));
});

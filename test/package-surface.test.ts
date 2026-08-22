import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('published package omits source-tree exports while retaining the v3 deep-dist compatibility bridge', async () => {
  const pkg = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8'));
  assert.equal(Object.prototype.hasOwnProperty.call(pkg.exports, './src/*'), false);
  assert.equal(pkg.exports['./dist/*'], './dist/*');
  for (const stable of ['./components', './capabilities', './manifest', './testing', './control', './agent', './platform']) {
    assert.ok(pkg.exports[stable], `missing stable export ${stable}`);
  }
});

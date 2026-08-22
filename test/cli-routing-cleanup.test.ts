import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('test and ship have one canonical CLI implementation each', async () => {
  const root = process.cwd();
  const legacyCli = await readFile(path.join(root, 'src', 'cli.ts'), 'utf8');
  const entrypoint = await readFile(path.join(root, 'src', 'taskrail-cli.ts'), 'utf8');

  assert.equal(legacyCli.includes("from './preflight.js'"), false);
  assert.equal(legacyCli.includes('async function commandShip('), false);
  assert.equal(legacyCli.includes("if (cmd === 'test') {"), false);
  assert.equal(legacyCli.includes("if (cmd === 'ship') return commandShip"), false);
  assert.match(entrypoint, /command === 'test'[\s\S]*test-command\.js/);
  assert.match(entrypoint, /command === 'ship'[\s\S]*ship-command\.js/);
});

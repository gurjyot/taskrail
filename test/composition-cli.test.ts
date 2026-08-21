import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, '../src/taskrail-cli.js');

test('dispatcher preserves legacy help and exposes component discovery', () => {
  const help = execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.match(help, /taskrail env\|paths/);
  const components = JSON.parse(execFileSync(process.execPath, [cli, 'components'], { encoding: 'utf8' }));
  assert.equal(components.some((item: any) => item.name === 'http'), true);
  assert.equal(components.some((item: any) => item.name === 'idempotency'), true);
});

test('init automation creates a runnable thin Node scaffold', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'taskrail-init-'));
  try {
    const result = JSON.parse(execFileSync(process.execPath, [cli, 'init', 'automation', 'demo-agent', '--profile', 'smg-node-timer@1', '--root', root], { encoding: 'utf8' }));
    assert.equal(result.runtime, 'node');
    const target = path.join(root, 'demo-agent');
    const manifest = JSON.parse(await readFile(path.join(target, 'automation.json'), 'utf8'));
    assert.equal(manifest.profile, 'smg-node-timer@1');
    assert.deepEqual(manifest.capabilities, []);
    execFileSync(process.execPath, ['--test', 'tests/*.test.js'], { cwd: target, shell: true, stdio: 'pipe' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

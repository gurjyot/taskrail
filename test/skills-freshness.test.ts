import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const checker = path.resolve('scripts/check-skills-freshness.mjs');

async function fixture(version: string, reviewedFor: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-skills-'));
  await mkdir(path.join(root, 'skills', 'example'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', version }, null, 2));
  await writeFile(path.join(root, 'skills', 'example', 'SKILL.md'), `---\nname: example\nreviewed_for_taskrail: ${reviewedFor}\n---\n# Example\n`);
  return root;
}

test('skills freshness accepts skills reviewed for the exact framework version', async () => {
  const root = await fixture('9.9.9', '9.9.9');
  const output = execFileSync(process.execPath, [checker], { cwd: root, encoding: 'utf8' });
  const report = JSON.parse(output);
  assert.equal(report.ok, true);
  assert.equal(report.results[0].reviewedFor, '9.9.9');
  await rm(root, { recursive: true, force: true });
});

test('skills freshness fails closed when a skill review marker is stale', async () => {
  const root = await fixture('9.9.9', '9.9.8');
  const result = spawnSync(process.execPath, [checker], { cwd: root, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.results[0].expected, '9.9.9');
  assert.equal(report.results[0].reviewedFor, '9.9.8');
  await rm(root, { recursive: true, force: true });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CapabilityContract } from '../src/types.js';
import { checkCapability } from '../src/capability-check.js';

async function build(root: string, name: string, extra: Record<string, unknown> = {}): Promise<CapabilityContract> {
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  const impl = path.join(dir, 'index.js');
  const manifestPath = path.join(dir, 'capability.json');
  await writeFile(impl, 'export default {};\n');
  await writeFile(path.join(dir, 'CAPABILITY.md'), `# ${name}\n`);
  await writeFile(manifestPath, JSON.stringify({
    name,
    version: '1.0.0',
    description: `${name} capability`,
    purpose: `${name} purpose`,
    domain: name.split('-')[0],
    operations: ['run'],
    keywords: [name],
    sideEffects: 'none',
    idempotency: 'not-applicable',
    components: ['http'],
    status: 'active',
    runtime: 'node',
    canonicalPath: 'index.js',
    ...extra,
  }, null, 2));
  return {
    name,
    version: '1.0.0',
    description: `${name} capability`,
    runtime: 'node',
    canonicalPath: impl,
    root: dir,
    path: manifestPath,
    consumers: [],
  };
}

test('strict capability check validates governed metadata and known components', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'taskrail-capcheck-'));
  try {
    const capability = await build(root, 'wordpress-read', { domain: 'wordpress', operations: ['get-post'] });
    const result = await checkCapability(capability, [capability], true);
    assert.equal(result.ok, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('capability check rejects unknown components and hard duplicate purpose', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'taskrail-capcheck-'));
  try {
    const first = await build(root, 'first-capability', {
      purpose: 'Send messages to Example', domain: 'example', operations: ['send-message'], components: ['not-a-component'],
    });
    const second = await build(root, 'second-capability', {
      purpose: 'Send messages to Example', domain: 'example', operations: ['send-message'], components: ['http'],
    });
    const result = await checkCapability(first, [first, second], true);
    assert.equal(result.ok, false);
    assert.equal(result.checks.find((item) => item.name === 'components')?.ok, false);
    assert.equal(result.checks.find((item) => item.name === 'duplicate-governance')?.ok, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

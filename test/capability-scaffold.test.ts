import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CapabilityContract } from '../src/types.js';
import { scaffoldCapability } from '../src/capability-scaffold.js';

async function existingCapability(root: string): Promise<CapabilityContract> {
  const dir = path.join(root, 'wordpress-publish');
  await mkdir(dir, { recursive: true });
  const manifestPath = path.join(dir, 'capability.json');
  await writeFile(path.join(dir, 'index.js'), 'export default {};\n');
  await writeFile(manifestPath, JSON.stringify({
    name: 'wordpress-publish',
    version: '1.0.0',
    description: 'Publish WordPress content',
    purpose: 'Publish content to WordPress',
    domain: 'wordpress',
    operations: ['create-post', 'update-post'],
    keywords: ['wordpress', 'post', 'publish'],
    runtime: 'node',
    canonicalPath: 'index.js',
  }));
  return {
    name: 'wordpress-publish', version: '1.0.0', description: 'Publish WordPress content', runtime: 'node',
    canonicalPath: path.join(dir, 'index.js'), root: dir, path: manifestPath, consumers: [],
  };
}

test('scaffolding refuses semantic duplicates before writing files', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'taskrail-scaffold-'));
  try {
    const existing = await existingCapability(base);
    const outputRoot = path.join(base, 'new');
    const result = await scaffoldCapability({
      root: outputRoot,
      name: 'wp-writer',
      version: '1.0.0',
      description: 'Create WordPress posts',
      purpose: 'Publish content to WordPress',
      domain: 'wordpress',
      operations: ['create-post'],
    }, [existing]);
    assert.equal(result.created, false);
    assert.equal(result.conflicts[0].severity, 'hard');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('scaffolding creates a documented capability when no equivalent exists', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'taskrail-scaffold-'));
  try {
    const result = await scaffoldCapability({
      root: base,
      name: 'wordpress-media-read',
      version: '1.0.0',
      description: 'Read WordPress media metadata',
      purpose: 'Read media metadata from WordPress',
      domain: 'wordpress',
      operations: ['get-media'],
      keywords: ['wordpress', 'media'],
      sideEffects: 'read',
      idempotency: 'not-applicable',
      components: ['http', 'config'],
    }, []);
    assert.equal(result.created, true);
    const manifest = JSON.parse(await readFile(path.join(base, 'wordpress-media-read', 'capability.json'), 'utf8'));
    assert.equal(manifest.purpose, 'Read media metadata from WordPress');
    assert.deepEqual(manifest.components, ['http', 'config']);
    assert.match(await readFile(path.join(base, 'wordpress-media-read', 'CAPABILITY.md'), 'utf8'), /When not to use/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

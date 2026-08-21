import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CapabilityContract } from '../src/types.js';
import { assessCapabilityCandidate, findSimilarCapabilities } from '../src/capability-governance.js';

async function fixture(name: string, metadata: Record<string, unknown>): Promise<{ root: string; capability: CapabilityContract }> {
  const root = await mkdtemp(path.join(tmpdir(), `taskrail-cap-${name}-`));
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  const manifestPath = path.join(dir, 'capability.json');
  const implementation = path.join(dir, 'index.js');
  await writeFile(implementation, 'export default {};\n');
  const manifest = {
    name,
    version: '1.0.0',
    description: String(metadata.description || name),
    runtime: 'node' as const,
    canonicalPath: implementation,
    ...metadata,
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return {
    root,
    capability: {
      name,
      version: '1.0.0',
      description: manifest.description,
      runtime: 'node',
      canonicalPath: implementation,
      root: dir,
      path: manifestPath,
      consumers: [],
    },
  };
}

test('capability search surfaces semantic matches without embeddings', async () => {
  const wordpress = await fixture('wordpress-publish', {
    description: 'Publish and update WordPress posts',
    purpose: 'Publish content to WordPress',
    domain: 'wordpress',
    operations: ['create-post', 'update-post'],
    keywords: ['wordpress', 'publish', 'post', 'content'],
  });
  const telegram = await fixture('telegram-send', {
    description: 'Send Telegram messages',
    purpose: 'Send Telegram notifications',
    domain: 'telegram',
    operations: ['send-message'],
    keywords: ['telegram', 'notification'],
  });
  try {
    const results = await findSimilarCapabilities('publish wordpress article', [telegram.capability, wordpress.capability]);
    assert.equal(results[0].name, 'wordpress-publish');
    assert.ok(results[0].score > 0);
  } finally {
    await rm(wordpress.root, { recursive: true, force: true });
    await rm(telegram.root, { recursive: true, force: true });
  }
});

test('capability creation blocks same purpose and flags meaningful overlap', async () => {
  const existing = await fixture('wordpress-publish', {
    description: 'Publish and update WordPress posts',
    purpose: 'Publish content to WordPress',
    domain: 'wordpress',
    operations: ['create-post', 'update-post'],
    keywords: ['wordpress', 'publish', 'post'],
  });
  try {
    const samePurpose = await assessCapabilityCandidate({
      name: 'wp-content-writer',
      version: '1.0.0',
      description: 'Create WordPress content',
      purpose: 'Publish content to WordPress',
      domain: 'wordpress',
      operations: ['create-post'],
    }, [existing.capability]);
    assert.equal(samePurpose[0].severity, 'hard');
    assert.ok(samePurpose[0].reason.includes('same canonical purpose'));

    const different = await assessCapabilityCandidate({
      name: 'wordpress-media-read',
      version: '1.0.0',
      description: 'Read WordPress media metadata',
      purpose: 'Read media metadata from WordPress',
      domain: 'wordpress',
      operations: ['get-media'],
      keywords: ['wordpress', 'media', 'read'],
    }, [existing.capability]);
    assert.equal(different.some((item) => item.severity === 'hard'), false);
  } finally {
    await rm(existing.root, { recursive: true, force: true });
  }
});

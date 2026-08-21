import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  detectSupportedPlatform,
  installPlatformAdapter,
  loadInstalledPlatformAdapter,
  readInstalledPlatform,
} from '../src/platform-bootstrap.js';

async function fixture() {
  return mkdtemp(path.join(os.tmpdir(), 'taskrail-platform-'));
}

function digest(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

async function makeManifest(root: string, version = '2.0.8') {
  const files = {
    linux: "export default { id: 'linux-test', platform: 'linux' };\n",
    darwin: "export default { id: 'mac-test', platform: 'darwin' };\n",
    win32: "export default { id: 'windows-test', platform: 'win32' };\n",
  } as const;
  const platforms: Record<string, any> = {};
  for (const [platform, content] of Object.entries(files)) {
    const dir = path.join(root, platform);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'adapter.mjs'), content);
    platforms[platform] = {
      id: `${platform}-fixture`,
      file: `${platform}/adapter.mjs`,
      sha256: digest(content),
      bytes: Buffer.byteLength(content),
    };
  }
  const file = path.join(root, 'manifest.json');
  await writeFile(file, JSON.stringify({ schema: 1, taskrailVersion: version, platforms }, null, 2));
  return file;
}

test('platform detection fails closed for unsupported hosts', () => {
  assert.equal(detectSupportedPlatform('linux'), 'linux');
  assert.equal(detectSupportedPlatform('darwin'), 'darwin');
  assert.equal(detectSupportedPlatform('win32'), 'win32');
  assert.throws(() => detectSupportedPlatform('freebsd'), /unsupported TaskRail platform/);
});

test('bootstrap installs only the requested platform adapter and records receipt', async () => {
  const source = await fixture();
  const target = await fixture();
  try {
    const manifestFile = await makeManifest(source);
    const receipt = await installPlatformAdapter({ platform: 'linux', version: '2.0.8', root: target, manifestFile });
    assert.equal(receipt.platform, 'linux');
    assert.equal(await stat(receipt.adapterPath).then((item) => item.isFile()), true);
    assert.equal(await stat(path.join(target, '2.0.8', 'darwin')).then(() => true, () => false), false);
    assert.equal(await stat(path.join(target, '2.0.8', 'win32')).then(() => true, () => false), false);
    assert.equal((await readInstalledPlatform(target))?.sha256, receipt.sha256);
    const adapter = await loadInstalledPlatformAdapter(target);
    assert.equal(adapter.platform, 'linux');
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

test('checksum corruption fails before adapter is installed', async () => {
  const source = await fixture();
  const target = await fixture();
  try {
    const manifestFile = await makeManifest(source);
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    manifest.platforms.linux.sha256 = '0'.repeat(64);
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
    await assert.rejects(
      installPlatformAdapter({ platform: 'linux', version: '2.0.8', root: target, manifestFile }),
      /checksum mismatch/,
    );
    assert.equal(await readInstalledPlatform(target), null);
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

test('version mismatch fails before download activation', async () => {
  const source = await fixture();
  const target = await fixture();
  try {
    const manifestFile = await makeManifest(source, '3.0.0');
    await assert.rejects(
      installPlatformAdapter({ platform: 'darwin', version: '2.0.8', root: target, manifestFile }),
      /version mismatch/,
    );
    assert.equal(await readInstalledPlatform(target), null);
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

test('failed replacement preserves the previously installed adapter and receipt', async () => {
  const source = await fixture();
  const target = await fixture();
  try {
    const manifestFile = await makeManifest(source);
    const first = await installPlatformAdapter({ platform: 'win32', version: '2.0.8', root: target, manifestFile });
    const originalBytes = await readFile(first.adapterPath);
    const originalReceipt = await readInstalledPlatform(target);

    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    const adapterFile = path.join(source, 'win32', 'adapter.mjs');
    await writeFile(adapterFile, "export default { id: 'tampered' };\n");
    manifest.platforms.win32.bytes = (await stat(adapterFile)).size;
    manifest.platforms.win32.sha256 = 'f'.repeat(64);
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2));

    await assert.rejects(
      installPlatformAdapter({ platform: 'win32', version: '2.0.8', root: target, manifestFile }),
      /checksum mismatch/,
    );
    assert.deepEqual(await readFile(first.adapterPath), originalBytes);
    assert.deepEqual(await readInstalledPlatform(target), originalReceipt);
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

test('missing selected platform payload fails closed without creating registration', async () => {
  const source = await fixture();
  const target = await fixture();
  try {
    const manifestFile = await makeManifest(source);
    await rm(path.join(source, 'linux', 'adapter.mjs'));
    await assert.rejects(
      installPlatformAdapter({ platform: 'linux', version: '2.0.8', root: target, manifestFile }),
      /ENOENT|download failed/,
    );
    assert.equal(await readInstalledPlatform(target), null);
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

test('invalid platform manifest schema is rejected before installation', async () => {
  const source = await fixture();
  const target = await fixture();
  try {
    const manifestFile = await makeManifest(source);
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    manifest.schema = 999;
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
    await assert.rejects(
      installPlatformAdapter({ platform: 'linux', version: '2.0.8', root: target, manifestFile }),
      /unsupported platform manifest schema/,
    );
    assert.equal(await readInstalledPlatform(target), null);
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

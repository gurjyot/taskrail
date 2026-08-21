import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = String(pkg.version);
const out = path.join(root, 'release-install');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

execFileSync(process.execPath, ['--version'], { stdio: 'ignore' });

function npmPack() {
  const args = ['pack', '--ignore-scripts', '--json'];
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    return execFileSync(process.execPath, [npmExecPath, ...args], { cwd: root, encoding: 'utf8' });
  }
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return execFileSync(npmBin, args, { cwd: root, encoding: 'utf8' });
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const packed = JSON.parse(npmPack())[0];
if (!packed?.filename) throw new Error('npm pack did not return a package filename');
const leaked = (packed.files ?? [])
  .map((item) => String(item.path || '').replace(/\\/g, '/'))
  .filter((file) => file.startsWith('platform-install/') || file.startsWith('installers/'));
if (leaked.length) throw new Error(`platform-specific installer payload leaked into TaskRail core package: ${leaked.join(', ')}`);

const source = path.join(root, packed.filename);
const target = path.join(out, packed.filename);
await rename(source, target);
const bytes = await readFile(target);
const sha256 = digest(bytes);
const fileStat = await stat(target);

const manifest = {
  schema: 1,
  taskrailVersion: version,
  framework: {
    file: packed.filename,
    sha256,
    bytes: fileStat.size,
    unpackedBytes: packed.unpackedSize,
  },
};
await writeFile(path.join(out, 'taskrail-install-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(out, 'release.json'), `${JSON.stringify({ tag_name: `v${version}` }, null, 2)}\n`);

const platformSpecs = {
  linux: { id: 'linux', source: path.join(root, 'platform-install', 'linux', 'adapter.mjs'), file: 'taskrail-platform-linux.mjs' },
  darwin: { id: 'macos', source: path.join(root, 'platform-install', 'darwin', 'adapter.mjs'), file: 'taskrail-platform-macos.mjs' },
  win32: { id: 'windows', source: path.join(root, 'platform-install', 'win32', 'adapter.mjs'), file: 'taskrail-platform-windows.mjs' },
};
const platformManifest = { schema: 1, taskrailVersion: version, platforms: {} };
for (const [platform, spec] of Object.entries(platformSpecs)) {
  const adapter = await readFile(spec.source);
  await writeFile(path.join(out, spec.file), adapter);
  platformManifest.platforms[platform] = {
    id: spec.id,
    file: spec.file,
    sha256: digest(adapter),
    bytes: adapter.length,
  };
}
await writeFile(path.join(out, 'taskrail-platform-manifest.json'), `${JSON.stringify(platformManifest, null, 2)}\n`);

console.log(JSON.stringify({ out, leakedPlatformFiles: leaked.length, ...manifest, platformManifest }, null, 2));

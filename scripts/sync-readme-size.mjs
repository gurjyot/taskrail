import { execFileSync } from 'node:child_process';
import { readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const readmeFile = path.join(root, 'README.md');
const checkOnly = process.argv.includes('--check');
const input = process.argv.find((arg) => arg.endsWith('.json') && !arg.startsWith('--'));

function packMetadata() {
  if (input) return JSON.parse(requireText(input))[0];
  const npmExecPath = process.env.npm_execpath;
  const raw = npmExecPath
    ? execFileSync(process.execPath, [npmExecPath, 'pack', '--ignore-scripts', '--json'], { cwd: root, encoding: 'utf8' })
    : execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--ignore-scripts', '--json'], { cwd: root, encoding: 'utf8' });
  return JSON.parse(raw)[0];
}

function requireText(file) {
  return require('node:fs').readFileSync(path.resolve(root, file), 'utf8');
}

function kib(bytes) {
  return Math.round(bytes / 1024);
}

const pack = packMetadata();
if (!pack?.size || !pack?.unpackedSize) throw new Error('missing npm pack size metadata');
const compressed = kib(pack.size);
const unpacked = kib(pack.unpackedSize);
const readme = await readFile(readmeFile, 'utf8');
const top = `<p align="center"><strong>⚡ Tiny framework footprint: ~${compressed} KiB compressed / ~${unpacked} KiB unpacked, with zero runtime npm dependencies.</strong></p>`;
const footprint = `**Current TaskRail package footprint: ~${compressed} KiB compressed / ~${unpacked} KiB unpacked. Runtime npm dependencies: 0.**`;
let next = readme.replace(/<p align="center"><strong>⚡ Tiny framework footprint:[\s\S]*?<\/strong><\/p>/, top);
next = next.replace(/\*\*Current TaskRail package footprint:[\s\S]*?Runtime npm dependencies: 0\.\*\*/, footprint);
if (next === readme) {
  console.log(JSON.stringify({ changed: false, compressedBytes: pack.size, unpackedBytes: pack.unpackedSize, compressedKiB: compressed, unpackedKiB: unpacked }, null, 2));
} else if (checkOnly) {
  console.error(`README footprint is stale. Expected ~${compressed} KiB compressed / ~${unpacked} KiB unpacked.`);
  process.exitCode = 1;
} else {
  await writeFile(readmeFile, next);
  console.log(JSON.stringify({ changed: true, compressedBytes: pack.size, unpackedBytes: pack.unpackedSize, compressedKiB: compressed, unpackedKiB: unpacked }, null, 2));
}
if (!input && pack.filename) await rm(path.resolve(root, pack.filename), { force: true });

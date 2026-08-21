import { execFileSync } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const readmePath = path.join(root, 'README.md');
const checkOnly = process.argv.includes('--check');
const npmExecPath = process.env.npm_execpath;
const args = ['pack', '--ignore-scripts', '--json'];
const raw = npmExecPath
  ? execFileSync(process.execPath, [npmExecPath, ...args], { cwd: root, encoding: 'utf8' })
  : execFileSync(process.platform === 'win32' ? process.execPath : 'npm', process.platform === 'win32' ? [require.resolve('npm/bin/npm-cli.js'), ...args] : args, { cwd: root, encoding: 'utf8' });
const packed = JSON.parse(raw)[0];
if (!packed?.filename) throw new Error('npm pack did not return package metadata');

const compressedKiB = Math.round(Number(packed.size) / 1024);
const unpackedKiB = Math.round(Number(packed.unpackedSize) / 1024);
const readme = await readFile(readmePath, 'utf8');
const start = '<!-- taskrail-size:start -->';
const end = '<!-- taskrail-size:end -->';
const replacement = `${start}\n<p align="center"><strong>⚡ Tiny framework footprint: ~${compressedKiB} KiB compressed / ~${unpackedKiB} KiB unpacked, with zero runtime npm dependencies.</strong></p>\n${end}`;
const pattern = /<!-- taskrail-size:start -->[\s\S]*?<!-- taskrail-size:end -->/;
if (!pattern.test(readme)) throw new Error('README size markers are missing');
const next = readme.replace(pattern, replacement);

try {
  if (checkOnly) {
    if (next !== readme) {
      console.error(`README footprint is stale. Measured ${compressedKiB} KiB compressed / ${unpackedKiB} KiB unpacked.`);
      process.exitCode = 1;
    } else {
      console.log(`README footprint is current: ${compressedKiB} KiB compressed / ${unpackedKiB} KiB unpacked.`);
    }
  } else {
    await writeFile(readmePath, next);
    console.log(`Updated README footprint: ${compressedKiB} KiB compressed / ${unpackedKiB} KiB unpacked.`);
  }
} finally {
  await rm(path.join(root, packed.filename), { force: true });
}

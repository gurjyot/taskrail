import { execFileSync } from 'node:child_process';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = process.cwd();
const readmePath = path.join(root, 'README.md');
const checkOnly = process.argv.includes('--check');
const npmExecPath = process.env.npm_execpath;
const require = createRequire(import.meta.url);

function runNpm(args, options = {}) {
  const common = { cwd: root, ...options };
  if (npmExecPath) return execFileSync(process.execPath, [npmExecPath, ...args], common);
  if (process.platform === 'win32') return execFileSync(process.execPath, [require.resolve('npm/bin/npm-cli.js'), ...args], common);
  return execFileSync('npm', args, common);
}

async function ensureBuilt() {
  try {
    await access(path.join(root, 'dist', 'src', 'index.js'));
  } catch {
    runNpm(['run', 'build'], { stdio: 'inherit' });
  }
}

await ensureBuilt();
const raw = runNpm(['pack', '--ignore-scripts', '--json'], { encoding: 'utf8' });
const packed = JSON.parse(raw)[0];
if (!packed?.filename) throw new Error('npm pack did not return package metadata');

const compressedKiB = Math.round(Number(packed.size) / 1024);
const unpackedKiB = Math.round(Number(packed.unpackedSize) / 1024);
const readme = await readFile(readmePath, 'utf8');
const sizeStart = '<!-- taskrail-size:start -->';
const sizeEnd = '<!-- taskrail-size:end -->';
const sizeReplacement = `${sizeStart}\n<p align="center"><strong>⚡ Tiny framework footprint: ~${compressedKiB} KiB compressed / ~${unpackedKiB} KiB unpacked, with zero runtime npm dependencies.</strong></p>\n${sizeEnd}`;
const sizePattern = /<!-- taskrail-size:start -->[\s\S]*?<!-- taskrail-size:end -->/;
if (!sizePattern.test(readme)) throw new Error('README size markers are missing');

const footprintStart = '<!-- taskrail-footprint:start -->';
const footprintEnd = '<!-- taskrail-footprint:end -->';
const footprintReplacement = `${footprintStart}\n**Current TaskRail package footprint: ~${compressedKiB} KiB compressed / ~${unpackedKiB} KiB unpacked. Runtime npm dependencies: 0.**\n\nMeasured automatically from the actual \`npm pack\` artifact. The CI size-check fails whenever these README figures drift, and the Golden Path release gate enforces an unpacked size budget.\n${footprintEnd}`;
const footprintPattern = /<!-- taskrail-footprint:start -->[\s\S]*?<!-- taskrail-footprint:end -->/;
if (!footprintPattern.test(readme)) throw new Error('README footprint markers are missing');

const next = readme.replace(sizePattern, sizeReplacement).replace(footprintPattern, footprintReplacement);

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

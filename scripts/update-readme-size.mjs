import { readFile, writeFile } from 'node:fs/promises';

const checkOnly = process.argv.includes('--check');
const packFile = process.argv.find((arg) => arg.endsWith('.json')) || 'pack.json';
const pack = JSON.parse(await readFile(packFile, 'utf8'))[0];
if (!pack || !Number.isFinite(pack.size) || !Number.isFinite(pack.unpackedSize)) {
  throw new Error('invalid npm pack metadata');
}

const compressedKiB = Math.round(pack.size / 1024);
const unpackedKiB = Math.round(pack.unpackedSize / 1024);
const readmePath = 'README.md';
let readme = await readFile(readmePath, 'utf8');

const headline = `<!-- taskrail-size:start -->\n<p align="center"><strong>⚡ Tiny framework footprint: ~${compressedKiB} KiB compressed / ~${unpackedKiB} KiB unpacked, with zero runtime npm dependencies.</strong></p>\n<!-- taskrail-size:end -->`;
const footprint = `<!-- taskrail-footprint:start -->\n**Current TaskRail package footprint: ~${compressedKiB} KiB compressed / ~${unpackedKiB} KiB unpacked. Runtime npm dependencies: 0.**\n\nMeasured automatically from the actual \`npm pack\` artifact. The Golden Path release gate enforces an unpacked size budget, and the main-branch size-sync workflow refreshes these figures after framework changes.\n<!-- taskrail-footprint:end -->`;

const headlinePattern = /<!-- taskrail-size:start -->[\s\S]*?<!-- taskrail-size:end -->/;
const footprintPattern = /<!-- taskrail-footprint:start -->[\s\S]*?<!-- taskrail-footprint:end -->/;
if (!headlinePattern.test(readme)) throw new Error('README headline size markers missing');
if (!footprintPattern.test(readme)) throw new Error('README footprint markers missing');
const next = readme.replace(headlinePattern, headline).replace(footprintPattern, footprint);
if (checkOnly) {
  if (next !== readme) {
    console.error(`README footprint is stale. Expected ~${compressedKiB} KiB compressed / ~${unpackedKiB} KiB unpacked.`);
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ current: true, compressedBytes: pack.size, unpackedBytes: pack.unpackedSize, compressedKiB, unpackedKiB }));
  }
} else {
  await writeFile(readmePath, next);
  console.log(JSON.stringify({ changed: next !== readme, compressedBytes: pack.size, unpackedBytes: pack.unpackedSize, compressedKiB, unpackedKiB }));
}

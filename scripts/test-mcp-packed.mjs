import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (args, options = {}) => execFileSync(npm, args, { encoding: 'utf8', stdio: options.stdio ?? ['ignore', 'pipe', 'inherit'], cwd: options.cwd ?? root });

function pack(cwd) {
  const raw = run(['pack', '--ignore-scripts', '--json'], { cwd });
  const result = JSON.parse(raw)[0];
  if (!result?.filename) throw new Error(`npm pack did not return an artifact for ${cwd}`);
  return { ...result, path: path.resolve(cwd, result.filename) };
}

const core = pack(root);
const adapterRoot = path.join(root, 'adapters', 'mcp');
const adapter = pack(adapterRoot);
const temp = await mkdtemp(path.join(os.tmpdir(), 'taskrail-mcp-packed-'));

try {
  await writeFile(path.join(temp, 'package.json'), JSON.stringify({ name: 'taskrail-mcp-fixture', version: '1.0.0', private: true, type: 'module' }, null, 2));
  execFileSync(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', core.path, adapter.path], { cwd: temp, stdio: 'inherit' });

  const installedCore = path.join(temp, 'node_modules', 'taskrail', 'package.json');
  const installedAdapter = path.join(temp, 'node_modules', '@taskrail', 'mcp', 'package.json');
  const corePackage = JSON.parse(await readFile(installedCore, 'utf8'));
  const adapterPackage = JSON.parse(await readFile(installedAdapter, 'utf8'));
  if (corePackage.name !== 'taskrail') throw new Error('packed TaskRail peer was not installed');
  if (adapterPackage.name !== '@taskrail/mcp') throw new Error('packed MCP adapter was not installed');

  const testFile = path.join(temp, 'node_modules', '@taskrail', 'mcp', 'test', 'mcp.test.mjs');
  execFileSync(process.execPath, ['--test', testFile], { cwd: temp, stdio: 'inherit', env: process.env });

  const leaked = (core.files || []).some((item) => String(item.path).replaceAll('\\', '/').startsWith('adapters/mcp/'));
  if (leaked) throw new Error('optional MCP adapter leaked into TaskRail core package');
  console.log(JSON.stringify({ ok: true, core: core.filename, adapter: adapter.filename, coreExcludesMcp: true }, null, 2));
} finally {
  await rm(temp, { recursive: true, force: true });
  await rm(core.path, { force: true });
  await rm(adapter.path, { force: true });
}

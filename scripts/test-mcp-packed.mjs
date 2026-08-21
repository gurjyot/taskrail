import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();

function runNpm(args, options = {}) {
  const execOptions = {
    encoding: 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'inherit'],
    cwd: options.cwd ?? root,
  };
  if (process.platform === 'win32') {
    const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    return execFileSync(process.execPath, [npmCli, ...args], execOptions);
  }
  return execFileSync('npm', args, execOptions);
}

function pack(cwd) {
  const raw = runNpm(['pack', '--ignore-scripts', '--json'], { cwd });
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
  runNpm(['install', '--ignore-scripts', '--no-audit', '--no-fund', core.path, adapter.path, '@modelcontextprotocol/client@2.0.0'], { cwd: temp, stdio: 'inherit' });

  const installedCore = path.join(temp, 'node_modules', 'taskrail', 'package.json');
  const installedAdapter = path.join(temp, 'node_modules', '@taskrail', 'mcp', 'package.json');
  const corePackage = JSON.parse(await readFile(installedCore, 'utf8'));
  const adapterPackage = JSON.parse(await readFile(installedAdapter, 'utf8'));
  if (corePackage.name !== 'taskrail') throw new Error('packed TaskRail peer was not installed');
  if (adapterPackage.name !== '@taskrail/mcp') throw new Error('packed MCP adapter was not installed');
  if ((adapter.files || []).some((item) => String(item.path).replaceAll('\\', '/').startsWith('test/'))) throw new Error('MCP test files leaked into the adapter distribution');

  const smokeFile = path.join(temp, 'mcp-smoke.mjs');
  await writeFile(smokeFile, `
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

const workspace = await mkdtemp(path.join(os.tmpdir(), 'taskrail-mcp-consumer-'));
const auditFile = path.join(workspace, '.taskrail', 'mcp-audit.jsonl');
const server = path.join(process.cwd(), 'node_modules', '@taskrail', 'mcp', 'server.mjs');
const client = new Client({ name: 'taskrail-packed-smoke', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env, TASKRAIL_WORKSPACE: workspace, TASKRAIL_MCP_AUDIT_FILE: auditFile } });
try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name);
  assert.equal(names.length > 0, true);
  for (const name of names) assert.doesNotMatch(name, /(deploy|ship|update|recover|pause|resume|scaffold|write|delete|secret)/i);
  const result = await client.callTool({ name: 'taskrail_agent_contract', arguments: {} });
  assert.equal(result.isError, undefined, JSON.stringify(result.content));
  const text = result.content?.find((item) => item.type === 'text')?.text || '';
  assert.match(text, /stdio|readActionsDefault|controlActionsDefault/);
  const audit = JSON.parse((await readFile(auditFile, 'utf8')).trim());
  assert.equal(audit.tool, 'taskrail_agent_contract');
  assert.equal(audit.risk, 'read');
  assert.equal(audit.ok, true);
  assert.equal('arguments' in audit, false);
  assert.equal('stdout' in audit, false);
  assert.equal('stderr' in audit, false);
} finally {
  await client.close().catch(() => undefined);
  await rm(workspace, { recursive: true, force: true });
}
`);
  execFileSync(process.execPath, [smokeFile], { cwd: temp, stdio: 'inherit', env: process.env });

  const leaked = (core.files || []).some((item) => String(item.path).replaceAll('\\', '/').startsWith('adapters/mcp/'));
  if (leaked) throw new Error('optional MCP adapter leaked into TaskRail core package');
  console.log(JSON.stringify({ ok: true, core: core.filename, adapter: adapter.filename, coreExcludesMcp: true, adapterExcludesTests: true }, null, 2));
} finally {
  await rm(temp, { recursive: true, force: true });
  await rm(core.path, { force: true });
  await rm(adapter.path, { force: true });
}

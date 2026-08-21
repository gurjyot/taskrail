import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { readTools, runReadTool, toolCatalog } from '../core.mjs';

const adapterRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverFile = path.join(adapterRoot, 'server.mjs');

test('MCP catalog is read-only and excludes TaskRail mutation controls', () => {
  const names = toolCatalog().map((item) => item.name);
  assert.deepEqual(names, readTools.map((item) => item.name));
  assert.equal(names.length > 0, true);
  for (const name of names) assert.doesNotMatch(name, /(deploy|ship|update|recover|pause|resume|scaffold|write|delete|secret)/i);
});

test('MCP bridge rejects unknown mutation names and control characters before execution', async () => {
  await assert.rejects(runReadTool('automation.update'), /unknown or unauthorized/);
  await assert.rejects(runReadTool('taskrail_capability_find', { query: 'safe\nsecond-command' }), /control characters/);
});

test('official MCP client can call TaskRail read tool over stdio and audit contains metadata only', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'taskrail-mcp-'));
  const auditFile = path.join(workspace, '.taskrail', 'mcp-audit.jsonl');
  const client = new Client({ name: 'taskrail-mcp-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverFile],
    env: {
      ...process.env,
      TASKRAIL_WORKSPACE: workspace,
      TASKRAIL_MCP_AUDIT_FILE: auditFile,
    },
  });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, toolCatalog().map((tool) => tool.name).sort());
    for (const name of names) assert.doesNotMatch(name, /(deploy|ship|update|recover|pause|resume|scaffold|write|delete)/i);

    const result = await client.callTool({ name: 'taskrail_agent_contract', arguments: {} });
    assert.equal(result.isError, undefined);
    const text = result.content?.find((item) => item.type === 'text')?.text || '';
    assert.match(text, /stdio|readActionsDefault|controlActionsDefault/);

    const lines = (await readFile(auditFile, 'utf8')).trim().split(/\r?\n/).filter(Boolean);
    assert.equal(lines.length, 1);
    const audit = JSON.parse(lines[0]);
    assert.equal(audit.tool, 'taskrail_agent_contract');
    assert.equal(audit.risk, 'read');
    assert.equal(audit.ok, true);
    assert.equal(typeof audit.requestHash, 'string');
    assert.equal('arguments' in audit, false);
    assert.equal('stdout' in audit, false);
    assert.equal('stderr' in audit, false);
  } finally {
    await client.close().catch(() => undefined);
    await rm(workspace, { recursive: true, force: true });
  }
});

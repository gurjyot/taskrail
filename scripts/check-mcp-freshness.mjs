import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const framework = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const adapter = JSON.parse(await readFile(path.join(root, 'adapters', 'mcp', 'package.json'), 'utf8'));
const core = await readFile(path.join(root, 'adapters', 'mcp', 'core.mjs'), 'utf8');
const server = await readFile(path.join(root, 'adapters', 'mcp', 'server.mjs'), 'utf8');

const requiredAbilities = [
  'taskrail_components',
  'taskrail_component',
  'taskrail_capability_find',
  'taskrail_capability',
  'taskrail_usage',
  'taskrail_conformance',
  'taskrail_security_audit',
  'taskrail_agent_contract',
];

const forbiddenAbility = /(deploy|ship|update|recover|pause|resume|scaffold|write|delete|secret)/i;
const declared = [...core.matchAll(/name:\s*'([^']+)'/g)].map((match) => match[1]).filter((name) => name.startsWith('taskrail_'));
const checks = [
  { name: 'reviewed-for-framework', ok: adapter.reviewedForTaskRail === framework.version, expected: framework.version, actual: adapter.reviewedForTaskRail ?? null },
  { name: 'adapter-version-export', ok: core.includes(`MCP_ADAPTER_VERSION = '${adapter.version}'`), expected: adapter.version },
  { name: 'server-uses-adapter-version', ok: server.includes('version: MCP_ADAPTER_VERSION') },
  { name: 'peer-supports-v3', ok: String(adapter.peerDependencies?.taskrail || '').includes('<4'), actual: adapter.peerDependencies?.taskrail ?? null },
  { name: 'read-only-catalog', ok: declared.every((name) => !forbiddenAbility.test(name)), actual: declared },
  ...requiredAbilities.map((ability) => ({ name: `ability:${ability}`, ok: declared.includes(ability) && server.includes(`'${ability}'`) })),
];

const ok = checks.every((check) => check.ok);
console.log(JSON.stringify({ schema: 1, taskrailVersion: framework.version, adapterVersion: adapter.version, reviewedForTaskRail: adapter.reviewedForTaskRail ?? null, ok, checks }, null, 2));
if (!ok) {
  console.error(`TaskRail MCP is stale. Review adapters/mcp for TaskRail ${framework.version}, update abilities if needed, and set reviewedForTaskRail to the exact framework version.`);
  process.exitCode = 1;
}

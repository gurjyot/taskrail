import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const source = await readFile(path.join(root, 'src', 'taskrail-cli.ts'), 'utf8');
const agentSource = await readFile(path.join(root, 'src', 'agent-surface.ts'), 'utf8');
const platformManifest = JSON.parse(await readFile(path.join(root, 'platform-install', 'manifest.json'), 'utf8'));
const mcpCompatibility = JSON.parse(await readFile(path.join(root, 'adapters', 'mcp', 'compatibility.json'), 'utf8'));
const mcpPackage = JSON.parse(await readFile(path.join(root, 'adapters', 'mcp', 'package.json'), 'utf8'));
const coreText = await readFile(path.join(root, 'adapters', 'mcp', 'core.mjs'), 'utf8');
const serverText = await readFile(path.join(root, 'adapters', 'mcp', 'server.mjs'), 'utf8');

const checks = [];
const add = (name, ok, detail = '') => checks.push({ name, ok, detail });
const versionMatch = (await readFile(path.join(root, 'src', 'version.ts'), 'utf8')).match(/TASKRAIL_VERSION\s*=\s*['\"]([^'\"]+)['\"]/);
add('version:source', versionMatch?.[1] === pkg.version, `${versionMatch?.[1] || 'missing'} / ${pkg.version}`);
add('version:platform-manifest', platformManifest.taskrailVersion === pkg.version, `${platformManifest.taskrailVersion} / ${pkg.version}`);
add('mcp:reviewed-for-core', mcpCompatibility.reviewedForTaskRail === pkg.version, `${mcpCompatibility.reviewedForTaskRail} / ${pkg.version}`);
add('mcp:peer-range', typeof mcpPackage.peerDependencies?.taskrail === 'string' && mcpPackage.peerDependencies.taskrail.includes('<4'), mcpPackage.peerDependencies?.taskrail || 'missing');

const compositionMatch = source.match(/compositionCommands\s*=\s*new Set\(\[([^\]]+)\]\)/s);
const compositionCommands = compositionMatch ? [...compositionMatch[1].matchAll(/['\"]([^'\"]+)['\"]/g)].map((match) => match[1]) : [];
const routedCommands = [...source.matchAll(/\b(?:if|else if)\s*\(command\s*===\s*['\"]([^'\"]+)['\"]/g)].map((match) => match[1]);
const cliCommands = [...new Set([...compositionCommands, ...routedCommands])].sort();
const exposed = new Set(mcpCompatibility.exposedCommands || []);
const excluded = new Set(Object.keys(mcpCompatibility.excludedCommands || {}));
const classified = new Set([...exposed, ...excluded]);
const unclassified = cliCommands.filter((command) => !classified.has(command));
const unknownClassifications = [...classified].filter((command) => !cliCommands.includes(command));
const overlap = [...exposed].filter((command) => excluded.has(command));
add('mcp:all-cli-commands-reviewed', unclassified.length === 0, unclassified.join(', ') || 'all classified');
add('mcp:no-stale-command-classifications', unknownClassifications.length === 0, unknownClassifications.join(', ') || 'none');
add('mcp:no-exposed-excluded-overlap', overlap.length === 0, overlap.join(', ') || 'none');

const exposedCommandNeedles = { components: "['components']", 'capability-find': "['capability-find'", usage: "['usage']", conformance: "['conformance']", security: "['security', 'audit', '--strict']", agent: "['agent', 'describe']" };
for (const command of exposed) { const needle = exposedCommandNeedles[command]; add(`mcp:exposed:${command}`, Boolean(needle && coreText.includes(needle)), needle || 'missing command mapping'); }

const safeReadActions = [...agentSource.matchAll(/name:\s*'([^']+)'[^\n]+risk:\s*'read'[^\n]+defaultAllowed:\s*true/g)].map((match) => match[1]).sort();
const readActionMap = mcpCompatibility.requiredReadActions || {};
const mappedReadActions = Object.keys(readActionMap).sort();
const missingReadActions = safeReadActions.filter((action) => !mappedReadActions.includes(action));
const staleReadActions = mappedReadActions.filter((action) => !safeReadActions.includes(action));
add('mcp:all-safe-read-actions-mapped', missingReadActions.length === 0, missingReadActions.join(', ') || 'all mapped');
add('mcp:no-stale-read-action-mappings', staleReadActions.length === 0, staleReadActions.join(', ') || 'none');
for (const [action, tool] of Object.entries(readActionMap)) {
  add(`mcp:read-action:${action}:core`, coreText.includes(`name: '${tool}'`), tool);
  add(`mcp:read-action:${action}:server`, serverText.includes(`'${tool}'`), tool);
}

const skillsRoot = path.join(root, 'skills');
const skillEntries = (await readdir(skillsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory());
for (const entry of skillEntries) { const content = await readFile(path.join(skillsRoot, entry.name, 'SKILL.md'), 'utf8'); const match = content.match(/^reviewed_for_taskrail:\s*[\"']?([^\s\"']+)[\"']?\s*$/m); add(`skill:${entry.name}:reviewed-for-core`, match?.[1] === pkg.version, `${match?.[1] || 'missing'} / ${pkg.version}`); }

const requiredSurfaces = ['adapters/mcp/core.mjs','adapters/mcp/server.mjs','adapters/mcp/test/mcp.test.mjs','scripts/test-mcp-packed.mjs','.github/workflows/mcp-adapter.yml','installers/taskrail-install-linux.sh','installers/TaskRail-Install.command','installers/TaskRail-Install.ps1','platform-install/linux/adapter.mjs','platform-install/darwin/adapter.mjs','platform-install/win32/adapter.mjs','AGENTS.md','FRAMEWORK.md','README.md'];
for (const file of requiredSurfaces) { const ok = await readFile(path.join(root, file), 'utf8').then(() => true, () => false); add(`surface:${file}`, ok, file); }

const ok = checks.every((check) => check.ok);
const report = { schema: 1, taskrailVersion: pkg.version, ok, passed: checks.filter((check) => check.ok).length, failed: checks.filter((check) => !check.ok).length, cliCommands, safeReadActions, checks };
console.log(JSON.stringify(report, null, 2));
if (!ok) { console.error('TaskRail update surfaces are stale. Review MCP safe-read coverage, skills, platform/install assets, docs, and compatibility classifications before release.'); process.exitCode = 1; }

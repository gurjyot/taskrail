import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const taskrailCli = path.join(root, 'dist', 'src', 'taskrail-cli.js');
const capabilitiesRepo = path.resolve(process.env.TASKRAIL_CAPABILITIES_REPO || path.join(root, '..', 'taskrail-capabilities'));
const automationsRepo = path.resolve(process.env.TASKRAIL_AUTOMATIONS_REPO || path.join(root, '..', 'taskrail-automations'));
const capabilityRoot = path.join(capabilitiesRepo, 'capabilities');

const checks = [];
function run(name, command, args, cwd, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
    shell: false,
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  const ok = result.status === 0 && !result.error;
  checks.push({
    name,
    ok,
    exitCode: result.status ?? 1,
    error: result.error ? String(result.error.message || result.error) : undefined,
    stderr: ok ? undefined : String(result.stderr || '').slice(-4000),
  });
  return ok;
}

function requireDir(label, dir) {
  const ok = fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  checks.push({ name: `repo:${label}`, ok, path: dir });
  return ok;
}

function automationDirs(repoPath) {
  const found = [];
  const skip = new Set(['node_modules', '.git', '.taskrail', 'dist', 'out']);
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name === 'automation.json') found.push(path.dirname(full));
    }
  }
  walk(repoPath);
  return found.sort();
}

if (!fs.existsSync(taskrailCli)) {
  console.error('TaskRail candidate CLI is missing. Run npm run build first.');
  process.exit(1);
}

const capabilitiesPresent = requireDir('taskrail-capabilities', capabilitiesRepo);
const automationsPresent = requireDir('taskrail-automations', automationsRepo);

if (capabilitiesPresent) {
  run('capabilities:npm-ci', 'npm', ['ci'], capabilitiesRepo);
  run('capabilities:test', 'npm', ['test'], capabilitiesRepo);
  run('capabilities:check', 'npm', ['run', 'check'], capabilitiesRepo);

  const names = fs.readdirSync(capabilityRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(capabilityRoot, entry.name, 'capability.json')))
    .map((entry) => entry.name)
    .sort();
  checks.push({ name: 'capabilities:discovered', ok: names.length > 0, count: names.length });
  for (const name of names) {
    run(
      `capability:${name}`,
      process.execPath,
      [taskrailCli, 'capability-check', name, '--strict'],
      capabilitiesRepo,
      { TASKRAIL_CAPABILITY_ROOTS: capabilityRoot },
    );
  }
}

if (automationsPresent) {
  run('automations:npm-ci', 'npm', ['ci'], automationsRepo);
  run('automations:test', 'npm', ['test'], automationsRepo);
  run('automations:check', 'npm', ['run', 'check'], automationsRepo);

  const dirs = automationDirs(automationsRepo);
  checks.push({ name: 'automations:discovered', ok: dirs.length > 0, count: dirs.length });
  for (const dir of dirs) {
    const label = path.relative(automationsRepo, dir) || '.';
    const env = { TASKRAIL_CAPABILITY_ROOTS: capabilityRoot };
    const checked = run(`automation:${label}:check`, process.execPath, [taskrailCli, 'check', dir], automationsRepo, env);
    if (checked) run(`automation:${label}:test`, process.execPath, [taskrailCli, 'test', dir], automationsRepo, env);
  }
}

const ok = checks.every((item) => item.ok);
const report = {
  schema: 1,
  taskrailSha: process.env.GITHUB_SHA || null,
  ok,
  passed: checks.filter((item) => item.ok).length,
  failed: checks.filter((item) => !item.ok).length,
  checks,
};
console.log(JSON.stringify(report, null, 2));
if (!ok) process.exitCode = 1;

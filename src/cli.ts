import { readFile, access, constants, stat, mkdir, readlink, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateConfig } from './validation.js';
import { check as frameworkCheck, doctor as frameworkDoctor, loadPlugins, rollbackFromManifest, runHealthCheck, safeDeploy } from './deployment.js';
import { buildPlan } from './plan.js';
import { inspectChange } from './change.js';
import { TASKRAIL_VERSION } from './version.js';
import type { AutomationPlugin, DeployState, FrameworkManifest } from './types.js';
import { runGate } from './gate.js';
import { capabilityImpact, capabilityRootsFor, findAutomation, getCapability, listManagedAutomations, loadCapabilities, workspaceCapabilityRoots } from './capabilities.js';
import { detectEnvironment } from './env.js';
import { inspectGitState } from './git.js';
import { detectDrift } from './drift.js';
import { isCompatible, loadManifest, resolvePaths } from './config.js';
import { compactManifest, inferProfile, resolveFrameworkManifest, frameworkCapabilities, frameworkProfiles } from './framework.js';
import { isStale, readLock, releaseLock } from './locks.js';

const fallbackManifest: FrameworkManifest = {
  name: 'taskrail',
  taskrailCompatibility: '2.0.x',
  runtime: 'node',
  managed: true,
  sourceDir: 'src',
  deployDir: 'dist/src',
  validationCommand: 'node -e "process.exit(0)"',
  testCommand: 'node -e "process.exit(0)"',
  backup: { retain: 3 },
  healthCheck: { type: 'file', path: 'index.js' },
};

const plugin: AutomationPlugin = { name: 'core', async healthCheck() { return { ok: true }; } };

function output(value: unknown) { console.log(JSON.stringify(value, null, 2)); }
function compact(lines: Array<string | undefined>) { console.log(lines.filter(Boolean).join('\n')); }
function passLine(ok: boolean) { return ok ? 'PASS' : 'FAIL'; }

function normalizedRoots(roots: string[], cwd: string) {
  return roots.map((root) => (path.isAbsolute(root) ? path.normalize(root) : path.resolve(cwd, root))).sort();
}

function normalizedCompatibility(declared: string | undefined) {
  if (!declared) return declared;
  const trimmed = declared.trim();
  if (/^\d+\.\d+\.\d+$/.test(trimmed)) {
    const [major, minor] = trimmed.split('.');
    const [currentMajor, currentMinor] = TASKRAIL_VERSION.split('.');
    if (major === currentMajor && minor === currentMinor) return `${major}.${minor}.x`;
  }
  return declared;
}

function canonicalizeUpgradeManifest(rawManifest: FrameworkManifest, cwd: string) {
  const profile = inferProfile(rawManifest, cwd);
  const candidate: FrameworkManifest = {
    ...rawManifest,
    taskrailCompatibility: normalizedCompatibility(rawManifest.taskrailCompatibility),
    profile: rawManifest.profile || profile || undefined,
    frameworkCapabilities: rawManifest.frameworkCapabilities ?? [],
  };
  const defaultRoots = normalizedRoots(capabilityRootsFor({ ...candidate, capabilityRoots: [] }, cwd), cwd);
  const explicitRoots = normalizedRoots(rawManifest.capabilityRoots ?? [], cwd);
  if (explicitRoots.length && explicitRoots.every((root) => defaultRoots.includes(root))) delete candidate.capabilityRoots;
  return { candidate, inferredProfile: profile };
}

async function loadConfigManifest(cwd = process.cwd()): Promise<FrameworkManifest> {
  try {
    return resolveFrameworkManifest(JSON.parse(await readFile(path.join(cwd, 'automation.json'), 'utf8')) as FrameworkManifest);
  } catch {
    return fallbackManifest;
  }
}

async function resolveContext(nameOrPath?: string) {
  const baseCwd = process.cwd();
  if (!nameOrPath) {
    const manifestPath = path.join(baseCwd, 'automation.json');
    const rawManifest = await loadManifest(manifestPath).catch(() => fallbackManifest);
    return { cwd: baseCwd, manifestPath, rawManifest, manifest: resolveFrameworkManifest(rawManifest) };
  }
  const manifestPath = await findAutomation(nameOrPath, baseCwd);
  if (!manifestPath) throw new Error(`automation not found: ${nameOrPath}`);
  const cwd = path.dirname(manifestPath);
  const rawManifest = await loadManifest(manifestPath);
  return { cwd, manifestPath, rawManifest, manifest: resolveFrameworkManifest(rawManifest) };
}

function takeTarget(rest: string[]) {
  const first = rest[0];
  if (!first || first.startsWith('--')) return { target: undefined, rest };
  return { target: first, rest: rest.slice(1) };
}

async function readStateFile(manifest: FrameworkManifest, cwd: string) {
  const deployDir = resolvePaths(manifest, cwd).deployDir;
  const statePath = path.join(path.dirname(deployDir), `${manifest.name}.deploy-state.json`);
  try {
    return { statePath, state: JSON.parse(await readFile(statePath, 'utf8')) as DeployState };
  } catch {
    return { statePath, state: null };
  }
}

async function commandEnv(manifest: FrameworkManifest, cwd: string, json = false) {
  const envInfo = detectEnvironment(manifest, cwd);
  if (json) return output(envInfo);
  compact([`STATUS: PASS`, `ENV: ${envInfo.name}`, `OVERRIDE: ${envInfo.overridden ? 'yes' : 'no'}`, `REASON: ${envInfo.reason}`]);
}

async function commandPaths(manifest: FrameworkManifest, cwd: string, json = false) {
  const paths = resolvePaths(manifest, cwd);
  const workspace = path.dirname(paths.deployDir);
  const state = await readStateFile(manifest, cwd);
  const payload = {
    automation: manifest.name,
    env: detectEnvironment(manifest, cwd).name,
    sourceDir: paths.sourceDir,
    deployDir: paths.deployDir,
    workspace,
    releasesDir: manifest.deployStrategy?.releaseRoot ? path.resolve(cwd, manifest.deployStrategy.releaseRoot) : path.join(workspace, '.taskrail', 'releases'),
    candidateDir: path.join(workspace, `${manifest.name}.candidate`),
    stateFile: state.statePath,
    currentRelease: state.state?.currentReleaseId || 'none',
    lastKnownGood: state.state?.lastKnownGoodReleaseId || 'none',
  };
  if (json) return output(payload);
  compact([
    `STATUS: PASS`,
    `ENV: ${payload.env}`,
    `SOURCE: ${payload.sourceDir}`,
    `DEPLOY: ${payload.deployDir}`,
    `CURRENT: ${payload.currentRelease}`,
    `LAST_KNOWN_GOOD: ${payload.lastKnownGood}`,
  ]);
}

async function commandList() { output(await listManagedAutomations(process.cwd())); }

async function commandInspect(nameOrPath: string | undefined) {
  if (!nameOrPath) {
    console.error('usage: taskrail inspect <automation>');
    process.exitCode = 1;
    return;
  }
  const { manifestPath, manifest } = await resolveContext(nameOrPath);
  const roots = capabilityRootsFor(manifest, path.dirname(manifestPath));
  const registry = await loadCapabilities(roots);
  const used = (manifest.capabilities ?? []).map((name) => registry.capabilities.find((capability) => capability.name === name)).filter(Boolean);
  output({
    name: manifest.name,
    profile: manifest.profile || null,
    frameworkCapabilities: manifest.frameworkCapabilities ?? [],
    manifestPath,
    sourceDir: manifest.sourceDir,
    deployDir: manifest.deployDir,
    runtime: manifest.runtime,
    deployStrategy: manifest.deployStrategy?.type || 'replace-in-place',
    capabilities: used.map((capability) => ({ name: capability!.name, version: capability!.version, canonicalPath: capability!.canonicalPath })),
  });
}

async function commandStatus(json = false) {
  const automations = await listManagedAutomations(process.cwd());
  const roots = await workspaceCapabilityRoots(process.cwd());
  const registry = await loadCapabilities(roots);
  const consumers = new Map<string, string[]>();
  for (const automation of automations) for (const capability of automation.capabilities) consumers.set(capability, [...(consumers.get(capability) ?? []), automation.name]);
  const payload = {
    version: TASKRAIL_VERSION,
    automations: automations.map((automation) => ({ name: automation.name, manifestPath: automation.manifestPath, runtime: automation.runtime, capabilities: automation.capabilities, status: automation.status })),
    capabilities: registry.capabilities.map((capability) => ({ name: capability.name, version: capability.version, description: capability.description, canonicalPath: capability.canonicalPath, consumers: consumers.get(capability.name) ?? [] })),
  };
  if (json) return output(payload);
  compact([`STATUS: PASS`, `VERSION: ${payload.version}`, `AUTOMATIONS: ${payload.automations.length}`, `CAPABILITIES: ${payload.capabilities.length}`]);
}

async function commandCapabilities(manifest: FrameworkManifest, cwd: string) {
  const roots = capabilityRootsFor(manifest, cwd);
  const registry = await loadCapabilities(roots);
  if (registry.errors.length) {
    output({ ok: false, errors: registry.errors });
    process.exitCode = 1;
    return;
  }
  output(registry.capabilities.map((capability) => ({ name: capability.name, version: capability.version, description: capability.description, canonicalPath: capability.canonicalPath })));
}

async function commandCapability(manifest: FrameworkManifest, cwd: string, name: string | undefined) {
  if (!name) {
    console.error('usage: taskrail capability <name>');
    process.exitCode = 1;
    return;
  }
  const roots = capabilityRootsFor(manifest, cwd);
  const result = await getCapability(name, roots);
  if (!result) {
    console.error(`capability not found: ${name}`);
    process.exitCode = 1;
    return;
  }
  output({ ...result, consumers: (await capabilityImpact(name, process.cwd())).map((consumer) => consumer.name) });
}

async function commandImpact(name: string | undefined) {
  if (!name) {
    console.error('usage: taskrail capability-impact <name>');
    process.exitCode = 1;
    return;
  }
  output(await capabilityImpact(name, process.cwd()));
}

async function commandBootstrap(manifest: FrameworkManifest, cwd: string, json = false) {
  const envInfo = detectEnvironment(manifest, cwd);
  const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
  const push = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });
  const git = inspectGitState(cwd);
  push('git', git.available, git.error);
  if (manifest.runtime === 'node') push('runtime:node', true, process.version);
  if (envInfo.name === 'production') {
    const systemctl = spawnSync('systemctl', ['--version'], { encoding: 'utf8' });
    push('systemd', systemctl.status === 0, systemctl.status === 0 ? 'ok' : 'missing');
  } else push('systemd', true, `skipped in ${envInfo.name}`);
  const deployRoot = path.dirname(resolvePaths(manifest, cwd).deployDir);
  await mkdir(path.join(deployRoot, '.taskrail', 'releases'), { recursive: true }).catch(() => undefined);
  push('releasesDir', await stat(path.join(deployRoot, '.taskrail', 'releases')).then(() => true, () => false));
  for (const file of manifest.requiredSharedFiles ?? []) {
    const target = typeof file === 'string' ? file : file.path;
    push(`shared:${target}`, await access(target, constants.F_OK).then(() => true, () => false));
  }
  const ok = checks.every((check) => check.ok);
  if (json) return output({ environment: envInfo, checks, ok });
  compact([`STATUS: ${passLine(ok)}`, `ENV: ${envInfo.name}`, `CHECKS: ${checks.length}`, `NEXT: ${ok ? 'taskrail doctor' : 'taskrail explain bootstrap'}`]);
  if (!ok) process.exitCode = 1;
}

async function commandDrift(manifest: FrameworkManifest, cwd: string, json = false) {
  const { state } = await readStateFile(manifest, cwd);
  try {
    if (!state?.releasePath) throw new Error('missing release path');
    const drift = await detectDrift(resolvePaths(manifest, cwd).deployDir, state.releasePath, manifest);
    if (json) return output(drift);
    compact([`STATUS: ${passLine(!drift.drifted)}`, `ENV: ${detectEnvironment(manifest, cwd).name}`, `DRIFT: ${drift.drifted ? drift.files.join(', ') : 'none'}`, `NEXT: ${drift.drifted ? 'taskrail reconcile' : 'taskrail ship'}`]);
    if (drift.drifted) process.exitCode = 1;
  } catch {
    compact([`STATUS: FAIL`, `DRIFT: unknown`, `NEXT: taskrail explain drift`]);
    process.exitCode = 1;
  }
}

async function commandReconcile(manifest: FrameworkManifest, cwd: string, json = false) {
  const { state } = await readStateFile(manifest, cwd);
  try {
    const drift = await detectDrift(resolvePaths(manifest, cwd).deployDir, state?.releasePath || resolvePaths(manifest, cwd).sourceDir, manifest);
    const source = drift.items.filter((item) => item.kind === 'source');
    const runtime = drift.items.filter((item) => item.kind !== 'source');
    const ok = source.length === 0;
    if (json) return output({ ok, source, runtime });
    compact([`STATUS: ${passLine(ok)}`, `SOURCE_DRIFT: ${source.length}`, `RUNTIME_DRIFT: ${runtime.length}`, `NEXT: ${ok ? 'taskrail ship' : 'inspect live changes before deploy'}`]);
    if (!ok) process.exitCode = 1;
  } catch {
    compact([`STATUS: FAIL`, `NEXT: taskrail explain reconcile`]);
    process.exitCode = 1;
  }
}

async function commandRepair(manifest: FrameworkManifest, cwd: string, json = false) {
  const fixes: Array<{ name: string; ok: boolean; detail?: string }> = [];
  const paths = resolvePaths(manifest, cwd);
  const workspace = path.dirname(paths.deployDir);
  const lockDir = path.join(workspace, '.taskrail', 'lock');
  const lock = await readLock(lockDir);
  if (lock && await isStale(lock, lockDir)) {
    await releaseLock(lockDir);
    fixes.push({ name: 'stale-lock', ok: true, detail: 'removed' });
  } else fixes.push({ name: 'stale-lock', ok: true, detail: lock ? 'active-kept' : 'none' });
  await mkdir(path.join(workspace, '.taskrail', 'releases'), { recursive: true });
  fixes.push({ name: 'managed-dirs', ok: true, detail: 'ok' });
  const { state } = await readStateFile(manifest, cwd);
  try {
    if (state?.releasePath) {
      const target = paths.deployDir;
      const linked = await readlink(target).catch(() => null);
      if (linked) {
        const resolved = path.resolve(path.dirname(target), linked);
        const exists = await stat(resolved).then(() => true, () => false);
        if (!exists) {
          await rm(target, { force: true, recursive: true });
          await import('node:fs/promises').then(({ symlink }) => symlink(state.releasePath!, target, 'dir'));
          fixes.push({ name: 'broken-symlink', ok: true, detail: 'relinked' });
        } else fixes.push({ name: 'broken-symlink', ok: true, detail: 'ok' });
      } else fixes.push({ name: 'broken-symlink', ok: true, detail: 'not-symlink' });
    }
  } catch {
    fixes.push({ name: 'broken-symlink', ok: false, detail: 'repair failed' });
  }
  if (manifest.serviceManager?.type === 'systemd' && detectEnvironment(manifest, cwd).name === 'production') {
    const reload = spawnSync('systemctl', ['daemon-reload'], { encoding: 'utf8' });
    fixes.push({ name: 'systemd-reload', ok: reload.status === 0, detail: reload.status === 0 ? 'ok' : 'failed' });
  }
  const ok = fixes.every((item) => item.ok);
  if (json) return output({ ok, fixes });
  compact([`STATUS: ${passLine(ok)}`, `ENV: ${detectEnvironment(manifest, cwd).name}`, `FIXES: ${fixes.length}`, `NEXT: ${ok ? 'taskrail doctor' : 'taskrail explain repair'}`]);
  if (!ok) process.exitCode = 1;
}

async function commandExplain(topic: string | undefined, manifest: FrameworkManifest, cwd: string) {
  compact([`STATUS: PASS`, `CODE: ${topic || 'unknown'}`, `ENV: ${detectEnvironment(manifest, cwd).name}`, `CAUSE: see latest command output or failure report`, `NEXT: inspect the failing stage only`]);
}

async function commandUpgrade(rawManifest: FrameworkManifest, manifest: FrameworkManifest, manifestPath: string, cwd: string, write = false) {
  const { candidate, inferredProfile } = canonicalizeUpgradeManifest(rawManifest, cwd);
  const compacted = compactManifest(candidate);
  const changed = JSON.stringify(rawManifest, null, 2) !== JSON.stringify(compacted, null, 2);
  const unsupportedCaps = (compacted.frameworkCapabilities ?? []).filter((item) => !frameworkCapabilities[item]);
  const unsupportedProfile = compacted.profile ? !frameworkProfiles[compacted.profile] : false;
  const ambiguous = !compacted.profile && (rawManifest.profile ? false : true);
  if (ambiguous && !write) {
    compact([`STATUS: FAIL`, `ENV: ${detectEnvironment(manifest, cwd).name}`, `CAUSE: ambiguous profile upgrade`, `NEXT: inspect service/timer contract`]);
    process.exitCode = 1;
    return;
  }
  if ((unsupportedCaps.length || unsupportedProfile) && !write) {
    compact([`STATUS: FAIL`, `ENV: ${detectEnvironment(manifest, cwd).name}`, `CAUSE: breaking migration required`, `NEXT: inspect profile/capability versions`]);
    process.exitCode = 1;
    return;
  }
  if (ambiguous && write) {
    compact([`STATUS: FAIL`, `ENV: ${detectEnvironment(manifest, cwd).name}`, `CAUSE: ambiguous profile upgrade`, `NEXT: inspect service/timer contract`]);
    process.exitCode = 1;
    return;
  }
  if (write && changed) await import('node:fs/promises').then(({ writeFile }) => writeFile(manifestPath, `${JSON.stringify(compacted, null, 2)}\n`));
  const resolved = resolveFrameworkManifest(compacted);
  const checked = await frameworkCheck(resolved, { cwd });
  const tested = await runGate(resolved, cwd, await loadPlugins(resolved).catch(() => []));
  compact([
    `STATUS: ${passLine(checked.ok && tested.verdict === 'PASS' && unsupportedCaps.length === 0 && !unsupportedProfile)}`,
    `ENV: ${detectEnvironment(resolved, cwd).name}`,
    `PROFILE: ${compacted.profile || inferredProfile || 'none'}`,
    `CHANGED: ${changed && write ? 'yes' : 'no'}`,
    `NEXT: ${checked.ok && tested.verdict === 'PASS' ? 'taskrail ship' : 'taskrail explain upgrade'}`,
  ]);
  if (!checked.ok || tested.verdict !== 'PASS' || unsupportedCaps.length || unsupportedProfile) process.exitCode = 1;
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] ?? '--help';
  const incoming = args.slice(1);
  const targetCommands = new Set(['env', 'paths', 'bootstrap', 'repair', 'check', 'plan', 'doctor', 'drift', 'reconcile', 'test', 'deploy', 'health', 'rollback', 'gate', 'verify-change', 'ship', 'upgrade']);
  const { target, rest } = targetCommands.has(cmd) ? takeTarget(incoming) : { target: undefined, rest: incoming };

  if (cmd === '--help' || cmd === 'help') {
    console.log('taskrail env|paths|bootstrap|repair|upgrade|check|plan|doctor|drift|reconcile|test|deploy|health|rollback|gate|verify-change|ship|explain|list|status|inspect|capabilities|capability|impact');
    return;
  }

  if (cmd === 'list') return commandList();
  if (cmd === 'status') return commandStatus(rest.includes('--json'));
  if (cmd === 'inspect') return commandInspect(target || rest[0]);

  const { cwd, manifest, rawManifest, manifestPath } = await resolveContext(target);
  process.chdir(cwd);

  if (cmd === 'env') return commandEnv(manifest, cwd, rest.includes('--json'));
  if (cmd === 'paths') return commandPaths(manifest, cwd, rest.includes('--json'));
  if (cmd === 'bootstrap') return commandBootstrap(manifest, cwd, rest.includes('--json'));
  if (cmd === 'capabilities') return commandCapabilities(manifest, cwd);
  if (cmd === 'capability') return commandCapability(manifest, cwd, rest[0]);
  if (cmd === 'impact' || cmd === 'capability-impact') return commandImpact(rest[0]);
  if (cmd === 'drift') return commandDrift(manifest, cwd, rest.includes('--json'));
  if (cmd === 'reconcile') return commandReconcile(manifest, cwd, rest.includes('--json'));
  if (cmd === 'repair') return commandRepair(manifest, cwd, rest.includes('--json'));
  if (cmd === 'upgrade') return commandUpgrade(rawManifest, manifest, manifestPath, cwd, rest.includes('--write'));
  if (cmd === 'explain') return commandExplain(rest[0], manifest, cwd);

  if (cmd === 'check') {
    const result = await frameworkCheck(manifest, { cwd });
    compact([`STATUS: ${passLine(result.ok)}`, `ENV: ${detectEnvironment(manifest, cwd).name}`, `CHECKS: ${result.checks.filter((check) => check.ok).length}/${result.checks.length}`, `NEXT: ${result.ok ? 'taskrail test' : 'taskrail explain check'}`]);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (cmd === 'gate') {
    const result = await runGate(manifest, cwd, await loadPlugins(manifest).catch(() => []));
    if (rest.includes('--json')) return output(result);
    compact([`STATUS: ${result.verdict}`, `ENV: ${detectEnvironment(manifest, cwd).name}`, `DEPLOYABLE: ${result.deployAllowed ? 'yes' : 'no'}`, `NEXT: ${result.deployAllowed ? 'taskrail ship' : 'taskrail explain gate'}`]);
    if (result.verdict !== 'PASS') process.exitCode = 1;
    return;
  }

  if (cmd === 'verify-change') {
    const result = await inspectChange(manifest, cwd, await loadPlugins(manifest).catch(() => []));
    if (rest.includes('--json')) return output(result);
    compact([`STATUS: ${passLine(result.deployAllowed)}`, `ENV: ${detectEnvironment(manifest, cwd).name}`, `RISK: ${result.risk}`, `CHANGED: ${result.changedFiles.length}`, `NEXT: ${result.deployAllowed ? 'taskrail ship' : 'inspect protected changes'}`]);
    if (!result.deployAllowed) process.exitCode = 1;
    return;
  }

  if (cmd === 'plan') {
    const plan = buildPlan(manifest, await loadPlugins(manifest).catch(() => []));
    if (rest.includes('--json')) return output({ version: TASKRAIL_VERSION, plan });
    compact([`STATUS: PASS`, `ENV: ${plan.environment}`, `TARGET: ${plan.target}`, `STRATEGY: ${plan.deployStrategy}`, `NEXT: taskrail ship`]);
    return;
  }

  if (cmd === 'doctor') {
    const result = await frameworkDoctor(manifest, { cwd });
    if (rest.includes('--json')) return output(result);
    compact([`STATUS: ${passLine(result.deployable && result.compatible && result.manifestValid)}`, `ENV: ${result.environment.name}`, `SHA: ${result.git.sha || 'unknown'}`, `DRIFT: ${result.drift?.drifted ? result.drift.files.join(', ') : 'none'}`, `DEPLOYABLE: ${result.deployable ? 'yes' : 'no'}`, `NEXT: ${result.deployable ? 'taskrail ship' : 'taskrail explain doctor'}`]);
    if (!result.compatible || !result.manifestValid || !result.deployable) process.exitCode = 1;
    return;
  }

  if (cmd === 'deploy') {
    const errors = validateConfig({ projectName: manifest.name, environment: process.env, manifest });
    if (errors.length) {
      compact([`STATUS: FAIL`, `ENV: ${detectEnvironment(manifest, cwd).name}`, `NEXT: taskrail explain deploy`]);
      process.exitCode = 1;
      return;
    }
    const result = await safeDeploy(manifest, plugin, { sourceRevision: inspectGitState(cwd).sha, projectRoot: cwd });
    if (rest.includes('--json')) return output(result);
    compact([`STATUS: ${passLine(result.deployed)}`, `ENV: ${detectEnvironment(manifest, cwd).name}`, `SHA: ${result.sha || 'unknown'}`, `RELEASE: ${result.releaseId || 'unknown'}`, `NEXT: ${result.deployed ? 'taskrail health' : 'taskrail explain deploy'}`]);
    if (!result.deployed) process.exitCode = 1;
    return;
  }

  if (cmd === 'health') {
    const result = await runHealthCheck(manifest.healthCheck ?? manifest.healthChecks?.[0], resolvePaths(manifest, cwd).deployDir, plugin, manifest.healthCommand || manifest.runtimeHealthCommand);
    compact([`STATUS: ${passLine(result.ok)}`, `ENV: ${detectEnvironment(manifest, cwd).name}`, `HEALTH: ${result.details || 'ok'}`, `NEXT: ${result.ok ? 'done' : 'taskrail explain health'}`]);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (cmd === 'rollback') {
    const result = await rollbackFromManifest(manifest, plugin);
    compact([`STATUS: ${passLine(result.ok)}`, `ENV: ${detectEnvironment(manifest, cwd).name}`, `NEXT: ${result.ok ? 'taskrail health' : 'taskrail explain rollback'}`]);
    if (!result.ok) process.exitCode = 1;
    return;
  }


  console.error(`unknown command: ${cmd}`);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

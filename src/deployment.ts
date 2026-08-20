import { copyFile, mkdir, readFile, rename, rm, stat, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TASKRAIL_VERSION } from './version.js';
import type {
  AutomationPlugin,
  DeployResult,
  FrameworkManifest,
  HealthCheckDefinition,
  FailureReport,
} from './types.js';
import { acquireLock, releaseLock } from './locks.js';
import { appendAudit } from './history.js';
import { preflight } from './preflight.js';
import { createRelease } from './release.js';
import { buildFailureReport } from './errors.js';
import { detectDrift } from './drift.js';
import { isCompatible } from './config.js';
import { writeEvidence } from './evidence.js';
import { runGate } from './gate.js';

export interface DeployOutcome extends DeployResult {
  backupPath?: string;
  failure?: string;
  releaseId?: string;
  report?: string;
}

export interface DeployOptions {
  releasesDir?: string;
  historyFile?: string;
  lockDir?: string;
  sourceRevision?: string;
  projectRoot?: string;
}

export interface DoctorResult {
  version: string;
  compatible: boolean;
  manifestValid: boolean;
  project: string;
  runtimeVersion: string;
  requiredSharedFiles: Array<{ file: string; ok: boolean; detail?: string }>;
  envPresence: Array<{ name: string; ok: boolean }>;
  lockState: { locked: boolean; holder?: string };
  deployTarget: string;
  plugins: string[];
  latestHealthyRelease?: string;
  drift?: { drifted: boolean; files: string[] };
  healthReady: boolean;
  lastDeploymentResult?: string;
}

export interface CheckResult {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; message?: string }>;
}

async function pathExists(target: string) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(source: string, target: string, exclude: string[] = []) {
  const excluded = exclude.map((item) => path.resolve(item));
  async function walk(current: string, dest: string) {
    const resolved = path.resolve(current);
    if (excluded.some((item) => resolved === item || resolved.startsWith(`${item}${path.sep}`))) return;
    const entryStat = await stat(current);
    if (entryStat.isDirectory()) {
      await mkdir(dest, { recursive: true });
      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries) await walk(path.join(current, entry.name), path.join(dest, entry.name));
      return;
    }
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(current, dest);
  }
  await walk(source, target);
}

function parseCommand(command: string) {
  const parts: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of command.matchAll(re)) parts.push(match[1] ?? match[2] ?? match[3]);
  return parts;
}

async function runCommand(command: string, cwd: string) {
  const { spawn } = await import('node:child_process');
  const [rawBin, ...args] = parseCommand(command);
  return await new Promise<{ ok: boolean; code: number; error?: string }>((resolve) => {
    const child = spawn(rawBin === 'node' ? process.execPath : rawBin, args, { cwd, stdio: 'ignore' });
    child.on('error', (error: NodeJS.ErrnoException) => resolve({ ok: false, code: 1, error: error.code === 'ENOENT' ? `missing executable: ${rawBin}` : error.message }));
    child.on('exit', (code) => resolve({ ok: code === 0, code: code ?? 1 }));
  });
}

export async function loadPlugin(modulePath: string): Promise<AutomationPlugin> {
  const mod = await import(pathToFileURL(path.resolve(modulePath)).href);
  return mod.default ?? mod.plugin ?? mod;
}

export async function loadPlugins(manifest: FrameworkManifest): Promise<AutomationPlugin[]> {
  const refs = manifest.plugins ?? [];
  const plugins: AutomationPlugin[] = [];
  for (const ref of refs) plugins.push(await loadPlugin(ref.module));
  return plugins;
}

export async function runHealthCheck(health: HealthCheckDefinition | undefined, cwd: string, plugin?: AutomationPlugin) {
  if (!health) return { ok: true, tier: 'process' as const };
  if (health.type === 'command') {
    const result = await runCommand(health.command, cwd);
    return { ok: result.ok, tier: 'process' as const, details: result.error ?? `exit ${result.code}` };
  }
  if (health.type === 'file') {
    return { ok: await pathExists(path.resolve(cwd, health.path)), tier: 'process' as const, details: health.path };
  }
  if (health.type === 'http') {
    const response = await fetch(health.url);
    return { ok: response.status === (health.expectStatus ?? 200), tier: 'integration' as const, details: `status ${response.status}` };
  }
  if (plugin?.healthCheck) {
    const result = await plugin.healthCheck();
    return { ok: result.ok, tier: 'integration' as const, details: result.details };
  }
  return { ok: true, tier: 'process' as const };
}

async function readState(stateFile: string): Promise<{ backupPath: string; targetPath: string; releasePath?: string } | null> {
  try {
    return JSON.parse(await readFile(stateFile, 'utf8'));
  } catch {
    return null;
  }
}

async function writeState(stateFile: string, state: { backupPath: string; targetPath: string; releasePath?: string }) {
  await writeFile(stateFile, JSON.stringify(state, null, 2));
}

async function pruneBackups(workspace: string, name: string, retain = 0) {
  if (!retain) return;
  const entries = await readdir(workspace, { withFileTypes: true }).catch(() => []);
  const backups = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${name}.backup-`))
    .map((entry) => path.join(workspace, entry.name));
  if (backups.length <= retain) return;
  const stats = [] as Array<{ backup: string; mtime: number }>;
  for (const backup of backups) {
    try {
      stats.push({ backup, mtime: (await stat(backup)).mtimeMs });
    } catch {
      continue;
    }
  }
  stats.sort((a, b) => b.mtime - a.mtime);
  for (const old of stats.slice(retain)) await rm(old.backup, { recursive: true, force: true });
}

export async function check(manifest: FrameworkManifest): Promise<CheckResult> {
  const preflightResult = await preflight(manifest);
  return { ok: preflightResult.ok, checks: preflightResult.checks };
}

export async function doctor(manifest: FrameworkManifest): Promise<DoctorResult> {
  const preflightResult = await preflight(manifest);
  const lockDir = path.join(path.dirname(path.resolve(manifest.deployDir)), '.taskrail', 'lock');
  const lock = await acquireLock(lockDir);
  if (lock.ok) await releaseLock(lockDir);
  const stateFile = path.join(path.dirname(path.resolve(manifest.deployDir)), `${manifest.name}.deploy-state.json`);
  const state = await readState(stateFile);
  const latestHealthyRelease = state?.releasePath;
  const pluginNames = await loadPlugins(manifest).then((plugins) => plugins.map((p) => p.name)).catch(() => []);
  const drift = state?.releasePath && (await pathExists(path.resolve(manifest.deployDir)))
    ? await detectDrift(path.resolve(manifest.deployDir), state.releasePath)
    : undefined;
  return {
    version: TASKRAIL_VERSION,
    compatible: isCompatible(TASKRAIL_VERSION, manifest.taskrailCompatibility),
    manifestValid: preflightResult.ok,
    project: manifest.name,
    runtimeVersion: process.version,
    requiredSharedFiles: await Promise.all((manifest.requiredSharedFiles ?? []).map(async (file) => ({ file, ok: await pathExists(file), detail: file }))),
    envPresence: (manifest.requiredEnv ?? []).map((name) => ({ name, ok: Boolean(process.env[name]) })),
    lockState: lock.ok ? { locked: false } : { locked: true, holder: lock.holder },
    deployTarget: manifest.deployDir,
    plugins: pluginNames,
    latestHealthyRelease,
    drift,
    healthReady: Boolean(manifest.healthCheck || manifest.healthChecks?.length),
    lastDeploymentResult: state ? 'deployed' : 'unknown',
  };
}

export async function safeDeploy(manifest: FrameworkManifest, plugin?: AutomationPlugin, options: DeployOptions = {}): Promise<DeployOutcome> {
  const projectRoot = options.projectRoot || process.cwd();
  const target = path.resolve(projectRoot, manifest.deployDir);
  const source = path.resolve(projectRoot, manifest.sourceDir);
  const workspace = path.dirname(target);
  const candidate = path.join(workspace, `${manifest.name}.candidate`);
  const backup = path.join(workspace, `${manifest.name}.backup-${Date.now()}`);
  const stateFile = path.join(workspace, `${manifest.name}.deploy-state.json`);
  const releaseDir = options.releasesDir || path.join(workspace, '.taskrail', 'releases');
  const historyFile = options.historyFile || path.join(workspace, '.taskrail', 'history.jsonl');
  const lockDir = options.lockDir || path.join(workspace, '.taskrail', 'lock');

  const resolvedManifest = { ...manifest, sourceDir: source, deployDir: target };
  const preflightResult = await preflight(resolvedManifest);
  if (!preflightResult.ok) {
    return {
      deployed: false,
      rolledBack: false,
      failure: 'preflight failed',
      report: buildFailureReport({
        project: manifest.name,
        taskrailVersion: TASKRAIL_VERSION,
        stage: 'preflight',
        category: 'preflight_failed',
        message: 'preflight checks failed',
        rollbackAttempted: false,
        rollbackResult: 'not-needed',
        nextStep: 'fix the reported preflight checks',
      } satisfies FailureReport),
    };
  }

  const lock = await acquireLock(lockDir);
  if (!lock.ok) {
    return {
      deployed: false,
      rolledBack: false,
      failure: `deployment locked by ${lock.holder || 'unknown'}`,
      report: buildFailureReport({
        project: manifest.name,
        taskrailVersion: TASKRAIL_VERSION,
        stage: 'lock',
        category: 'locked',
        message: lock.holder || 'unknown',
        rollbackAttempted: false,
        rollbackResult: 'not-needed',
        nextStep: 'wait for the lock holder to finish',
      } satisfies FailureReport),
    };
  }

  try {
    await appendAudit(historyFile, { ts: new Date().toISOString(), type: 'deploy_attempted', project: manifest.name, taskrailVersion: TASKRAIL_VERSION });
    await rm(candidate, { recursive: true, force: true });
    const sourceExcludes = Array.from(new Set([
      candidate,
      backup,
      stateFile,
      releaseDir,
      historyFile,
      lockDir,
    ]));
    await copyDir(source, candidate, sourceExcludes);

    const validation = await runCommand(manifest.validationCommand, candidate);
    if (!validation.ok) return { deployed: false, rolledBack: false, failure: validation.error || 'candidate validation failed' };

    const tests = await runCommand(manifest.testCommand, candidate);
    if (!tests.ok) return { deployed: false, rolledBack: false, failure: tests.error || 'candidate tests failed' };

    if (manifest.buildCommand) {
      const build = await runCommand(manifest.buildCommand, candidate);
      if (!build.ok) return { deployed: false, rolledBack: false, failure: build.error || 'candidate build failed' };
    }

    const controlsEnabled = Boolean(manifest.requiredChecks?.length || manifest.protectedPaths?.length);
    if (controlsEnabled) {
      const liveGate = await runGate(manifest, projectRoot, plugin ? [plugin] : []);
      if (liveGate.verdict !== 'PASS') {
        return { deployed: false, rolledBack: false, failure: `verification blocked: ${liveGate.verdict}` };
      }
      const changed = await inspectDeployChange(manifest, projectRoot);
      if (!changed.allowed) {
        return { deployed: false, rolledBack: false, failure: `protected change blocked: ${changed.protected.join(', ') || 'unknown'}` };
      }
    }

    if (await pathExists(target)) {
      const state = await readState(stateFile);
      if (state?.releasePath) {
        const drift = await detectDrift(target, state.releasePath);
        if (drift.drifted) return { deployed: false, rolledBack: false, failure: `drift detected: ${drift.files.join(', ')}` };
      }
      await rename(target, backup);
    }

    await rename(candidate, target);
    const release = await createRelease(manifest, target, releaseDir, options.sourceRevision);
    await writeState(stateFile, { backupPath: backup, targetPath: target, releasePath: release.path });
    await pruneBackups(workspace, manifest.name, manifest.backup?.retain ?? 0);

    const health = await runHealthCheck(manifest.healthCheck ?? manifest.healthChecks?.[0], target, plugin);
    if (health.ok) {
      await appendAudit(historyFile, { ts: new Date().toISOString(), type: 'deploy_succeeded', project: manifest.name, taskrailVersion: TASKRAIL_VERSION, releaseId: release.releaseId });
      await writeEvidence(workspace, { kind: 'deploy', project: manifest.name, verdict: 'PASS', deployAllowed: true });
      return { deployed: true, rolledBack: false, backupPath: backup, releaseId: release.releaseId };
    }

    await rm(target, { recursive: true, force: true });
    if (await pathExists(backup)) await rename(backup, target);
    const restored = await runHealthCheck(manifest.healthCheck ?? manifest.healthChecks?.[0], target, plugin);
    if (!restored.ok) {
      await appendAudit(historyFile, { ts: new Date().toISOString(), type: 'rollback_failed', project: manifest.name, taskrailVersion: TASKRAIL_VERSION, releaseId: release.releaseId });
      await writeEvidence(workspace, { kind: 'deploy', project: manifest.name, verdict: 'FAIL', deployAllowed: false });
      return { deployed: false, rolledBack: true, backupPath: backup, failure: 'health check failed and rollback failed', releaseId: release.releaseId, report: buildFailureReport({ project: manifest.name, taskrailVersion: TASKRAIL_VERSION, stage: 'health', category: 'health_failed', message: 'rollback failed', releaseId: release.releaseId, rollbackAttempted: true, rollbackResult: 'failed', nextStep: 'inspect release history and restore manually' } satisfies FailureReport) };
    }

    await appendAudit(historyFile, { ts: new Date().toISOString(), type: 'rollback_succeeded', project: manifest.name, taskrailVersion: TASKRAIL_VERSION, releaseId: release.releaseId });
    await writeEvidence(workspace, { kind: 'deploy', project: manifest.name, verdict: 'FAIL', deployAllowed: false });
    return { deployed: false, rolledBack: true, backupPath: backup, failure: 'health check failed; rollback succeeded', releaseId: release.releaseId, report: buildFailureReport({ project: manifest.name, taskrailVersion: TASKRAIL_VERSION, stage: 'health', category: 'health_failed', message: 'rollback succeeded', releaseId: release.releaseId, rollbackAttempted: true, rollbackResult: 'success', nextStep: 'fix candidate and redeploy' } satisfies FailureReport) };
  } finally {
    await releaseLock(lockDir);
  }
}

async function inspectDeployChange(manifest: FrameworkManifest, cwd: string) {
  const { spawnSync } = await import('node:child_process');
  const git = (args: string[]) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return result.status === 0 && typeof result.stdout === 'string' ? result.stdout.trim() : '';
  };
  const status = git(['status', '--porcelain']);
  const tracked = status ? status.split('\n').map((line) => line.replace(/^[ MADRCU?!]{1,2}\s+/, '').trim()).filter(Boolean) : [];
  const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean);
  const changedFiles = Array.from(new Set([...tracked, ...untracked].map((file) => file.replace(/^\"|\"$/g, '')))).filter((file) => !file.startsWith('.taskrail/'));
  const protectedPaths = (manifest.protectedPaths ?? []).filter((prefix) => changedFiles.some((file) => {
    const abs = path.isAbsolute(file) ? path.normalize(file) : path.normalize(path.resolve(cwd, file));
    const normalizedPrefix = path.normalize(prefix);
    return abs === normalizedPrefix || abs.startsWith(`${normalizedPrefix}${path.sep}`) || path.normalize(file) === normalizedPrefix || path.normalize(file).startsWith(`${normalizedPrefix}${path.sep}`);
  }));
  return { allowed: protectedPaths.length === 0, protected: protectedPaths };
}

export async function rollbackFromState(stateFile: string, health: HealthCheckDefinition | undefined, plugin?: AutomationPlugin) {
  const state = await readState(stateFile);
  if (!state) return { ok: false, failure: 'missing rollback state' };
  try {
    await rm(state.targetPath, { recursive: true, force: true });
    await rename(state.backupPath, state.targetPath);
    const restored = await runHealthCheck(health, state.targetPath, plugin);
    if (!restored.ok) return { ok: false, failure: 'restored version failed health check' };
    return { ok: true, failure: undefined };
  } catch {
    return { ok: false, failure: 'rollback failed' };
  }
}

export async function rollbackFromManifest(manifest: FrameworkManifest, plugin?: AutomationPlugin) {
  const stateFile = path.join(path.dirname(path.resolve(manifest.deployDir)), `${manifest.name}.deploy-state.json`);
  return rollbackFromState(stateFile, manifest.healthCheck ?? manifest.healthChecks?.[0], plugin);
}

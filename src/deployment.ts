import { copyFile, mkdir, readFile, readdir, readlink, rename, rm, stat, symlink, unlink, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TASKRAIL_VERSION } from './version.js';
import type {
  AutomationPlugin,
  DeployResult,
  DeployState,
  EnvironmentInfo,
  FailureReport,
  FrameworkManifest,
  GitState,
  HealthCheckDefinition,
} from './types.js';
import { acquireLock, releaseLock } from './locks.js';
import { appendAudit } from './history.js';
import { preflight } from './preflight.js';
import { createRelease } from './release.js';
import { buildFailureReport } from './errors.js';
import { detectDrift } from './drift.js';
import { isCompatible, resolvePaths } from './config.js';
import { writeEvidence } from './evidence.js';
import { runGate } from './gate.js';
import { inspectGitState } from './git.js';
import { detectEnvironment } from './env.js';
import { inspectChange } from './change.js';
import { capabilityRootsFor } from './capabilities.js';

export interface DeployOutcome extends DeployResult {
  backupPath?: string;
  failure?: string;
  releaseId?: string;
  releasePath?: string;
  report?: string;
  sha?: string;
}

export interface DeployOptions {
  releasesDir?: string;
  historyFile?: string;
  lockDir?: string;
  sourceRevision?: string;
  projectRoot?: string;
}

export interface ManifestRunOptions {
  cwd?: string;
}

export interface DoctorResult {
  version: string;
  compatible: boolean;
  manifestValid: boolean;
  project: string;
  environment: EnvironmentInfo;
  runtimeVersion: string;
  requiredSharedFiles: Array<{ file: string; ok: boolean; detail?: string }>;
  envPresence: Array<{ name: string; ok: boolean }>;
  lockState: { locked: boolean; holder?: string };
  deployTarget: string;
  plugins: string[];
  latestHealthyRelease?: string;
  drift?: { drifted: boolean; files: string[]; items: Array<{ path: string; kind: string; reason: string }> };
  healthReady: boolean;
  lastDeploymentResult?: string;
  git: GitState;
  deployable: boolean;
}

export interface CheckResult {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; message?: string }>;
}

function parseCommand(command: string) {
  const parts: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of command.matchAll(re)) parts.push(match[1] ?? match[2] ?? match[3]);
  return parts;
}

async function pathExists(target: string) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function isSymlink(target: string) {
  try {
    return (await lstat(target)).isSymbolicLink();
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

async function stageCapabilities(manifest: FrameworkManifest, projectRoot: string, candidate: string) {
  if (!(manifest.capabilities ?? []).length) return;
  const roots = capabilityRootsFor(manifest, projectRoot);
  const dest = path.join(candidate, 'capabilities');
  for (const root of roots) {
    if (!(await pathExists(root))) continue;
    await copyDir(root, dest);
    return;
  }
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

function runtimeInstallCommand(manifest: FrameworkManifest) {
  if (manifest.buildCommand) return manifest.buildCommand;
  if (manifest.dependencyManager?.installCommand) return manifest.dependencyManager.installCommand;
  if (manifest.dependencyManager?.tool === 'npm') return 'npm ci --omit=dev';
  return undefined;
}

async function readState(stateFile: string): Promise<DeployState | null> {
  try {
    return JSON.parse(await readFile(stateFile, 'utf8')) as DeployState;
  } catch {
    return null;
  }
}

async function writeState(stateFile: string, state: DeployState) {
  await writeFile(stateFile, JSON.stringify(state, null, 2));
}

async function writeReceipt(workspace: string, receipt: Record<string, unknown>) {
  const dir = path.join(workspace, '.taskrail', 'receipts');
  await mkdir(dir, { recursive: true });
  const latest = path.join(dir, 'latest.json');
  const dated = path.join(dir, `${String(receipt.releaseId || 'unknown')}.json`);
  const body = JSON.stringify(receipt, null, 2);
  await writeFile(latest, body);
  await writeFile(dated, body);
  return latest;
}

async function pruneBackups(workspace: string, name: string, retain = 0) {
  if (!retain) return;
  const entries = await readdir(workspace, { withFileTypes: true }).catch(() => []);
  const backups = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith(`${name}.backup-`)).map((entry) => path.join(workspace, entry.name));
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

async function currentLivePath(target: string) {
  if (await isSymlink(target)) {
    const pointer = await readlink(target);
    return path.resolve(path.dirname(target), pointer);
  }
  return target;
}

async function activateRelease(target: string, releasePath: string, backupPath: string) {
  const targetExists = await pathExists(target);
  let previousReleasePath: string | undefined;
  if (targetExists) {
    previousReleasePath = await currentLivePath(target);
    if (await isSymlink(target)) await unlink(target);
    else await rename(target, backupPath);
  }
  await symlink(releasePath, target, 'dir');
  return { previousReleasePath };
}

async function restoreActivation(target: string, backupPath: string, previousReleasePath?: string) {
  if (await isSymlink(target)) await unlink(target).catch(() => undefined);
  else await rm(target, { recursive: true, force: true });
  if (previousReleasePath && await pathExists(previousReleasePath)) {
    await symlink(previousReleasePath, target, 'dir');
    return;
  }
  if (await pathExists(backupPath)) await rename(backupPath, target);
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

export async function runHealthCheck(health: HealthCheckDefinition | undefined, cwd: string, plugin?: AutomationPlugin, runtimeHealthCommand?: string) {
  const checks: Array<Promise<{ ok: boolean; tier: 'process' | 'integration' | 'end-to-end'; details?: string }>> = [];
  if (health) {
    checks.push((async () => {
      if (health.type === 'command') {
        const result = await runCommand(health.command, cwd);
        return { ok: result.ok, tier: 'process' as const, details: result.error ?? `exit ${result.code}` };
      }
      if (health.type === 'file') return { ok: await pathExists(path.resolve(cwd, health.path)), tier: 'process' as const, details: health.path };
      if (health.type === 'http') {
        const response = await fetch(health.url);
        return { ok: response.status === (health.expectStatus ?? 200), tier: 'integration' as const, details: `status ${response.status}` };
      }
      return { ok: true, tier: 'process' as const };
    })());
  }
  if (runtimeHealthCommand) {
    checks.push((async () => {
      const result = await runCommand(runtimeHealthCommand, cwd);
      return { ok: result.ok, tier: 'process' as const, details: result.error ?? `exit ${result.code}` };
    })());
  }
  if (plugin?.healthCheck) {
    checks.push((async () => {
      const result = await plugin.healthCheck!();
      return { ok: result.ok, tier: 'integration' as const, details: result.details };
    })());
  }
  if (!checks.length) return { ok: true, tier: 'process' as const };
  const results = await Promise.all(checks);
  return results.find((result) => !result.ok) ?? results[0];
}

async function migrationPreflight(manifest: FrameworkManifest, cwd: string) {
  if (!manifest.migrations?.checkCommand) return { ok: true, code: 0 };
  return runCommand(manifest.migrations.checkCommand, cwd);
}

async function migrationApply(manifest: FrameworkManifest, cwd: string) {
  if (!manifest.migrations?.applyCommand) return { ok: true, code: 0 };
  return runCommand(manifest.migrations.applyCommand, cwd);
}

function failure(report: FailureReport) {
  return buildFailureReport(report);
}

export async function check(manifest: FrameworkManifest, options: ManifestRunOptions = {}): Promise<CheckResult> {
  const preflightResult = await preflight(manifest, options.cwd || process.cwd());
  return { ok: preflightResult.ok, checks: preflightResult.checks };
}

export async function doctor(manifest: FrameworkManifest, options: ManifestRunOptions = {}): Promise<DoctorResult> {
  const cwd = options.cwd || process.cwd();
  const envInfo = detectEnvironment(manifest, cwd);
  const preflightResult = await preflight(manifest, cwd);
  const deployTarget = path.resolve(cwd, manifest.deployDir);
  const lockDir = path.join(path.dirname(deployTarget), '.taskrail', 'lock');
  const lock = await acquireLock(lockDir, { operation: 'doctor' });
  if (lock.ok) await releaseLock(lockDir);
  const stateFile = path.join(path.dirname(deployTarget), `${manifest.name}.deploy-state.json`);
  const state = await readState(stateFile);
  const latestHealthyRelease = state?.releasePath;
  const livePath = await currentLivePath(deployTarget).catch(() => deployTarget);
  const pluginNames = await loadPlugins(manifest).then((plugins) => plugins.map((p) => p.name)).catch(() => []);
  const drift = state?.releasePath && (await pathExists(livePath)) ? await detectDrift(livePath, state.releasePath, manifest) : undefined;
  const git = inspectGitState(cwd);
  const deployable = preflightResult.ok && isCompatible(TASKRAIL_VERSION, manifest.taskrailCompatibility) && (!drift || !drift.drifted);
  return {
    version: TASKRAIL_VERSION,
    compatible: isCompatible(TASKRAIL_VERSION, manifest.taskrailCompatibility),
    manifestValid: preflightResult.ok,
    project: manifest.name,
    environment: envInfo,
    runtimeVersion: process.version,
    requiredSharedFiles: await Promise.all((manifest.requiredSharedFiles ?? []).map(async (file) => {
      const value = typeof file === 'string' ? file : file.path;
      return { file: value, ok: await pathExists(value), detail: value };
    })),
    envPresence: (manifest.requiredEnv ?? []).map((name) => ({ name, ok: Boolean(process.env[name]) })),
    lockState: lock.ok ? { locked: false } : { locked: true, holder: lock.holder },
    deployTarget,
    plugins: pluginNames,
    latestHealthyRelease,
    drift,
    healthReady: Boolean(manifest.healthCheck || manifest.healthChecks?.length || manifest.healthCommand),
    lastDeploymentResult: state ? 'deployed' : 'unknown',
    git,
    deployable,
  };
}

export async function safeDeploy(manifest: FrameworkManifest, plugin?: AutomationPlugin, options: DeployOptions = {}): Promise<DeployOutcome> {
  const projectRoot = options.projectRoot || process.cwd();
  const envInfo = detectEnvironment(manifest, projectRoot);
  const paths = resolvePaths(manifest, projectRoot);
  const source = paths.sourceDir;
  const target = paths.deployDir;
  const workspace = path.dirname(target);
  const stateFile = path.join(workspace, `${manifest.name}.deploy-state.json`);
  const lockDir = options.lockDir || path.join(workspace, '.taskrail', 'lock');
  const historyFile = options.historyFile || path.join(workspace, '.taskrail', 'history.jsonl');
  const releaseRoot = manifest.deployStrategy?.releaseRoot ? path.resolve(projectRoot, manifest.deployStrategy.releaseRoot) : (options.releasesDir || path.join(workspace, '.taskrail', 'releases'));
  const candidate = path.join(workspace, `${manifest.name}.candidate`);
  const backup = path.join(workspace, `${manifest.name}.backup-${Date.now()}`);
  const strategy = manifest.deployStrategy?.type || 'replace-in-place';
  const git = inspectGitState(projectRoot);

  if (envInfo.name === 'production') {
    if (!git.available || !git.sha) return { deployed: false, rolledBack: false, failure: 'production deploy requires git sha' };
    if (!git.clean) return { deployed: false, rolledBack: false, failure: 'production deploy requires clean git tree' };
  }

  const buildCommand = runtimeInstallCommand(manifest);
  const resolvedManifest = { ...manifest, sourceDir: source, deployDir: target, buildCommand };
  const preflightResult = await preflight(resolvedManifest);
  if (!preflightResult.ok) {
    return {
      deployed: false,
      rolledBack: false,
      failure: 'preflight failed',
      report: failure({ project: manifest.name, taskrailVersion: TASKRAIL_VERSION, stage: 'preflight', category: 'preflight_failed', message: 'preflight checks failed', rollbackAttempted: false, rollbackResult: 'not-needed', nextStep: 'fix the reported preflight checks', environment: envInfo.name }),
    };
  }

  const lock = await acquireLock(lockDir, { operation: 'deploy', releaseId: git.sha || options.sourceRevision, cwd: projectRoot });
  if (!lock.ok) {
    return {
      deployed: false,
      rolledBack: false,
      failure: `deployment locked by ${lock.holder || 'unknown'}`,
      report: failure({ project: manifest.name, taskrailVersion: TASKRAIL_VERSION, stage: 'lock', category: 'locked', message: lock.holder || 'unknown', rollbackAttempted: false, rollbackResult: 'not-needed', nextStep: 'wait for the lock holder to finish', environment: envInfo.name }),
    };
  }

  try {
    await appendAudit(historyFile, { ts: new Date().toISOString(), type: 'deploy_attempted', project: manifest.name, taskrailVersion: TASKRAIL_VERSION, sha: git.sha });
    await rm(candidate, { recursive: true, force: true });
    const sourceExcludes = Array.from(new Set([candidate, backup, stateFile, releaseRoot, historyFile, lockDir]));
    await copyDir(source, candidate, sourceExcludes);
    await stageCapabilities(manifest, projectRoot, candidate);

    const validation = await runCommand(manifest.validationCommand, candidate);
    if (!validation.ok) return { deployed: false, rolledBack: false, failure: validation.error || 'candidate validation failed' };
    const tests = await runCommand(manifest.testCommand, candidate);
    if (!tests.ok) return { deployed: false, rolledBack: false, failure: tests.error || 'candidate tests failed' };
    if (buildCommand) {
      const build = await runCommand(buildCommand, candidate);
      if (!build.ok) return { deployed: false, rolledBack: false, failure: build.error || 'candidate build failed' };
    }
    const migrateCheck = await migrationPreflight(manifest, candidate);
    if (!migrateCheck.ok) return { deployed: false, rolledBack: false, failure: migrateCheck.error || 'migration preflight failed' };

    const controlsEnabled = Boolean(manifest.requiredChecks?.length || manifest.protectedPaths?.length);
    if (controlsEnabled) {
      const liveGate = await runGate({ ...manifest, buildCommand }, projectRoot, plugin ? [plugin] : []);
      if (liveGate.verdict !== 'PASS') return { deployed: false, rolledBack: false, failure: `verification blocked: ${liveGate.verdict}` };
      const change = await inspectChange(manifest, projectRoot);
      if (!change.deployAllowed) return { deployed: false, rolledBack: false, failure: `protected change blocked: ${change.protectedPaths.join(', ') || 'unknown'}` };
    }

    const state = await readState(stateFile);
    const livePath = await currentLivePath(target).catch(() => target);
    if (state?.releasePath && await pathExists(livePath)) {
      const drift = await detectDrift(livePath, state.releasePath, manifest);
      if (drift.drifted) return { deployed: false, rolledBack: false, failure: `drift detected: ${drift.files.join(', ')}` };
    }

    const release = await createRelease({ ...manifest, buildCommand }, candidate, releaseRoot, options.sourceRevision || git.sha);
    await rm(candidate, { recursive: true, force: true });
    const migration = await migrationApply(manifest, release.path);
    if (!migration.ok) return { deployed: false, rolledBack: false, failure: migration.error || 'migration failed' };

    let previousReleasePath: string | undefined;
    if (strategy === 'release-symlink') {
      const activated = await activateRelease(target, release.path, backup);
      previousReleasePath = activated.previousReleasePath;
    } else {
      if (await pathExists(target)) await rename(target, backup);
      await copyDir(release.path, target);
    }

    const liveCheckPath = strategy === 'release-symlink' ? release.path : target;
    const nextState: DeployState = {
      backupPath: backup,
      targetPath: target,
      releasePath: release.path,
      previousReleasePath,
      currentReleaseId: release.releaseId,
      currentSha: git.sha,
    };
    await writeState(stateFile, nextState);
    await pruneBackups(workspace, manifest.name, manifest.backup?.retain ?? 0);

    const health = await runHealthCheck(manifest.healthCheck ?? manifest.healthChecks?.[0], liveCheckPath, plugin, manifest.healthCommand || manifest.runtimeHealthCommand);
    if (health.ok) {
      nextState.lastKnownGoodReleasePath = release.path;
      nextState.lastKnownGoodReleaseId = release.releaseId;
      nextState.lastKnownGoodSha = git.sha;
      await writeState(stateFile, nextState);
      const receiptPath = await writeReceipt(workspace, {
        automation: manifest.name,
        environment: envInfo.name,
        sha: git.sha,
        taskrailVersion: TASKRAIL_VERSION,
        releaseId: release.releaseId,
        migration: 'PASS',
        health: 'PASS',
        deployedAt: new Date().toISOString(),
      });
      await appendAudit(historyFile, { ts: new Date().toISOString(), type: 'deploy_succeeded', project: manifest.name, taskrailVersion: TASKRAIL_VERSION, releaseId: release.releaseId, sha: git.sha });
      await writeEvidence(workspace, { kind: 'deploy', project: manifest.name, verdict: 'PASS', deployAllowed: true, releaseId: release.releaseId, sha: git.sha, environment: envInfo.name });
      await writeFile(path.join(release.path, 'release.json'), JSON.stringify({ ...release, environment: envInfo.name, receiptPath }, null, 2));
      return { deployed: true, rolledBack: false, backupPath: backup, releaseId: release.releaseId, releasePath: release.path, sha: git.sha };
    }

    if (strategy === 'release-symlink') await restoreActivation(target, backup, previousReleasePath);
    else {
      await rm(target, { recursive: true, force: true });
      if (await pathExists(backup)) await rename(backup, target);
    }

    const restoredPath = strategy === 'release-symlink' ? (previousReleasePath || target) : target;
    const restored = await runHealthCheck(manifest.healthCheck ?? manifest.healthChecks?.[0], restoredPath, plugin, manifest.healthCommand || manifest.runtimeHealthCommand);
    if (!restored.ok) {
      await writeReceipt(workspace, {
        automation: manifest.name,
        environment: envInfo.name,
        sha: git.sha,
        taskrailVersion: TASKRAIL_VERSION,
        releaseId: release.releaseId,
        migration: 'PASS',
        health: 'FAIL',
        rollback: 'FAIL',
        deployedAt: new Date().toISOString(),
      });
      return { deployed: false, rolledBack: true, backupPath: backup, failure: 'health check failed and rollback failed', releaseId: release.releaseId, report: failure({ project: manifest.name, taskrailVersion: TASKRAIL_VERSION, stage: 'health', category: 'health_failed', message: 'rollback failed', releaseId: release.releaseId, rollbackAttempted: true, rollbackResult: 'failed', nextStep: 'inspect release history and restore manually', environment: envInfo.name }) };
    }
    await writeReceipt(workspace, {
      automation: manifest.name,
      environment: envInfo.name,
      sha: git.sha,
      taskrailVersion: TASKRAIL_VERSION,
      releaseId: release.releaseId,
      migration: 'PASS',
      health: 'FAIL',
      rollback: 'PASS',
      deployedAt: new Date().toISOString(),
    });
    return { deployed: false, rolledBack: true, backupPath: backup, failure: 'health check failed; rollback succeeded', releaseId: release.releaseId, report: failure({ project: manifest.name, taskrailVersion: TASKRAIL_VERSION, stage: 'health', category: 'health_failed', message: 'rollback succeeded', releaseId: release.releaseId, rollbackAttempted: true, rollbackResult: 'success', nextStep: 'fix candidate and redeploy', environment: envInfo.name }) };
  } finally {
    await releaseLock(lockDir);
  }
}

export async function rollbackFromState(stateFile: string, health: HealthCheckDefinition | undefined, plugin?: AutomationPlugin) {
  const state = await readState(stateFile);
  if (!state) return { ok: false, failure: 'missing rollback state' };
  try {
    await restoreActivation(state.targetPath, state.backupPath || '', state.previousReleasePath);
    const restoredPath = state.previousReleasePath || state.targetPath;
    const restored = await runHealthCheck(health, restoredPath, plugin);
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

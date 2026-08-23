import { copyFile, mkdir, readFile, readdir, readlink, rename, rm, stat, symlink, unlink, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
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
import { isTaskRailCompatible, resolvePaths } from './config.js';
import { writeEvidence } from './evidence.js';
import { runGate } from './gate.js';
import { inspectGitState } from './git.js';
import { detectEnvironment } from './env.js';
import { inspectChange } from './change.js';
import { capabilityRootsFor } from './capabilities.js';
import { readPrivateState, writePrivateState } from './private-state.js';
import { runBoundedCommand } from './bounded-command.js';
import { verifySystemdOperationalContext } from './systemd.js';

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
  transactionalUpdate?: boolean;
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
    const entryStat = await lstat(current);
    if (entryStat.isSymbolicLink()) throw new Error(`candidate staging rejects symlink: ${path.relative(source, current) || '.'}`);
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

async function runCommand(command: string, cwd: string, timeoutMs = 300_000) {
  const result = await runBoundedCommand({ command, cwd, timeoutMs, maxOutputBytes: 256 * 1024 });
  return { ok: result.ok, code: result.exitCode ?? 1, error: result.ok ? undefined : result.message };
}

function dependencyInstallCommand(manifest: FrameworkManifest) {
  if (manifest.dependencyManager?.installCommand) return manifest.dependencyManager.installCommand;
  if (manifest.dependencyManager?.tool === 'npm') return 'npm ci --omit=dev';
  return undefined;
}

async function readState(stateFile: string): Promise<DeployState | null> {
  try {
    const raw = JSON.parse(await readFile(stateFile, 'utf8')) as Record<string, unknown>;
    const state = await readPrivateState<DeployState & Record<string, unknown>>(stateFile, { allowLegacy: true });
    if (!state) return null;
    if (!('_taskrailIntegrity' in raw)) await writePrivateState(stateFile, state);
    return state as DeployState;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeState(stateFile: string, state: DeployState) {
  await writePrivateState(stateFile, state as unknown as Record<string, unknown>);
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

function hasFrameworkCapability(manifest: FrameworkManifest, prefix: string) {
  return (manifest.frameworkCapabilities ?? []).some((item) => item === prefix || item.startsWith(`${prefix}@`));
}

function declaredHealth(manifest: FrameworkManifest) {
  return manifest.healthChecks?.length ? manifest.healthChecks : manifest.healthCheck;
}

function productionOperationalContext(manifest: FrameworkManifest, environment: EnvironmentInfo) {
  if (environment.name !== 'production' || process.platform !== 'linux' || manifest.serviceManager?.type !== 'systemd') {
    return { runtimeChecks: [], timerChecks: [], passed: true };
  }
  return verifySystemdOperationalContext(manifest, { environment: environment.name });
}

function fingerprintInputs(manifest: FrameworkManifest, git: GitState) {
  const payload = {
    sha: git.sha || '',
    compatibility: manifest.taskrailCompatibility || '',
    validationCommand: manifest.validationCommand,
    testCommand: manifest.testCommand,
    installCommand: dependencyInstallCommand(manifest) || '',
    buildCommand: manifest.buildCommand || '',
    healthCommand: manifest.healthCommand || manifest.runtimeHealthCommand || '',
    migrations: manifest.migrations || null,
    dependencyManager: manifest.dependencyManager || null,
    serviceManager: manifest.serviceManager || null,
    capabilities: manifest.capabilities || [],
    taskrailVersion: TASKRAIL_VERSION,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function pruneReleases(releaseRoot: string, preserve: Set<string>, retain = 0) {
  const entries = await readdir(releaseRoot, { withFileTypes: true }).catch(() => []);
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(releaseRoot, entry.name));
  const removable = [] as Array<{ target: string; mtime: number }>;
  for (const dir of dirs) {
    if (preserve.has(dir)) continue;
    try {
      removable.push({ target: dir, mtime: (await stat(dir)).mtimeMs });
    } catch {
      continue;
    }
  }
  removable.sort((a, b) => b.mtime - a.mtime);
  for (const old of removable.slice(retain)) await rm(old.target, { recursive: true, force: true });
}

async function cleanupOwnedArtifacts(workspace: string, manifest: FrameworkManifest, releaseRoot: string, state: DeployState | null, preserveReleasePath?: string) {
  await rm(path.join(workspace, `${manifest.name}.candidate`), { recursive: true, force: true }).catch(() => undefined);
  await pruneBackups(workspace, manifest.name, manifest.backup?.retain ?? 0);
  const preserve = new Set<string>([preserveReleasePath, state?.releasePath, state?.previousReleasePath, state?.lastKnownGoodReleasePath].filter(Boolean) as string[]);
  await pruneReleases(releaseRoot, preserve, manifest.backup?.retain ?? 0);
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

export async function loadPlugin(modulePath: string, cwd = process.cwd()): Promise<AutomationPlugin> {
  const mod = await import(pathToFileURL(path.resolve(cwd, modulePath)).href);
  return mod.default ?? mod.plugin ?? mod;
}

export async function loadPlugins(manifest: FrameworkManifest, cwd = process.cwd()): Promise<AutomationPlugin[]> {
  const refs = manifest.plugins ?? [];
  const plugins: AutomationPlugin[] = [];
  for (const ref of refs) plugins.push(await loadPlugin(ref.module, cwd));
  return plugins;
}

async function withHealthTimeout<T>(operation: Promise<T> | T, timeoutMs = 30_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`health check timed out after ${timeoutMs}ms`)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runHealthCheck(health: HealthCheckDefinition | HealthCheckDefinition[] | undefined, cwd: string, plugin?: AutomationPlugin, runtimeHealthCommand?: string) {
  const checks: Array<Promise<{ ok: boolean; tier: 'process' | 'integration' | 'end-to-end'; details?: string }>> = [];
  for (const definition of (Array.isArray(health) ? health : health ? [health] : [])) {
    checks.push((async () => {
      try {
        if (definition.type === 'command') {
          const result = await runCommand(definition.command, cwd, 30_000);
          return { ok: result.ok, tier: 'process' as const, details: result.error ?? `exit ${result.code}` };
        }
        if (definition.type === 'file') return { ok: await pathExists(path.resolve(cwd, definition.path)), tier: 'process' as const, details: definition.path };
        if (definition.type === 'http') {
          const response = await fetch(definition.url, { signal: AbortSignal.timeout(30_000) });
          return { ok: response.status === (definition.expectStatus ?? 200), tier: 'integration' as const, details: `status ${response.status}` };
        }
        return { ok: true, tier: 'process' as const };
      } catch (error) {
        return { ok: false, tier: 'integration' as const, details: error instanceof Error ? error.message : String(error) };
      }
    })());
  }
  if (runtimeHealthCommand) {
    checks.push((async () => {
      const result = await runCommand(runtimeHealthCommand, cwd, 30_000);
      return { ok: result.ok, tier: 'process' as const, details: result.error ?? `exit ${result.code}` };
    })());
  }
  if (plugin?.healthCheck) {
    checks.push((async () => {
      try {
        const result = await withHealthTimeout(plugin.healthCheck!(), 30_000);
        return { ok: result.ok, tier: 'integration' as const, details: result.details };
      } catch (error) {
        return { ok: false, tier: 'integration' as const, details: error instanceof Error ? error.message : String(error) };
      }
    })());
  }
  if (!checks.length) return { ok: true, tier: 'process' as const };
  const results = await Promise.all(checks);
  return results.find((result) => !result.ok) ?? results[0];
}

async function migrationPreflight(manifest: FrameworkManifest, cwd: string) {
  if (!manifest.migrations?.checkCommand) return { ok: true, code: 0, error: undefined };
  return runCommand(manifest.migrations.checkCommand, cwd);
}

async function migrationApply(manifest: FrameworkManifest, cwd: string) {
  if (!manifest.migrations?.applyCommand) return { ok: true, code: 0, error: undefined };
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
  const pluginNames = await loadPlugins(manifest, cwd).then((plugins) => plugins.map((p) => p.name)).catch(() => []);
  const drift = state?.releasePath && (await pathExists(livePath)) ? await detectDrift(livePath, state.releasePath, manifest) : undefined;
  const git = inspectGitState(cwd);
  const compatible = isTaskRailCompatible(TASKRAIL_VERSION, manifest.taskrailCompatibility);
  const deployable = preflightResult.ok && compatible && (!drift || !drift.drifted);
  return {
    version: TASKRAIL_VERSION,
    compatible,
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
  const fingerprint = fingerprintInputs(manifest, git);
  const operationalPlugin = plugin ?? ((manifest.plugins?.length ?? 0) ? (await loadPlugins(manifest, projectRoot))[0] : undefined);

  if (envInfo.name === 'production') {
    if (!git.available || !git.sha) return { deployed: false, rolledBack: false, failure: 'production deploy requires git sha' };
    if (!git.clean) return { deployed: false, rolledBack: false, failure: 'production deploy requires clean git tree' };
  }

  const installCommand = dependencyInstallCommand(manifest);
  const buildCommand = manifest.buildCommand;
  const preflightResult = await preflight(manifest, projectRoot);
  if (!preflightResult.ok) {
    const failedChecks = preflightResult.checks
      .filter((check) => !check.ok)
      .map((check) => `${check.name}${check.message ? `: ${check.message}` : ''}`)
      .join('; ');
    return {
      deployed: false,
      rolledBack: false,
      failure: `preflight failed${failedChecks ? `: ${failedChecks}` : ''}`,
      report: failure({ project: manifest.name, taskrailVersion: TASKRAIL_VERSION, stage: 'preflight', category: 'preflight_failed', message: `preflight checks failed${failedChecks ? `: ${failedChecks}` : ''}`, rollbackAttempted: false, rollbackResult: 'not-needed', nextStep: 'fix the reported preflight checks', environment: envInfo.name }),
    };
  }

  const priorState = await readState(stateFile);
  if (priorState && manifest.migrations?.applyCommand && !options.transactionalUpdate) {
    return { deployed: false, rolledBack: false, failure: 'existing deployment with migrations requires taskrail update' };
  }
  if (hasFrameworkCapability(manifest, 'change-detection') && priorState?.currentSha === git.sha && priorState?.currentFingerprint === fingerprint && priorState?.releasePath && await pathExists(target)) {
    const existingReleasePath = priorState.releasePath;
    const drift = await detectDrift(await currentLivePath(target).catch(() => target), existingReleasePath, manifest);
    if (!drift.drifted) {
      const health = await runHealthCheck(declaredHealth(manifest), strategy === 'release-symlink' ? existingReleasePath : target, operationalPlugin, manifest.healthCommand || manifest.runtimeHealthCommand);
      const operational = health.ok ? productionOperationalContext(manifest, envInfo) : { runtimeChecks: [], timerChecks: [], passed: false };
      if (health.ok && operational.passed) {
        await cleanupOwnedArtifacts(workspace, manifest, releaseRoot, priorState, existingReleasePath);
        return { deployed: true, rolledBack: false, releaseId: priorState.currentReleaseId, releasePath: existingReleasePath, sha: git.sha };
      }
    }
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
    const runtimeExcludes = (manifest.runtimePaths ?? []).map((item) => path.resolve(source, item));
    const sourceExcludes = Array.from(new Set([candidate, backup, stateFile, releaseRoot, historyFile, lockDir, ...runtimeExcludes]));
    await copyDir(source, candidate, sourceExcludes);
    await stageCapabilities(manifest, projectRoot, candidate);

    if (installCommand) {
      const install = await runCommand(installCommand, candidate);
      if (!install.ok) return { deployed: false, rolledBack: false, failure: install.error || 'candidate dependency installation failed' };
    }
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

    if (manifest.requiredChecks?.length) {
      const liveGate = await runGate(manifest, projectRoot, operationalPlugin ? [operationalPlugin] : []);
      if (liveGate.verdict !== 'PASS') return { deployed: false, rolledBack: false, failure: `verification blocked: ${liveGate.verdict}` };
    }
    if ((manifest.protectedPaths?.length ?? 0) > 0 || hasFrameworkCapability(manifest, 'change-detection')) {
      const change = await inspectChange(manifest, projectRoot);
      if (!change.deployAllowed) return { deployed: false, rolledBack: false, failure: `protected change blocked: ${change.gitError || change.protectedPaths.join(', ') || 'unknown'}` };
    }

    const state = await readState(stateFile);
    const livePath = await currentLivePath(target).catch(() => target);
    if (state?.releasePath && await pathExists(livePath)) {
      const drift = await detectDrift(livePath, state.releasePath, manifest);
      if (drift.drifted) return { deployed: false, rolledBack: false, failure: `drift detected: ${drift.files.join(', ')}` };
    }

    const release = await createRelease(manifest, candidate, releaseRoot, options.sourceRevision || git.sha);
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
    const health = await runHealthCheck(declaredHealth(manifest), liveCheckPath, operationalPlugin, manifest.healthCommand || manifest.runtimeHealthCommand);
    const operational = health.ok ? productionOperationalContext(manifest, envInfo) : { runtimeChecks: [], timerChecks: [], passed: false };
    if (health.ok && operational.passed) {
      const nextState: DeployState = {
        backupPath: backup,
        targetPath: target,
        releasePath: release.path,
        previousReleasePath,
        currentReleaseId: release.releaseId,
        currentSha: git.sha,
        currentFingerprint: fingerprint,
        lastKnownGoodReleasePath: release.path,
        lastKnownGoodReleaseId: release.releaseId,
        lastKnownGoodSha: git.sha,
      };
      await writeState(stateFile, nextState);
      if (hasFrameworkCapability(manifest, 'release-retention')) await cleanupOwnedArtifacts(workspace, manifest, releaseRoot, state, release.path);
      else await pruneBackups(workspace, manifest.name, manifest.backup?.retain ?? 0);
      const receiptPath = await writeReceipt(workspace, {
        automation: manifest.name,
        environment: envInfo.name,
        sha: git.sha,
        taskrailVersion: TASKRAIL_VERSION,
        releaseId: release.releaseId,
        migration: 'PASS',
        health: 'PASS',
        runtime: operational.passed ? 'PASS' : 'SKIPPED',
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
    const restored = await runHealthCheck(declaredHealth(manifest), restoredPath, operationalPlugin, manifest.healthCommand || manifest.runtimeHealthCommand);
    const restoredOperational = restored.ok ? productionOperationalContext(manifest, envInfo) : { runtimeChecks: [], timerChecks: [], passed: false };
    const runtimeFailed = health.ok && !operational.passed;
    if (!restored.ok || !restoredOperational.passed) {
      await writeReceipt(workspace, {
        automation: manifest.name,
        environment: envInfo.name,
        sha: git.sha,
        taskrailVersion: TASKRAIL_VERSION,
        releaseId: release.releaseId,
        migration: 'PASS',
        health: health.ok ? 'PASS' : 'FAIL',
        runtime: runtimeFailed ? 'FAIL' : 'PASS',
        rollback: 'FAIL',
        deployedAt: new Date().toISOString(),
      });
      return { deployed: false, rolledBack: true, backupPath: backup, failure: runtimeFailed ? 'runtime context failed and rollback verification failed' : 'health check failed and rollback failed', releaseId: release.releaseId, report: failure({ project: manifest.name, taskrailVersion: TASKRAIL_VERSION, stage: runtimeFailed ? 'runtime' : 'health', category: runtimeFailed ? 'runtime_failed' : 'health_failed', message: 'rollback verification failed', releaseId: release.releaseId, rollbackAttempted: true, rollbackResult: 'failed', nextStep: 'inspect release history and restore manually', environment: envInfo.name }) };
    }
    await appendAudit(historyFile, { ts: new Date().toISOString(), type: 'deploy_rolled_back', project: manifest.name, taskrailVersion: TASKRAIL_VERSION, releaseId: release.releaseId, sha: git.sha });
    await writeReceipt(workspace, {
      automation: manifest.name,
      environment: envInfo.name,
      sha: git.sha,
      taskrailVersion: TASKRAIL_VERSION,
      releaseId: release.releaseId,
      migration: 'PASS',
      health: health.ok ? 'PASS' : 'FAIL',
      runtime: runtimeFailed ? 'FAIL' : 'PASS',
      rollback: 'PASS',
      deployedAt: new Date().toISOString(),
    });
    return { deployed: false, rolledBack: true, backupPath: backup, failure: runtimeFailed ? 'runtime context failed; rollback succeeded' : 'health check failed; rollback succeeded', releaseId: release.releaseId, report: failure({ project: manifest.name, taskrailVersion: TASKRAIL_VERSION, stage: runtimeFailed ? 'runtime' : 'health', category: runtimeFailed ? 'runtime_failed' : 'health_failed', message: 'rollback succeeded', releaseId: release.releaseId, rollbackAttempted: true, rollbackResult: 'success', nextStep: 'fix candidate and redeploy', environment: envInfo.name }) };
  } finally {
    await releaseLock(lockDir);
  }
}

export async function rollbackFromState(stateFile: string, health: HealthCheckDefinition | HealthCheckDefinition[] | undefined, plugin?: AutomationPlugin) {
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
  return rollbackFromState(stateFile, declaredHealth(manifest), plugin);
}

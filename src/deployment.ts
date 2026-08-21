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

function executableForPlatform(rawBin: string) {
  if (rawBin === 'node') return process.execPath;
  if (process.platform !== 'win32') return rawBin;
  if (/\.(?:exe|cmd|bat)$/i.test(rawBin) || rawBin.includes('/') || rawBin.includes('\\')) return rawBin;
  const windowsCommandShims = new Set(['npm', 'npx', 'pnpm', 'yarn', 'corepack']);
  return windowsCommandShims.has(rawBin.toLowerCase()) ? `${rawBin}.cmd` : rawBin;
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
    const child = spawn(executableForPlatform(rawBin), args, { cwd, stdio: 'ignore' });
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
  await writeFile(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
}

async function writeReceipt(workspace: string, receipt: Record<string, unknown>) {
  const dir = path.join(workspace, '.taskrail', 'receipts');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const latest = path.join(dir, 'latest.json');
  const dated = path.join(dir, `${String(receipt.releaseId || 'unknown')}.json`);
  const body = JSON.stringify(receipt, null, 2);
  await writeFile(latest, body, { mode: 0o600 });
  await writeFile(dated, body, { mode: 0o600 });
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

function fingerprintInputs(manifest: FrameworkManifest, git: GitState) {
  const payload = {
    sha: git.sha || '',
    compatibility: manifest.taskrailCompatibility || '',
    validationCommand: manifest.validationCommand,
    testCommand: manifest.testCommand,
    buildCommand: runtimeInstallCommand(manifest) || '',
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
  const keep = Math.max(0, retain);
  for (const old of removable.slice(keep)) await rm(old.target, { recursive: true, force: true });
}

async function rollbackTarget(target: string, backup?: string) {
  if (!backup || !(await pathExists(backup))) return { ok: false, message: 'backup is missing' };
  await rm(target, { recursive: true, force: true });
  await rename(backup, target);
  return { ok: true, message: 'rollback complete' };
}

async function rollbackReleaseSymlink(target: string, previousReleasePath?: string) {
  if (!previousReleasePath || !(await pathExists(previousReleasePath))) return { ok: false, message: 'previous release is missing' };
  await rm(target, { recursive: true, force: true });
  await symlink(previousReleasePath, target, 'dir');
  return { ok: true, message: 'release symlink restored' };
}

async function writeFailureReport(workspace: string, report: FailureReport) {
  const dir = path.join(workspace, '.taskrail', 'failures');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${report.stage}.json`);
  await writeFile(file, JSON.stringify(report, null, 2));
  return file;
}

export async function loadPlugins(manifest: FrameworkManifest) {
  const plugins: AutomationPlugin[] = [];
  for (const ref of manifest.plugins ?? []) {
    const target = path.isAbsolute(ref.module) ? ref.module : path.resolve(ref.module);
    const module = await import(pathToFileURL(target).href);
    const plugin = (module.default ?? module.plugin) as AutomationPlugin;
    if (!plugin?.name) throw new Error(`invalid plugin: ${ref.name}`);
    plugins.push(plugin);
  }
  return plugins;
}

export async function runHealthCheck(
  definition: HealthCheckDefinition | undefined,
  cwd: string,
  plugin?: AutomationPlugin,
  command?: string,
): Promise<{ ok: boolean; details?: string }> {
  if (command) {
    const result = await runCommand(command, cwd);
    if (!result.ok) return { ok: false, details: result.error || `health command exited ${result.code}` };
  }
  if (!definition) return plugin?.healthCheck ? await plugin.healthCheck() : { ok: true };
  if (definition.type === 'file') return { ok: await pathExists(path.resolve(cwd, definition.path)), details: definition.path };
  if (definition.type === 'command') {
    const result = await runCommand(definition.command, cwd);
    return { ok: result.ok, details: result.error || `exit ${result.code}` };
  }
  if (definition.type === 'http') {
    try {
      const response = await fetch(definition.url);
      const expected = definition.expectStatus ?? 200;
      return { ok: response.status === expected, details: `status ${response.status}` };
    } catch (error) {
      return { ok: false, details: error instanceof Error ? error.message : String(error) };
    }
  }
  return { ok: false, details: 'unknown health check' };
}

export async function rollback(state: DeployState, plugin?: AutomationPlugin): Promise<{ ok: boolean; message: string }> {
  try {
    if (state.previousReleasePath) {
      const restored = await rollbackReleaseSymlink(state.targetPath, state.previousReleasePath);
      if (!restored.ok) return restored;
    } else {
      const restored = await rollbackTarget(state.targetPath, state.backupPath);
      if (!restored.ok) return restored;
    }
    await plugin?.rollback?.();
    return { ok: true, message: 'rollback complete' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export async function safeDeploy(manifest: FrameworkManifest, plugin?: AutomationPlugin, options: DeployOptions = {}): Promise<DeployOutcome> {
  const projectRoot = options.projectRoot || process.cwd();
  const resolved = resolvePaths(manifest, projectRoot);
  const sourceDir = resolved.sourceDir;
  const target = resolved.deployDir;
  const workspace = path.dirname(target);
  const candidate = path.join(workspace, `${manifest.name}.candidate`);
  const backup = path.join(workspace, `${manifest.name}.backup-${Date.now()}`);
  const stateFile = path.join(workspace, `${manifest.name}.deploy-state.json`);
  const releasesDir = options.releasesDir ?? (manifest.deployStrategy?.releaseRoot ? path.resolve(projectRoot, manifest.deployStrategy.releaseRoot) : path.join(workspace, '.taskrail', 'releases'));
  const historyFile = options.historyFile ?? path.join(workspace, '.taskrail', 'history.jsonl');
  const lockDir = options.lockDir ?? path.join(workspace, '.taskrail', 'lock');
  await acquireLock(lockDir, manifest.name);
  try {
    const git = inspectGitState(projectRoot);
    const env = detectEnvironment(manifest, projectRoot);
    const fingerprint = fingerprintInputs(manifest, git);
    const priorState = await readState(stateFile);
    const strategy = manifest.deployStrategy?.type || 'replace-in-place';
    const noOp = priorState?.currentSha && git.sha && priorState.currentSha === git.sha && priorState.currentFingerprint === fingerprint && await runHealthCheck(manifest.healthCheck ?? manifest.healthChecks?.[0], target, plugin, manifest.healthCommand || manifest.runtimeHealthCommand);
    if (noOp?.ok) {
      await appendAudit(historyFile, { at: new Date().toISOString(), project: manifest.name, action: 'deploy', status: 'noop', sha: git.sha, message: 'same revision and fingerprint already healthy' });
      return { deployed: true, rolledBack: false, releaseId: priorState?.currentReleaseId, releasePath: priorState?.releasePath, sha: git.sha };
    }
    const change = await inspectChange(manifest, projectRoot, await loadPlugins(manifest).catch(() => []));
    if (!change.deployAllowed) return { deployed: false, rolledBack: false, failure: `change blocked: ${change.risk}` };
    const pre = await preflight(manifest, projectRoot);
    if (!pre.ok) return { deployed: false, rolledBack: false, failure: 'preflight failed' };
    const gate = await runGate(manifest, projectRoot, await loadPlugins(manifest).catch(() => []));
    if (gate.verdict !== 'PASS') return { deployed: false, rolledBack: false, failure: `gate ${gate.verdict}` };
    await rm(candidate, { recursive: true, force: true });
    const exclude = [target, candidate, backup, releasesDir, historyFile, lockDir, stateFile];
    await copyDir(sourceDir, candidate, exclude);
    await stageCapabilities(manifest, projectRoot, candidate);
    if (manifest.dependencyManager || manifest.buildCommand) {
      const command = runtimeInstallCommand(manifest);
      if (command) {
        const built = await runCommand(command, candidate);
        if (!built.ok) return { deployed: false, rolledBack: false, failure: built.error || `build failed (${built.code})` };
      }
    }
    if (manifest.validationCommand) {
      const valid = await runCommand(manifest.validationCommand, candidate);
      if (!valid.ok) return { deployed: false, rolledBack: false, failure: valid.error || `candidate validation failed (${valid.code})` };
    }
    const plugins = await loadPlugins(manifest).catch(() => []);
    const releaseMeta = await createRelease(manifest, candidate, releasesDir, { sourceRevision: options.sourceRevision || git.sha, environment: env.name });
    let previousReleasePath: string | undefined;
    let activeReleasePath: string | undefined;
    let backupPath: string | undefined;
    let activated = false;
    try {
      if (strategy === 'release-symlink') {
        previousReleasePath = priorState?.releasePath;
        activeReleasePath = releaseMeta.path;
        const tempLink = `${target}.taskrail-next-${Date.now()}`;
        await rm(tempLink, { recursive: true, force: true });
        await symlink(releaseMeta.path, tempLink, 'dir');
        if (await pathExists(target) || await isSymlink(target)) await rm(target, { recursive: true, force: true });
        await rename(tempLink, target);
      } else {
        if (await pathExists(target)) {
          await rename(target, backup);
          backupPath = backup;
        }
        await rename(candidate, target);
        activeReleasePath = target;
      }
      activated = true;
      if (manifest.migrations?.applyCommand) {
        const migrated = await runCommand(manifest.migrations.applyCommand, target);
        if (!migrated.ok) throw new Error(migrated.error || `migration failed (${migrated.code})`);
      }
      const health = await runHealthCheck(manifest.healthCheck ?? manifest.healthChecks?.[0], target, plugin, manifest.healthCommand || manifest.runtimeHealthCommand);
      if (!health.ok) throw new Error(`health check failed: ${health.details || 'unknown'}`);
      const receipt = {
        schema: 1,
        releaseId: releaseMeta.releaseId,
        releasePath: releaseMeta.path,
        sha: options.sourceRevision || git.sha,
        environment: env.name,
        manifestName: manifest.name,
        taskrailVersion: TASKRAIL_VERSION,
        activatedAt: new Date().toISOString(),
      };
      const receiptPath = await writeReceipt(workspace, receipt);
      await writeState(stateFile, {
        backupPath,
        targetPath: target,
        releasePath: activeReleasePath,
        previousReleasePath,
        currentReleaseId: releaseMeta.releaseId,
        currentSha: options.sourceRevision || git.sha,
        currentFingerprint: fingerprint,
        lastKnownGoodReleasePath: activeReleasePath,
        lastKnownGoodReleaseId: releaseMeta.releaseId,
        lastKnownGoodSha: options.sourceRevision || git.sha,
      });
      await appendAudit(historyFile, { at: new Date().toISOString(), project: manifest.name, action: 'deploy', status: 'success', sha: options.sourceRevision || git.sha, message: receiptPath });
      const preserve = new Set([releaseMeta.path, previousReleasePath, priorState?.lastKnownGoodReleasePath].filter((item): item is string => Boolean(item)));
      await pruneReleases(releasesDir, preserve, manifest.backup?.retain ?? 0);
      await pruneBackups(workspace, manifest.name, manifest.backup?.retain ?? 0);
      return { deployed: true, rolledBack: false, backupPath, releaseId: releaseMeta.releaseId, releasePath: releaseMeta.path, sha: options.sourceRevision || git.sha };
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      let rolledBack = false;
      if (activated) {
        const rollbackResult = strategy === 'release-symlink'
          ? await rollbackReleaseSymlink(target, previousReleasePath)
          : await rollbackTarget(target, backupPath);
        rolledBack = rollbackResult.ok;
      }
      const failureReport = buildFailureReport({ project: manifest.name, stage: 'deploy', message: failure, releaseId: releaseMeta.releaseId, rollbackAttempted: activated, rollbackResult: activated ? (rolledBack ? 'success' : 'failed') : 'not-needed', environment: env.name });
      const report = await writeFailureReport(workspace, failureReport);
      await appendAudit(historyFile, { at: new Date().toISOString(), project: manifest.name, action: 'deploy', status: 'failure', sha: options.sourceRevision || git.sha, message: report });
      return { deployed: false, rolledBack, backupPath, releaseId: releaseMeta.releaseId, releasePath: releaseMeta.path, failure, report, sha: options.sourceRevision || git.sha };
    }
  } finally {
    await releaseLock(lockDir);
    await rm(candidate, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function rollbackFromManifest(manifest: FrameworkManifest, plugin?: AutomationPlugin) {
  const resolved = resolvePaths(manifest, process.cwd());
  const stateFile = path.join(path.dirname(resolved.deployDir), `${manifest.name}.deploy-state.json`);
  const state = await readState(stateFile);
  if (!state) return { ok: false, message: `no deploy state found at ${stateFile}` };
  return rollback(state, plugin);
}

export async function check(manifest: FrameworkManifest, options: ManifestRunOptions = {}): Promise<CheckResult> {
  const cwd = options.cwd || process.cwd();
  const pre = await preflight(manifest, cwd);
  const checks = [...pre.checks];
  const configErrors = validateConfig({ projectName: manifest.name, environment: process.env, manifest });
  for (const error of configErrors) checks.push({ name: `config:${error}`, ok: false, message: error });
  const plugins = await loadPlugins(manifest).catch(() => []);
  for (const candidatePlugin of plugins) {
    for (const error of candidatePlugin.validate?.({ projectName: manifest.name, environment: process.env, manifest }) ?? []) checks.push({ name: `plugin:${candidatePlugin.name}`, ok: false, message: error });
  }
  return { ok: checks.every((item) => item.ok), checks };
}

export async function doctor(manifest: FrameworkManifest, options: ManifestRunOptions = {}): Promise<DoctorResult> {
  const cwd = options.cwd || process.cwd();
  const paths = resolvePaths(manifest, cwd);
  const environment = detectEnvironment(manifest, cwd);
  const manifestErrors = validateConfig({ projectName: manifest.name, environment: process.env, manifest });
  const git = inspectGitState(cwd);
  const plugins = await loadPlugins(manifest).catch(() => []);
  const root = path.dirname(paths.deployDir);
  const stateFile = path.join(root, `${manifest.name}.deploy-state.json`);
  const state = await readState(stateFile);
  const requiredSharedFiles: DoctorResult['requiredSharedFiles'] = [];
  for (const requirement of manifest.requiredSharedFiles ?? []) {
    const item = typeof requirement === 'string' ? { path: requirement } : requirement;
    const target = path.isAbsolute(item.path) ? item.path : path.resolve(cwd, item.path);
    requiredSharedFiles.push({ file: target, ok: await pathExists(target), detail: item.secret ? 'secret' : undefined });
  }
  const envPresence = (manifest.requiredEnv ?? []).map((name) => ({ name, ok: Boolean(process.env[name]) }));
  const lockState = await import('./locks.js').then(async ({ readLock }) => {
    const lock = await readLock(path.join(root, '.taskrail', 'lock'));
    return lock ? { locked: true, holder: lock.owner } : { locked: false };
  });
  const health = await runHealthCheck(manifest.healthCheck ?? manifest.healthChecks?.[0], paths.deployDir, plugin ?? plugins[0], manifest.healthCommand || manifest.runtimeHealthCommand).catch(() => ({ ok: false }));
  let drift: DoctorResult['drift'];
  if (state?.releasePath) {
    const result = await detectDrift(paths.deployDir, state.releasePath, manifest).catch(() => ({ drifted: true, files: ['unknown'], items: [] }));
    drift = { drifted: result.drifted, files: result.files, items: result.items };
  }
  return {
    version: TASKRAIL_VERSION,
    compatible: isCompatible(TASKRAIL_VERSION, manifest.taskrailCompatibility),
    manifestValid: manifestErrors.length === 0,
    project: manifest.name,
    environment,
    runtimeVersion: process.version,
    requiredSharedFiles,
    envPresence,
    lockState,
    deployTarget: paths.deployDir,
    plugins: plugins.map((item) => item.name),
    latestHealthyRelease: state?.lastKnownGoodReleaseId,
    drift,
    healthReady: health.ok,
    lastDeploymentResult: state?.currentReleaseId,
    git,
    deployable: manifestErrors.length === 0 && isCompatible(TASKRAIL_VERSION, manifest.taskrailCompatibility) && envPresence.every((item) => item.ok) && requiredSharedFiles.every((item) => item.ok),
  };
}

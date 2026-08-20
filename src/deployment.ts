import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
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
}

export interface DoctorResult {
  version: string;
  compatible: boolean;
  manifestValid: boolean;
  runtimeVersion: string;
  requiredFiles: Array<{ file: string; ok: boolean }>;
  envPresence: Array<{ name: string; ok: boolean }>;
  lockState: { locked: boolean; holder?: string };
  latestHealthyRelease?: string;
  drift?: { drifted: boolean; files: string[] };
  healthReady: boolean;
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

async function copyDir(source: string, target: string) {
  await cp(source, target, { recursive: true, preserveTimestamps: true, errorOnExist: false });
}

async function runCommand(command: string, cwd: string) {
  const { spawn } = await import('node:child_process');
  return await new Promise<{ ok: boolean; code: number }>((resolve) => {
    const child = spawn(command, { cwd, shell: true, stdio: 'ignore' });
    child.on('exit', (code) => resolve({ ok: code === 0, code: code ?? 1 }));
  });
}

export async function loadPlugin(modulePath: string): Promise<AutomationPlugin> {
  const mod = await import(pathToFileURL(path.resolve(modulePath)).href);
  return mod.default ?? mod.plugin ?? mod;
}

export async function loadPlugins(manifest: FrameworkManifest): Promise<AutomationPlugin[]> {
  const refs = manifest.plugins ?? [];
  const plugins = [];
  for (const ref of refs) plugins.push(await loadPlugin(ref.module));
  return plugins;
}

export async function runHealthCheck(health: HealthCheckDefinition | undefined, cwd: string, plugin?: AutomationPlugin) {
  if (!health) return { ok: true, tier: 'process' as const };
  if (health.type === 'command') {
    const result = await runCommand(health.command, cwd);
    return { ok: result.ok, tier: 'process' as const, details: `exit ${result.code}` };
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
  const drift = state?.releasePath && (await pathExists(path.resolve(manifest.deployDir)))
    ? await detectDrift(path.resolve(manifest.deployDir), state.releasePath)
    : undefined;
  return {
    version: TASKRAIL_VERSION,
    compatible: isCompatible(TASKRAIL_VERSION, manifest.taskrailCompatibility),
    manifestValid: preflightResult.ok,
    runtimeVersion: process.version,
    requiredFiles: (manifest.requiredFiles ?? []).map((file) => ({ file, ok: true })),
    envPresence: (manifest.requiredEnv ?? []).map((name) => ({ name, ok: Boolean(process.env[name]) })),
    lockState: lock.ok ? { locked: false } : { locked: true, holder: lock.holder },
    latestHealthyRelease,
    drift,
    healthReady: Boolean(manifest.healthCheck || manifest.healthChecks?.length),
  };
}

export async function safeDeploy(manifest: FrameworkManifest, plugin?: AutomationPlugin, options: DeployOptions = {}): Promise<DeployOutcome> {
  const target = path.resolve(manifest.deployDir);
  const source = path.resolve(manifest.sourceDir);
  const workspace = path.dirname(target);
  const candidate = path.join(workspace, `${manifest.name}.candidate`);
  const backup = path.join(workspace, `${manifest.name}.backup-${Date.now()}`);
  const stateFile = path.join(workspace, `${manifest.name}.deploy-state.json`);
  const releaseDir = options.releasesDir || path.join(workspace, '.taskrail', 'releases');
  const historyFile = options.historyFile || path.join(workspace, '.taskrail', 'history.jsonl');
  const lockDir = options.lockDir || path.join(workspace, '.taskrail', 'lock');

  const preflightResult = await preflight(manifest);
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
    await copyDir(source, candidate);

    const validation = await runCommand(manifest.validationCommand, candidate);
    if (!validation.ok) {
      return { deployed: false, rolledBack: false, failure: 'candidate validation failed' };
    }

    const tests = await runCommand(manifest.testCommand, candidate);
    if (!tests.ok) {
      return { deployed: false, rolledBack: false, failure: 'candidate tests failed' };
    }

    if (manifest.buildCommand) {
      const build = await runCommand(manifest.buildCommand, candidate);
      if (!build.ok) return { deployed: false, rolledBack: false, failure: 'candidate build failed' };
    }

    if (await pathExists(target)) {
      const state = await readState(stateFile);
      if (state?.releasePath) {
        const drift = await detectDrift(target, state.releasePath);
        if (drift.drifted) {
          return { deployed: false, rolledBack: false, failure: `drift detected: ${drift.files.join(', ')}` };
        }
      }
      await rename(target, backup);
    }

    await rename(candidate, target);
    const release = await createRelease(manifest, target, releaseDir, options.sourceRevision);
    await writeState(stateFile, { backupPath: backup, targetPath: target, releasePath: release.path });

    const health = await runHealthCheck(manifest.healthCheck ?? manifest.healthChecks?.[0], target, plugin);
    if (health.ok) {
      await appendAudit(historyFile, { ts: new Date().toISOString(), type: 'deploy_succeeded', project: manifest.name, taskrailVersion: TASKRAIL_VERSION, releaseId: release.releaseId });
      return { deployed: true, rolledBack: false, backupPath: backup, releaseId: release.releaseId };
    }

    await rm(target, { recursive: true, force: true });
    if (await pathExists(backup)) await rename(backup, target);
    const restored = await runHealthCheck(manifest.healthCheck ?? manifest.healthChecks?.[0], target, plugin);
    if (!restored.ok) {
      await appendAudit(historyFile, { ts: new Date().toISOString(), type: 'rollback_failed', project: manifest.name, taskrailVersion: TASKRAIL_VERSION, releaseId: release.releaseId });
      return { deployed: false, rolledBack: true, backupPath: backup, failure: 'health check failed and rollback failed', releaseId: release.releaseId, report: buildFailureReport({ project: manifest.name, taskrailVersion: TASKRAIL_VERSION, stage: 'health', category: 'health_failed', message: 'rollback failed', releaseId: release.releaseId, rollbackAttempted: true, rollbackResult: 'failed', nextStep: 'inspect release history and restore manually' } satisfies FailureReport) };
    }

    await appendAudit(historyFile, { ts: new Date().toISOString(), type: 'rollback_succeeded', project: manifest.name, taskrailVersion: TASKRAIL_VERSION, releaseId: release.releaseId });
    return { deployed: false, rolledBack: true, backupPath: backup, failure: 'health check failed; rollback succeeded', releaseId: release.releaseId, report: buildFailureReport({ project: manifest.name, taskrailVersion: TASKRAIL_VERSION, stage: 'health', category: 'health_failed', message: 'rollback succeeded', releaseId: release.releaseId, rollbackAttempted: true, rollbackResult: 'success', nextStep: 'fix candidate and redeploy' } satisfies FailureReport) };
  } finally {
    await releaseLock(lockDir);
  }
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

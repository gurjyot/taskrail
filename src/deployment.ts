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
  GateVerdict,
} from './types.js';
import { acquireLock, releaseLock } from './locks.js';
import { appendAudit } from './history.js';
import { preflight } from './preflight.js';
import { createRelease } from './release.js';
import { buildFailureReport } from './errors.js';
import { detectDrift } from './drift.js';
import { isCompatible } from './config.js';
import { writeEvidence } from './evidence.js';

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
  project: string;
  runtimeVersion: string;
  requiredFiles: Array<{ file: string; ok: boolean }>;
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

export interface GateResult {
  verdict: GateVerdict;
  requiredChecks: string[];
  steps: Array<{ name: string; ok: boolean; required: boolean; message?: string }>;
  deployAllowed: boolean;
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

function parseCommand(command: string) {
  const parts: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of command.matchAll(re)) parts.push(match[1] ?? match[2] ?? match[3]);
  return parts;
}

async function runCommand(command: string, cwd: string) {
  const { spawn } = await import('node:child_process');
  const [rawBin, ...args] = parseCommand(command);
  const bin = rawBin === 'node' ? process.execPath : rawBin;
  return await new Promise<{ ok: boolean; code: number }>((resolve) => {
    const child = spawn(bin, args, { cwd, stdio: 'ignore' });
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

export async function gate(manifest: FrameworkManifest, cwd = process.cwd(), plugins: AutomationPlugin[] = []): Promise<GateResult> {
  const required = new Set(manifest.requiredChecks ?? ['validation', 'test']);
  const preflightResult = await preflight(manifest);
  const steps: GateResult['steps'] = [{ name: 'preflight', ok: preflightResult.ok, required: true, message: preflightResult.checks.filter((c) => !c.ok).map((c) => c.name).join(', ') || 'ok' }];
  const checks = await check(manifest);
  const preflightOk = checks.checks.every((c) => c.ok);
  steps.push({ name: 'validation', ok: preflightOk, required: required.has('validation') });
  steps.push({ name: 'test', ok: preflightOk, required: required.has('test') });
  if (manifest.buildCommand) steps.push({ name: 'build', ok: true, required: required.has('build') });
  const healthDef = manifest.healthCheck ?? manifest.healthChecks?.[0];
  if (healthDef) {
    const health = await runHealthCheck(healthDef, path.resolve(cwd, manifest.deployDir), plugins[0]);
    steps.push({ name: 'health', ok: health.ok, required: required.has('health'), message: health.details });
  } else if (required.has('health')) {
    steps.push({ name: 'health', ok: false, required: true, message: 'missing health check' });
  }
  if (required.has('drift')) {
    const stateFile = path.join(path.dirname(path.resolve(cwd, manifest.deployDir)), `${manifest.name}.deploy-state.json`);
    try {
      const state = JSON.parse(await readFile(stateFile, 'utf8')) as { releasePath?: string };
      if (!state.releasePath) throw new Error('missing release');
      const drift = await detectDrift(path.resolve(cwd, manifest.deployDir), state.releasePath);
      steps.push({ name: 'drift', ok: !drift.drifted, required: true, message: drift.files.join(', ') || 'clean' });
    } catch {
      steps.push({ name: 'drift', ok: false, required: true, message: 'missing release state' });
    }
  }
  for (const plugin of plugins) {
    const result = await plugin.validate?.({ projectName: manifest.name, environment: process.env, manifest });
    if (result?.length) steps.push({ name: `plugin:${plugin.name}`, ok: false, required: false, message: result.join(', ') });
  }
  const missingRequired = steps.filter((step) => step.required && !step.ok);
  const misconfigured = missingRequired.some((step) => /missing/i.test(step.message ?? ''));
  const verdict: GateVerdict = missingRequired.length ? (misconfigured ? 'MISCONFIGURED' : 'FAIL') : 'PASS';
  return { verdict, requiredChecks: [...required], steps, deployAllowed: verdict === 'PASS' };
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
    requiredFiles: (manifest.requiredFiles ?? []).map((file) => ({ file, ok: true })),
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

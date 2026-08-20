import { cp, mkdir, rm, rename, stat, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AutomationPlugin, DeployResult, FrameworkManifest, HealthCheckDefinition } from './types.js';

export interface DeployOutcome extends DeployResult {
  backupPath?: string;
  failure?: string;
}

export interface DeploymentState {
  backupPath: string;
  targetPath: string;
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

export async function runHealthCheck(health: HealthCheckDefinition | undefined, cwd: string, plugin?: AutomationPlugin) {
  if (!health) return { ok: true };
  if (health.type === 'command') return runCommand(health.command, cwd).then((r) => ({ ok: r.ok, details: `exit ${r.code}` }));
  if (health.type === 'file') return { ok: await pathExists(path.resolve(cwd, health.path)), details: health.path };
  if (health.type === 'http') {
    const response = await fetch(health.url);
    return { ok: response.status === (health.expectStatus ?? 200), details: `status ${response.status}` };
  }
  if (plugin?.healthCheck) return await plugin.healthCheck();
  return { ok: true };
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

async function writeState(target: string, state: DeploymentState) {
  await writeFile(target, JSON.stringify(state, null, 2));
}

export async function readState(stateFile: string): Promise<DeploymentState | null> {
  try {
    return JSON.parse(await readFile(stateFile, 'utf8')) as DeploymentState;
  } catch {
    return null;
  }
}

export async function safeDeploy(manifest: FrameworkManifest, plugin?: AutomationPlugin): Promise<DeployOutcome> {
  const target = path.resolve(manifest.deployDir);
  const source = path.resolve(manifest.sourceDir);
  const workspace = path.dirname(target);
  const candidate = path.join(workspace, `${manifest.name}.candidate`);
  const backup = path.join(workspace, `${manifest.name}.backup-${Date.now()}`);
  const stateFile = path.join(workspace, `${manifest.name}.deploy-state.json`);
  await rm(candidate, { recursive: true, force: true });
  await copyDir(source, candidate);
  const validation = await runCommand(manifest.validationCommand, candidate);
  if (!validation.ok) return { deployed: false, rolledBack: false, failure: 'candidate validation failed' };
  const tests = await runCommand(manifest.testCommand, candidate);
  if (!tests.ok) return { deployed: false, rolledBack: false, failure: 'candidate tests failed' };
  const build = manifest.buildCommand ? await runCommand(manifest.buildCommand, candidate) : { ok: true, code: 0 };
  if (!build.ok) return { deployed: false, rolledBack: false, failure: 'candidate build failed' };
  const hadTarget = await pathExists(target);
  if (hadTarget) await rename(target, backup);
  await rename(candidate, target);
  await writeState(stateFile, { backupPath: backup, targetPath: target });
  const health = await runHealthCheck(manifest.healthCheck, target, plugin);
  if (health.ok) return { deployed: true, rolledBack: false, backupPath: backup };
  try {
    await rm(target, { recursive: true, force: true });
    if (await pathExists(backup)) await rename(backup, target);
    const restored = await runHealthCheck(manifest.healthCheck, target, plugin);
    if (!restored.ok) return { deployed: false, rolledBack: true, backupPath: backup, failure: 'health check failed and rollback failed' };
    return { deployed: false, rolledBack: true, backupPath: backup, failure: 'health check failed; rollback succeeded' };
  } catch {
    return { deployed: false, rolledBack: true, backupPath: backup, failure: 'health check failed and rollback failed' };
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

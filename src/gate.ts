import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { AutomationPlugin, FrameworkManifest, GateVerdict } from './types.js';
import { runHealthCheck } from './deployment.js';
import { preflight } from './preflight.js';
import { detectDrift } from './drift.js';

export interface GateStep {
  name: string;
  ok: boolean;
  required: boolean;
  message?: string;
  command?: string;
  cwd?: string;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
}

export interface GateResult {
  verdict: GateVerdict;
  requiredChecks: string[];
  steps: GateStep[];
  deployAllowed: boolean;
}

function parseCommand(command: string) {
  const parts: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of command.matchAll(re)) parts.push(match[1] ?? match[2] ?? match[3]);
  return parts;
}

function runCommand(command: string, cwd: string) {
  const [rawBin, ...args] = parseCommand(command);
  const result = spawnSync(rawBin === 'node' ? process.execPath : rawBin, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  const exitCode = typeof result.status === 'number' ? result.status : result.signal ? 128 : null;
  if (result.error) {
    return {
      ok: false,
      command,
      cwd,
      exitCode,
      stdout,
      stderr,
      message: (result.error as NodeJS.ErrnoException).code === 'ENOENT' ? `missing executable: ${rawBin}` : result.error.message || 'command failed',
    };
  }
  return {
    ok: exitCode === 0,
    command,
    cwd,
    exitCode,
    stdout,
    stderr,
    message: exitCode === 0 ? 'ok' : `exit ${exitCode ?? 1}`,
  };
}

function stateFileFor(manifest: FrameworkManifest, cwd: string) {
  return path.join(path.dirname(path.resolve(cwd, manifest.deployDir)), `${manifest.name}.deploy-state.json`);
}

export async function runGate(manifest: FrameworkManifest, cwd = process.cwd(), plugins: AutomationPlugin[] = []): Promise<GateResult> {
  const required = new Set(manifest.requiredChecks ?? ['validation', 'test']);
  const steps: GateStep[] = [];
  const preflightResult = await preflight(manifest);
  steps.push({ name: 'preflight', ok: preflightResult.ok, required: true, message: preflightResult.checks.filter((c) => !c.ok).map((c) => c.name).join(', ') || 'ok' });

  if (required.has('validation')) {
    const result = runCommand(manifest.validationCommand, path.resolve(cwd, manifest.sourceDir));
    steps.push({ name: 'validation', ok: result.ok, required: true, message: result.message, command: result.command, cwd: result.cwd, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr });
  } else {
    steps.push({ name: 'validation', ok: true, required: false, message: 'not required' });
  }

  if (required.has('test')) {
    const result = runCommand(manifest.testCommand, path.resolve(cwd, manifest.sourceDir));
    steps.push({ name: 'test', ok: result.ok, required: true, message: result.message, command: result.command, cwd: result.cwd, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr });
  } else {
    steps.push({ name: 'test', ok: true, required: false, message: 'not required' });
  }

  if (manifest.buildCommand) {
    const result = runCommand(manifest.buildCommand, path.resolve(cwd, manifest.sourceDir));
    steps.push({ name: 'build', ok: result.ok, required: required.has('build'), message: result.message, command: result.command, cwd: result.cwd, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr });
  }

  const healthDef = manifest.healthCheck ?? manifest.healthChecks?.[0];
  if (healthDef) {
    const health = await runHealthCheck(healthDef, path.resolve(cwd, manifest.deployDir), plugins[0]);
    steps.push({ name: 'health', ok: health.ok, required: required.has('health'), message: health.details });
  } else if (required.has('health')) {
    steps.push({ name: 'health', ok: false, required: true, message: 'missing health check' });
  }

  if (required.has('drift')) {
    try {
      const state = JSON.parse(await readFile(stateFileFor(manifest, cwd), 'utf8')) as { releasePath?: string };
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
  const misconfigured = missingRequired.some((step) => /missing|required|unsupported|not configured/i.test(step.message ?? ''));
  const verdict: GateVerdict = missingRequired.length ? (misconfigured ? 'MISCONFIGURED' : 'FAIL') : 'PASS';
  return { verdict, requiredChecks: [...required], steps, deployAllowed: verdict === 'PASS' };
}

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AutomationPlugin, FrameworkManifest, GateVerdict } from './types.js';
import { runHealthCheck } from './deployment.js';
import { preflight } from './preflight.js';
import { detectDrift } from './drift.js';
import { runBoundedCommand } from './bounded-command.js';

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

function stateFileFor(manifest: FrameworkManifest, cwd: string) {
  return path.join(path.dirname(path.resolve(cwd, manifest.deployDir)), `${manifest.name}.deploy-state.json`);
}

async function runGateCommand(command: string, cwd: string) {
  return runBoundedCommand({ command, cwd, timeoutMs: 300_000, maxOutputBytes: 256 * 1024 });
}

export async function runGate(manifest: FrameworkManifest, cwd = process.cwd(), plugins: AutomationPlugin[] = []): Promise<GateResult> {
  const required = new Set(manifest.requiredChecks ?? ['validation', 'test']);
  const steps: GateStep[] = [];
  const preflightResult = await preflight(manifest, cwd);
  const sourceDir = path.resolve(cwd, manifest.sourceDir);
  steps.push({ name: 'preflight', ok: preflightResult.ok, required: true, message: preflightResult.checks.filter((c) => !c.ok).map((c) => c.name).join(', ') || 'ok' });

  if (required.has('validation')) {
    const result = await runGateCommand(manifest.validationCommand, sourceDir);
    steps.push({ name: 'validation', ok: result.ok, required: true, message: result.message, command: result.command, cwd: result.cwd, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr });
  } else {
    steps.push({ name: 'validation', ok: true, required: false, message: 'not required' });
  }

  if (required.has('test')) {
    const result = await runGateCommand(manifest.testCommand, sourceDir);
    steps.push({ name: 'test', ok: result.ok, required: true, message: result.message, command: result.command, cwd: result.cwd, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr });
  } else {
    steps.push({ name: 'test', ok: true, required: false, message: 'not required' });
  }

  if (manifest.buildCommand) {
    const result = await runGateCommand(manifest.buildCommand, sourceDir);
    steps.push({ name: 'build', ok: result.ok, required: required.has('build'), message: result.message, command: result.command, cwd: result.cwd, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr });
  } else if (required.has('build')) {
    steps.push({ name: 'build', ok: false, required: true, message: 'required build check is not configured' });
  }

  if (required.has('migrate')) {
    if (manifest.migrations?.checkCommand) {
      const result = await runGateCommand(manifest.migrations.checkCommand, sourceDir);
      steps.push({ name: 'migrate', ok: result.ok, required: true, message: result.message, command: result.command, cwd: result.cwd, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr });
    } else {
      steps.push({ name: 'migrate', ok: false, required: true, message: 'required migrate check is not configured' });
    }
  }

  const healthDef = manifest.healthChecks?.length ? manifest.healthChecks : manifest.healthCheck;
  if (healthDef) {
    const health = await runHealthCheck(
      healthDef,
      sourceDir,
      plugins[0],
      manifest.healthCommand || manifest.runtimeHealthCommand,
    );
    steps.push({ name: 'health', ok: health.ok, required: required.has('health'), message: health.details });
  } else if (required.has('health')) {
    steps.push({ name: 'health', ok: false, required: true, message: 'missing health check' });
  }

  if (required.has('drift')) {
    try {
      const statePath = stateFileFor(manifest, cwd);
      const state = JSON.parse(await readFile(statePath, 'utf8')) as { releasePath?: string };
      const liveTarget = path.resolve(cwd, manifest.deployDir);
      const compareTarget = state.releasePath ? state.releasePath : sourceDir;
      const drift = await detectDrift(liveTarget, compareTarget, manifest);
      steps.push({ name: 'drift', ok: !drift.drifted, required: true, message: drift.files.join(', ') || 'clean' });
    } catch {
      steps.push({ name: 'drift', ok: false, required: true, message: 'missing source state' });
    }
  }

  for (const plugin of plugins) {
    try {
      const result = await plugin.validate?.({ projectName: manifest.name, environment: process.env, manifest });
      if (result?.length) steps.push({ name: `plugin:${plugin.name}`, ok: false, required: true, message: result.join(', ') });
    } catch (error) {
      steps.push({ name: `plugin:${plugin.name}`, ok: false, required: true, message: error instanceof Error ? error.message : String(error) });
    }
  }

  const missingRequired = steps.filter((step) => step.required && !step.ok);
  const misconfigured = missingRequired.some((step) => /missing|required|unsupported|not configured/i.test(step.message ?? ''));
  const verdict: GateVerdict = missingRequired.length ? (misconfigured ? 'MISCONFIGURED' : 'FAIL') : 'PASS';
  return { verdict, requiredChecks: [...required], steps, deployAllowed: verdict === 'PASS' };
}

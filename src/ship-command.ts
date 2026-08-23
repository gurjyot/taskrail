import path from 'node:path';
import { findAutomation } from './capabilities.js';
import { loadManifest, resolvePaths } from './config.js';
import { resolveFrameworkManifest } from './framework.js';
import { detectEnvironment } from './env.js';
import { inspectGitState } from './git.js';
import { loadPlugins, rollbackFromState, safeDeploy } from './deployment.js';
import { verifySystemdRuntimeContext } from './systemd.js';

function compact(lines: string[]) {
  console.log(lines.join('\n'));
}

export async function runShipCli(args = process.argv.slice(3)) {
  const first = args[0];
  const target = first && !first.startsWith('--') ? first : undefined;
  const baseCwd = process.cwd();
  const manifestPath = target
    ? await findAutomation(target, baseCwd)
    : path.join(baseCwd, 'automation.json');

  if (!manifestPath) {
    console.error(`automation not found: ${target || ''}`);
    process.exitCode = 1;
    return;
  }

  const raw = await loadManifest(manifestPath);
  const manifest = resolveFrameworkManifest(raw);
  const cwd = path.dirname(manifestPath);
  const environment = detectEnvironment(manifest, cwd);
  const plugins = await loadPlugins(manifest).catch(() => []);
  const plugin = plugins[0];
  const result = await safeDeploy(manifest, plugin, {
    sourceRevision: inspectGitState(cwd).sha,
    projectRoot: cwd,
  });
  const shouldVerifyRuntime = result.deployed
    && environment.name === 'production'
    && process.platform === 'linux'
    && manifest.serviceManager?.type === 'systemd';
  const runtimeChecks = shouldVerifyRuntime
    ? verifySystemdRuntimeContext(manifest, { environment: environment.name })
    : [];
  const runtimeFailures = runtimeChecks.filter((check) => !check.passed);
  let runtimeRollback: { attempted: boolean; ok: boolean; failure?: string; restoredRuntimeReady?: boolean } = { attempted: false, ok: true };

  if (runtimeFailures.length) {
    const paths = resolvePaths(manifest, cwd);
    const stateFile = path.join(path.dirname(paths.deployDir), `${manifest.name}.deploy-state.json`);
    const rollback = await rollbackFromState(stateFile, manifest.healthCheck ?? manifest.healthChecks?.[0], plugin);
    const restoredChecks = rollback.ok ? verifySystemdRuntimeContext(manifest, { environment: environment.name }) : [];
    const restoredRuntimeReady = rollback.ok && restoredChecks.every((check) => check.passed);
    runtimeRollback = { attempted: true, ok: rollback.ok && restoredRuntimeReady, failure: rollback.failure, restoredRuntimeReady };
  }

  const shipped = result.deployed && runtimeFailures.length === 0;

  if (args.includes('--json')) {
    console.log(JSON.stringify({ ...result, runtimeReady: runtimeFailures.length === 0, runtimeChecks, runtimeRollback, shipped }, null, 2));
  } else {
    compact([
      `STATUS: ${shipped ? 'PASS' : 'FAIL'}`,
      `ENV: ${environment.name}`,
      `SHA: ${result.sha || 'unknown'}`,
      `RELEASE: ${result.releaseId || 'unknown'}`,
      ...(shouldVerifyRuntime ? [`RUNTIME: ${runtimeFailures.length ? 'FAIL' : 'PASS'}`] : []),
      ...runtimeFailures.map((check) => `RUNTIME_FAILURE: ${check.unit} user=${check.user} workdir=${check.workingDirectory}${check.unreadableSharedFiles.length ? ` unreadable=${check.unreadableSharedFiles.join(',')}` : ''}`),
      ...(runtimeRollback.attempted ? [`RUNTIME_ROLLBACK: ${runtimeRollback.ok ? 'PASS' : 'FAIL'}`] : []),
      ...(result.failure ? [`FAILURE: ${result.failure}`] : []),
      ...(result.report ? [`REPORT: ${result.report}`] : []),
      `NEXT: ${shipped ? 'done' : runtimeFailures.length ? (runtimeRollback.ok ? 'fix runtime permissions/systemd context before retrying ship' : 'inspect rollback/runtime state before any retry') : 'taskrail explain deploy'}`,
    ]);
  }
  if (!shipped) process.exitCode = 1;
}

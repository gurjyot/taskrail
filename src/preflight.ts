import { access, constants, mkdir, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import type { FrameworkManifest } from './types.js';
import { isCompatible, resolvePaths } from './config.js';
import { TASKRAIL_VERSION } from './version.js';
import { capabilityRootsFor, discoverAutomationManifests, loadCapabilities } from './capabilities.js';
import { detectEnvironment, appliesToEnvironment } from './env.js';
import { readUpdatePause } from './update-pause.js';

export interface PreflightResult {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; message?: string }>;
}

export async function preflight(manifest: FrameworkManifest, cwd = process.cwd()): Promise<PreflightResult> {
  const envInfo = detectEnvironment(manifest, cwd);
  const paths = resolvePaths(manifest, cwd);
  const checks: PreflightResult['checks'] = [];
  const push = (name: string, ok: boolean, message?: string) => checks.push({ name, ok, message });
  const updatePause = await readUpdatePause(manifest, cwd);
  push('update-pause', !updatePause, updatePause ? `${updatePause.reason}${updatePause.targetName ? ` (${updatePause.targetKind}:${updatePause.targetName})` : ''}` : 'not paused');
  push('compatibility', isCompatible(TASKRAIL_VERSION, manifest.taskrailCompatibility));
  push('sourceDir', await stat(paths.sourceDir).then(() => true, () => false));
  if (envInfo.name === 'production') {
    push('deployDir', await stat(paths.deployDir).then(() => true, () => false));
    push('deployWritable', await access(paths.deployDir, constants.W_OK).then(() => true, () => false));
  } else {
    const parent = manifest.deployDir === '.' ? cwd : paths.deployDir;
    await mkdir(parent, { recursive: true }).catch(() => undefined);
    push('deployDir', true, `skipped in ${envInfo.name}`);
  }
  for (const requirement of manifest.requiredSharedFiles ?? []) {
    const item = typeof requirement === 'string' ? { path: requirement } : requirement;
    if (!appliesToEnvironment(item, envInfo.name)) {
      push(`shared:${item.path}`, true, `not required in ${envInfo.name}`);
      continue;
    }
    const mode = item.mode === 'writable' ? constants.W_OK : constants.F_OK;
    push(`shared:${item.path}`, await access(item.path, mode).then(() => true, () => false));
  }
  for (const envName of manifest.requiredEnv ?? []) push(`env:${envName}`, Boolean(process.env[envName]));
  const roots = capabilityRootsFor(manifest, cwd);
  const registry = await loadCapabilities(roots);
  for (const error of registry.errors) push(`capability-registry:${error.name || error.path}`, false, error.conflictingPaths?.length ? `${error.message}: ${error.conflictingPaths.join(', ')}` : error.message);
  for (const capability of manifest.capabilities ?? []) {
    const contract = registry.capabilities.find((item) => item.name === capability);
    push(`capability:${capability}`, Boolean(contract), contract ? 'ok' : 'missing capability');
  }
  if (manifest.runtime === 'node') {
    const nodeCheck = spawnSync(process.execPath, ['--version'], { encoding: 'utf8' });
    const current = nodeCheck.stdout.trim().replace(/^v/, '');
    const requested = manifest.runtimeVersion;
    push('runtime', nodeCheck.status === 0 && (!requested || isCompatible(current, requested)), requested ? `${current} vs ${requested}` : current);
  } else {
    push('runtime', true, manifest.runtime);
  }
  if (manifest.dependencyManager) {
    const lockfile = manifest.dependencyManager.lockfile || (manifest.dependencyManager.tool === 'npm' ? 'package-lock.json' : undefined);
    if (lockfile) push(`lockfile:${lockfile}`, await stat(lockfile).then(() => true, () => false));
  }
  if (envInfo.name === 'production' && manifest.serviceManager?.type === 'systemd') {
    const systemctl = spawnSync('systemctl', ['--version'], { encoding: 'utf8' });
    push('systemd', systemctl.status === 0, systemctl.status === 0 ? 'ok' : 'missing systemctl');
  }
  if (manifest.serviceManager?.units?.length) {
    const timers = manifest.serviceManager.units.filter((unit) => unit.kind === 'timer');
    push('timerCount', timers.length <= 4, `${timers.length}`);
    for (const unit of manifest.serviceManager.units) {
      if (unit.user) push(`unit-user:${unit.name}`, Boolean(unit.user.trim()));
    }
  }
  if (manifest.statePath) {
    const stateDir = path.isAbsolute(manifest.statePath) ? manifest.statePath : path.resolve(cwd, manifest.statePath);
    const parent = path.dirname(stateDir);
    if (envInfo.name === 'production') {
      const ready = await mkdir(parent, { recursive: true }).then(() => true, () => false);
      const writable = ready && await access(parent, constants.W_OK).then(() => true, () => false);
      push(`statePath:${manifest.statePath}`, writable, writable ? 'lazy state ready' : 'state parent not writable');
    } else {
      push(`statePath:${manifest.statePath}`, true, `lazy state allowed in ${envInfo.name}`);
    }
  }
  if (manifest.database?.required) push('database:schema', Boolean(manifest.database.schema), manifest.database.schema || 'missing schema');
  const manifests = await discoverAutomationManifests(cwd).catch(() => []);
  const seenNames = new Map<string, string[]>();
  const seenTargets = new Map<string, string[]>();
  const seenUnits = new Map<string, string[]>();
  for (const manifestPath of manifests) {
    try {
      const current = JSON.parse(await readFile(manifestPath, 'utf8')) as FrameworkManifest;
      const itemName = current.name;
      const itemTarget = current.deployDir;
      seenNames.set(itemName, [...(seenNames.get(itemName) ?? []), manifestPath]);
      seenTargets.set(itemTarget, [...(seenTargets.get(itemTarget) ?? []), manifestPath]);
      for (const unit of current.serviceManager?.units ?? []) seenUnits.set(unit.name, [...(seenUnits.get(unit.name) ?? []), manifestPath]);
    } catch {
      continue;
    }
  }
  push('duplicate:name', (seenNames.get(manifest.name) ?? []).length <= 1, (seenNames.get(manifest.name) ?? []).join(', '));
  push('duplicate:deployDir', (seenTargets.get(manifest.deployDir) ?? []).length <= 1, (seenTargets.get(manifest.deployDir) ?? []).join(', '));
  for (const unit of manifest.serviceManager?.units ?? []) {
    push(`duplicate:unit:${unit.name}`, (seenUnits.get(unit.name) ?? []).length <= 1, (seenUnits.get(unit.name) ?? []).join(', '));
  }
  return { ok: checks.every((check) => check.ok), checks };
}

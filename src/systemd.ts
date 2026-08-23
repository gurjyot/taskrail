import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { FrameworkManifest, TaskrailEnv } from './types.js';
import { appliesToEnvironment } from './env.js';
import { effectiveExecutionPolicy } from './execution.js';
import { systemdResourceDirectives } from './resources.js';

export function managedServiceUnits(manifest: FrameworkManifest) {
  return (manifest.serviceManager?.units ?? []).filter((unit) => unit.kind === 'service').map((unit) => unit.name);
}

export function managedSystemdUnits(manifest: FrameworkManifest) {
  return (manifest.serviceManager?.units ?? []).map((unit) => ({ name: unit.name, kind: unit.kind })).sort((a, b) => a.name.localeCompare(b.name));
}

function quoteSystemdPath(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function systemdIsolationDirectives(manifest: FrameworkManifest): string[] {
  const isolation = manifest.isolation;
  if (isolation?.level !== 'strict') return [];
  const writable = [...new Set([
    ...(manifest.statePath && path.isAbsolute(manifest.statePath) ? [manifest.statePath] : []),
    ...(isolation.writablePaths ?? []).filter((value) => path.isAbsolute(value)),
  ])].sort();
  return [
    'ProtectSystem=strict',
    `ProtectHome=${isolation.protectHome === false ? 'false' : 'true'}`,
    `PrivateTmp=${isolation.privateTmp === false ? 'false' : 'true'}`,
    `NoNewPrivileges=${isolation.noNewPrivileges === false ? 'false' : 'true'}`,
    ...writable.map((value) => `ReadWritePaths=${quoteSystemdPath(value)}`),
  ];
}

export function renderTaskRailDropIn(manifest: FrameworkManifest) {
  const execution = effectiveExecutionPolicy(manifest.execution);
  const resources = systemdResourceDirectives(manifest.resources);
  const lines = [
    '[Service]',
    'ExecStartPre=/usr/bin/env taskrail-heartbeat %N starting',
    'ExecStopPost=/usr/bin/env taskrail-heartbeat %N systemd',
    `TimeoutStartSec=${Math.max(1, Math.ceil(execution.timeoutMs / 1000))}s`,
    ...Object.entries(resources).map(([key, value]) => `${key}=${value}`),
    ...systemdIsolationDirectives(manifest),
  ];
  return `${lines.join('\n')}\n`;
}

export async function installTaskRailDropIn(unit: string, manifest: FrameworkManifest, root = '/etc/systemd/system') {
  if (!unit.endsWith('.service')) throw new Error(`not a service unit: ${unit}`);
  const dir = path.join(root, `${unit}.d`);
  const file = path.join(dir, 'taskrail.conf');
  await mkdir(dir, { recursive: true });
  await writeFile(file, renderTaskRailDropIn(manifest), { mode: 0o644 });
  return file;
}

type SpawnLike = typeof spawnSync;

export interface SystemdRuntimeCheck {
  unit: string;
  user: string;
  group: string;
  workingDirectory: string;
  loadState: string;
  canTraverseWorkingDirectory: boolean;
  readableSharedFiles: string[];
  unreadableSharedFiles: string[];
  passed: boolean;
}

const boundedSpawnOptions = { encoding: 'utf8' as const, timeout: 30_000, maxBuffer: 256 * 1024 };

function systemctlShow(unit: string, property: string, spawn: SpawnLike) {
  const result = spawn('systemctl', ['show', unit, `--property=${property}`, '--value'], boundedSpawnOptions);
  if (result.status !== 0) throw new Error(result.stderr?.trim() || `systemctl show ${unit} ${property} failed`);
  return String(result.stdout ?? '').trim();
}

function asUser(user: string, args: string[], spawn: SpawnLike) {
  if (!user || user === 'root') return spawn(args[0], args.slice(1), boundedSpawnOptions);
  if (typeof process.getuid === 'function' && process.getuid() === 0) return spawn('runuser', ['-u', user, '--', ...args], boundedSpawnOptions);
  return spawn('sudo', ['-n', '-u', user, '--', ...args], boundedSpawnOptions);
}

function sharedFilesForEnvironment(manifest: FrameworkManifest, environment: TaskrailEnv) {
  return (manifest.requiredSharedFiles ?? []).flatMap((entry) => {
    if (typeof entry === 'string') return environment === 'production' ? [entry] : [];
    return appliesToEnvironment(entry, environment) ? [entry.path] : [];
  });
}

export function verifySystemdRuntimeContext(manifest: FrameworkManifest, options: { spawn?: SpawnLike; environment?: TaskrailEnv } = {}): SystemdRuntimeCheck[] {
  if (manifest.serviceManager?.type !== 'systemd') return [];
  const spawn = options.spawn ?? spawnSync;
  const environment = options.environment ?? 'production';
  return managedServiceUnits(manifest).map((unit) => {
    const loadState = systemctlShow(unit, 'LoadState', spawn);
    const user = systemctlShow(unit, 'User', spawn) || 'root';
    const group = systemctlShow(unit, 'Group', spawn) || user;
    const workingDirectory = systemctlShow(unit, 'WorkingDirectory', spawn) || '/';
    const traverse = asUser(user, ['/bin/sh', '-c', 'cd -- "$1"', 'taskrail-runtime-check', workingDirectory], spawn);
    const requiredSharedFiles = sharedFilesForEnvironment(manifest, environment);
    const readableSharedFiles: string[] = [];
    const unreadableSharedFiles: string[] = [];
    for (const file of requiredSharedFiles) {
      const check = asUser(user, ['/usr/bin/test', '-r', file], spawn);
      if (check.status === 0) readableSharedFiles.push(file);
      else unreadableSharedFiles.push(file);
    }
    const canTraverseWorkingDirectory = traverse.status === 0;
    return {
      unit,
      user,
      group,
      workingDirectory,
      loadState,
      canTraverseWorkingDirectory,
      readableSharedFiles,
      unreadableSharedFiles,
      passed: loadState === 'loaded' && canTraverseWorkingDirectory && unreadableSharedFiles.length === 0,
    };
  });
}

export interface SystemdTimerCheck {
  unit: string;
  enabled: boolean;
  active: boolean;
  passed: boolean;
}

export interface SystemdOperationalContext {
  runtimeChecks: SystemdRuntimeCheck[];
  timerChecks: SystemdTimerCheck[];
  passed: boolean;
}

export function verifySystemdOperationalContext(manifest: FrameworkManifest, options: { spawn?: SpawnLike; environment?: TaskrailEnv } = {}): SystemdOperationalContext {
  if (manifest.serviceManager?.type !== 'systemd') return { runtimeChecks: [], timerChecks: [], passed: true };
  const spawn = options.spawn ?? spawnSync;
  const runtimeChecks = verifySystemdRuntimeContext(manifest, options);
  const timerChecks = (manifest.serviceManager.units ?? [])
    .filter((unit) => unit.kind === 'timer')
    .map((unit) => {
      const enabled = spawn('systemctl', ['is-enabled', unit.name], boundedSpawnOptions).status === 0;
      const active = spawn('systemctl', ['is-active', unit.name], boundedSpawnOptions).status === 0;
      return { unit: unit.name, enabled, active, passed: enabled && active };
    });
  return { runtimeChecks, timerChecks, passed: runtimeChecks.every((check) => check.passed) && timerChecks.every((check) => check.passed) };
}

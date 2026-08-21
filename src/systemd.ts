import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FrameworkManifest } from './types.js';
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

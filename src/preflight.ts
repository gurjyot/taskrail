import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import type { FrameworkManifest } from './types.js';
import { isCompatible } from './config.js';
import { TASKRAIL_VERSION } from './version.js';

export interface PreflightResult {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; message?: string }>;
}

export async function preflight(manifest: FrameworkManifest): Promise<PreflightResult> {
  const checks: PreflightResult['checks'] = [];
  const push = (name: string, ok: boolean, message?: string) => checks.push({ name, ok, message });
  push('compatibility', isCompatible(TASKRAIL_VERSION, manifest.taskrailCompatibility));
  push('sourceDir', await stat(manifest.sourceDir).then(() => true, () => false));
  push('deployDir', await stat(manifest.deployDir).then(() => true, () => false));
  push('deployWritable', await access(manifest.deployDir, constants.W_OK).then(() => true, () => false));
  for (const file of manifest.requiredFiles ?? []) push(`file:${file}`, await access(file, constants.F_OK).then(() => true, () => false));
  for (const envName of manifest.requiredEnv ?? []) push(`env:${envName}`, Boolean(process.env[envName]));
  const nodeCheck = spawnSync(process.execPath, ['--version'], { encoding: 'utf8' });
  push('runtime', nodeCheck.status === 0, nodeCheck.stdout.trim());
  return { ok: checks.every((check) => check.ok), checks };
}

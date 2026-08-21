import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FrameworkManifest } from './types.js';
import { resolvePaths } from './config.js';

export interface UpdatePauseRecord {
  schema: 1;
  automation: string;
  reason: string;
  targetKind?: 'component' | 'capability' | 'framework';
  targetName?: string;
  transactionId?: string;
  createdAt: string;
}

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

export function updatePauseFile(manifest: FrameworkManifest, cwd = process.cwd()) {
  const deployDir = resolvePaths(manifest, cwd).deployDir;
  return path.join(path.dirname(deployDir), '.taskrail', 'update-pauses', `${safeName(manifest.name)}.json`);
}

export async function readUpdatePause(manifest: FrameworkManifest, cwd = process.cwd()): Promise<UpdatePauseRecord | null> {
  try {
    return JSON.parse(await readFile(updatePauseFile(manifest, cwd), 'utf8')) as UpdatePauseRecord;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function pauseAutomationUpdates(
  manifest: FrameworkManifest,
  cwd: string,
  input: Omit<UpdatePauseRecord, 'schema' | 'automation' | 'createdAt'>,
) {
  const file = updatePauseFile(manifest, cwd);
  await mkdir(path.dirname(file), { recursive: true });
  const record: UpdatePauseRecord = {
    schema: 1,
    automation: manifest.name,
    ...input,
    createdAt: new Date().toISOString(),
  };
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await rename(temp, file).catch(async (error) => {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  });
  return record;
}

export async function resumeAutomationUpdates(manifest: FrameworkManifest, cwd = process.cwd()) {
  await rm(updatePauseFile(manifest, cwd), { force: true });
}

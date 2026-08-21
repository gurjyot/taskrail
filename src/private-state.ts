import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteText } from './components/fs-safe.js';

const integrityKey = '_taskrailIntegrity';

export interface PrivateStateIntegrity {
  schema: 1;
  algorithm: 'sha256';
  digest: string;
}

function canonical(value: unknown) {
  return JSON.stringify(value);
}

function digest(value: unknown) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

async function ensurePrivateParent(file: string) {
  const dir = path.dirname(path.resolve(file));
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await chmod(dir, 0o700).catch(() => undefined);
}

export async function writePrivateState(file: string, value: Record<string, unknown>) {
  const payload = { ...value } as Record<string, unknown>;
  delete payload[integrityKey];
  const envelope = {
    ...payload,
    [integrityKey]: {
      schema: 1,
      algorithm: 'sha256',
      digest: digest(payload),
    } satisfies PrivateStateIntegrity,
  };
  await ensurePrivateParent(file);
  await atomicWriteText(file, `${JSON.stringify(envelope, null, 2)}\n`, 0o600);
  if (process.platform !== 'win32') await chmod(path.resolve(file), 0o600).catch(() => undefined);
}

export async function readPrivateState<T extends Record<string, unknown>>(
  file: string,
  options: { allowLegacy?: boolean } = {},
): Promise<T | null> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(await readFile(path.resolve(file), 'utf8')) as Record<string, unknown>;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }

  const integrity = parsed[integrityKey] as PrivateStateIntegrity | undefined;
  const payload = { ...parsed };
  delete payload[integrityKey];
  if (!integrity) {
    if (options.allowLegacy === false) throw new Error('private TaskRail state is missing integrity metadata');
    return payload as T;
  }
  if (integrity.schema !== 1 || integrity.algorithm !== 'sha256' || !integrity.digest) {
    throw new Error('private TaskRail state has invalid integrity metadata');
  }
  const actual = digest(payload);
  if (actual !== integrity.digest) throw new Error('private TaskRail state integrity verification failed');
  return payload as T;
}

export async function sealLegacyPrivateState(file: string) {
  const value = await readPrivateState<Record<string, unknown>>(file, { allowLegacy: true });
  if (!value) return false;
  await writePrivateState(file, value);
  return true;
}

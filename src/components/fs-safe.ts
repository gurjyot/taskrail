import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

async function ensureParent(file: string) {
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
}

export async function atomicWriteText(file: string, content: string, mode = 0o600) {
  const target = path.resolve(file);
  await ensureParent(target);
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, content, { mode });
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeJson(file: string, value: unknown, mode = 0o600) {
  await atomicWriteText(file, `${JSON.stringify(value, null, 2)}\n`, mode);
}

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path.resolve(file), 'utf8')) as T;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function appendJsonl(file: string, value: unknown, mode = 0o600) {
  const target = path.resolve(file);
  await ensureParent(target);
  await appendFile(target, `${JSON.stringify(value)}\n`, { mode });
}

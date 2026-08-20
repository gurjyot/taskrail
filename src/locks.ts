import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface LockInfo {
  pid: number;
  host: string;
  startedAt: string;
}

export async function acquireLock(lockDir: string): Promise<{ ok: true; info: LockInfo } | { ok: false; holder?: string }> {
  try {
    await mkdir(path.dirname(lockDir), { recursive: true });
    await mkdir(lockDir);
    const info: LockInfo = { pid: process.pid, host: process.env.HOSTNAME || 'unknown', startedAt: new Date().toISOString() };
    await writeFile(path.join(lockDir, 'lock.json'), JSON.stringify(info, null, 2));
    return { ok: true, info };
  } catch {
    const holder = await readLock(lockDir);
    if (holder && await isStale(holder, lockDir)) {
      await rm(lockDir, { recursive: true, force: true });
      return acquireLock(lockDir);
    }
    return { ok: false, holder: holder ? `${holder.host}:${holder.pid} ${holder.startedAt}` : undefined };
  }
}

export async function releaseLock(lockDir: string) {
  await rm(lockDir, { recursive: true, force: true });
}

export async function readLock(lockDir: string): Promise<LockInfo | null> {
  try {
    return JSON.parse(await readFile(path.join(lockDir, 'lock.json'), 'utf8')) as LockInfo;
  } catch {
    return null;
  }
}

export async function isStale(info: LockInfo, lockDir: string, maxAgeMs = 15 * 60 * 1000) {
  try {
    const st = await stat(path.join(lockDir, 'lock.json'));
    try {
      process.kill(info.pid, 0);
      return Date.now() - st.mtimeMs > maxAgeMs;
    } catch {
      return true;
    }
  } catch {
    return false;
  }
}

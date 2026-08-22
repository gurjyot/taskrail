import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface LockInfo {
  pid: number;
  host: string;
  startedAt: string;
  operation?: string;
  releaseId?: string;
  cwd?: string;
}

function currentHost() {
  return process.env.HOSTNAME || 'unknown';
}

export async function acquireLock(lockDir: string, infoOverride: Partial<LockInfo> = {}): Promise<{ ok: true; info: LockInfo } | { ok: false; holder?: string; info?: LockInfo; stale?: boolean }> {
  try {
    await mkdir(path.dirname(lockDir), { recursive: true });
    await mkdir(lockDir);
    const info: LockInfo = {
      pid: process.pid,
      host: currentHost(),
      startedAt: new Date().toISOString(),
      cwd: process.cwd(),
      ...infoOverride,
    };
    await writeFile(path.join(lockDir, 'lock.json'), JSON.stringify(info, null, 2));
    return { ok: true, info };
  } catch {
    const holder = await readLock(lockDir);
    if (holder && await isStale(holder, lockDir)) {
      await rm(lockDir, { recursive: true, force: true });
      return acquireLock(lockDir, infoOverride);
    }
    return { ok: false, holder: holder ? `${holder.host}:${holder.pid} ${holder.startedAt}` : undefined, info: holder ?? undefined, stale: false };
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
    const ageMs = Date.now() - st.mtimeMs;

    if (info.host !== currentHost()) return ageMs > maxAgeMs;

    try {
      process.kill(info.pid, 0);
      return false;
    } catch {
      return true;
    }
  } catch {
    return false;
  }
}

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export interface DriftResult {
  drifted: boolean;
  files: string[];
}

async function walk(dir: string, base = dir, out: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, base, out);
    else out.push(path.relative(base, full));
  }
  return out;
}

export async function detectDrift(liveDir: string, releaseDir: string): Promise<DriftResult> {
  const liveFiles = new Set(await walk(liveDir));
  const releaseFiles = new Set(await walk(releaseDir));
  const files = new Set([...liveFiles, ...releaseFiles]);
  const drifted: string[] = [];
  for (const file of files) {
    const livePath = path.join(liveDir, file);
    const releasePath = path.join(releaseDir, file);
    const [liveStat, releaseStat] = await Promise.all([stat(livePath).catch(() => null), stat(releasePath).catch(() => null)]);
    if (!liveStat || !releaseStat) { drifted.push(file); continue; }
    if (liveStat.size !== releaseStat.size) { drifted.push(file); continue; }
    const [a, b] = await Promise.all([readFile(livePath, 'utf8').catch(() => ''), readFile(releasePath, 'utf8').catch(() => '')]);
    if (a !== b) drifted.push(file);
  }
  return { drifted: drifted.length > 0, files: drifted };
}

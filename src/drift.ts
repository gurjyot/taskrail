import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export interface DriftResult {
  drifted: boolean;
  files: string[];
}

const ignoredFiles = new Set(['release.json', '.deployment-state.json', 'AGENTS.md', 'automation.json', 'main.js', 'tests-self-test.js']);
const ignoredPrefixes = ['.taskrail/', 'adapters/', 'src/', 'tests/', 'tools/'];

async function walk(dir: string, base = dir, out: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, base, out);
    else {
      const rel = path.relative(base, full).replace(/\\/g, '/');
      if (ignoredFiles.has(entry.name)) continue;
      if (ignoredPrefixes.some((prefix) => rel === prefix.slice(0, -1) || rel.startsWith(prefix))) continue;
      out.push(path.relative(base, full));
    }
  }
  return out;
}

export async function detectDrift(liveDir: string, releaseDir: string): Promise<DriftResult> {
  const liveFiles = new Set(await walk(liveDir));
  const drifted: string[] = [];
  for (const file of liveFiles) {
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

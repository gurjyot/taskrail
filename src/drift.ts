import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { DriftItem, FrameworkManifest } from './types.js';

export interface DriftResult {
  drifted: boolean;
  files: string[];
  items: DriftItem[];
}

const ignoredFiles = new Set(['release.json', '.deployment-state.json']);
const ignoredPrefixes = ['.taskrail/'];
const defaultRuntimePrefixes = ['node_modules/', 'logs/', 'state/', 'cache/', 'tmp/', 'temp/', 'run/', '.cache/', '.npm/'];
const defaultGeneratedPrefixes = ['dist/', 'build/', '.next/'];

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

function normalizePrefix(prefix: string) {
  return prefix.replace(/\\/g, '/').replace(/\/+$/, '');
}

function classifyPath(file: string, manifest?: FrameworkManifest): DriftItem['kind'] {
  const normalized = file.replace(/\\/g, '/');
  const runtimePrefixes = [...defaultRuntimePrefixes, ...((manifest?.runtimePaths ?? []).map(normalizePrefix).map((item) => `${item}/`))];
  const generatedPrefixes = [...defaultGeneratedPrefixes, ...((manifest?.generatedPaths ?? []).map(normalizePrefix).map((item) => `${item}/`))];
  if (runtimePrefixes.some((prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix))) return 'runtime';
  if (generatedPrefixes.some((prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix))) return 'generated';
  return 'source';
}

function ownedPaths(manifest?: FrameworkManifest): string[] | null {
  if (!manifest?.releaseOwnedPaths?.length) return null;
  return manifest.releaseOwnedPaths.map(normalizePrefix);
}

function inOwnedSet(file: string, manifest?: FrameworkManifest): boolean {
  const owned = ownedPaths(manifest);
  if (!owned) return true;
  const normalized = file.replace(/\\/g, '/');
  return owned.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

export async function detectDrift(liveDir: string, releaseDir: string, manifest?: FrameworkManifest): Promise<DriftResult> {
  const liveFiles = new Set(await walk(liveDir));
  const releaseFiles = new Set(await walk(releaseDir));
  const drifted: string[] = [];
  const items: DriftItem[] = [];
  const files = new Set([...liveFiles, ...releaseFiles]);
  for (const file of files) {
    if (!inOwnedSet(file, manifest)) continue;
    const livePath = path.join(liveDir, file);
    const sourcePath = path.join(releaseDir, file);
    const [liveStat, sourceStat] = await Promise.all([stat(livePath).catch(() => null), stat(sourcePath).catch(() => null)]);
    const kind = classifyPath(file, manifest);
    if (!liveStat || !sourceStat) {
      if (kind === 'source') drifted.push(file);
      items.push({ path: file, kind, reason: !liveStat ? 'missing in live' : 'missing in release' });
      continue;
    }
    if (liveStat.size !== sourceStat.size) {
      if (kind === 'source') drifted.push(file);
      items.push({ path: file, kind, reason: 'size differs' });
      continue;
    }
    const [a, b] = await Promise.all([readFile(livePath, 'utf8').catch(() => ''), readFile(sourcePath, 'utf8').catch(() => '')]);
    if (a !== b) {
      if (kind === 'source') drifted.push(file);
      items.push({ path: file, kind, reason: 'content differs' });
    }
  }
  return { drifted: drifted.length > 0, files: drifted, items };
}

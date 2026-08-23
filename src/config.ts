import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FrameworkConfig, FrameworkManifest, RawFrameworkManifest, TaskrailEnv } from './types.js';
import { resolveFrameworkManifest } from './framework.js';

export function taskrailConfigFromManifest(manifest: FrameworkManifest, environment: Record<string, string | undefined> = process.env): FrameworkConfig {
  return { projectName: manifest.name, environment, manifest };
}

export async function loadManifest(manifestPath: string): Promise<RawFrameworkManifest> {
  return JSON.parse(await readFile(manifestPath, 'utf8')) as RawFrameworkManifest;
}

export async function loadResolvedManifest(manifestPath: string): Promise<FrameworkManifest> {
  return resolveFrameworkManifest(await loadManifest(manifestPath));
}

function parseVersion(input: string): [number, number, number] | null {
  const match = String(input).trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(a: string, b: string): number {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  if (!av || !bv) return a.localeCompare(b);
  for (let index = 0; index < 3; index += 1) {
    if (av[index] > bv[index]) return 1;
    if (av[index] < bv[index]) return -1;
  }
  return 0;
}

function evalComparator(current: string, token: string): boolean {
  const trimmed = token.trim();
  if (!trimmed) return true;
  if (trimmed.endsWith('.x')) {
    const prefix = trimmed.replace(/\.x$/, '');
    return current.startsWith(`${prefix}.`);
  }
  const direct = parseVersion(trimmed);
  if (direct) return compareVersions(current, trimmed) === 0;
  const match = trimmed.match(/^(>=|<=|>|<|=)\s*(\d+\.\d+\.\d+)$/);
  if (!match) return false;
  const [, op, version] = match;
  const cmp = compareVersions(current, version);
  if (op === '>=') return cmp >= 0;
  if (op === '<=') return cmp <= 0;
  if (op === '>') return cmp > 0;
  if (op === '<') return cmp < 0;
  return cmp === 0;
}

export function isCompatible(current: string, declared?: string): boolean {
  if (!declared) return true;
  const normalized = declared.trim();
  if (normalized.includes(' ')) return normalized.split(/\s+/).every((token) => evalComparator(current, token));
  return evalComparator(current, normalized);
}

export function isTaskRailCompatible(current: string, declared?: string): boolean {
  if (isCompatible(current, declared)) return true;
  if (!declared) return true;
  const currentVersion = parseVersion(current);
  if (!currentVersion || currentVersion[0] !== 3) return false;
  const normalized = declared.trim();
  if (normalized === '2.0.x') return true;
  const legacyExact = parseVersion(normalized);
  return Boolean(legacyExact && legacyExact[0] === 2 && legacyExact[1] === 0 && /^2\.0\.\d+$/.test(normalized));
}

export function resolvePaths(manifest: FrameworkManifest, cwd = process.cwd()) {
  return {
    sourceDir: path.resolve(cwd, manifest.sourceDir),
    deployDir: path.resolve(cwd, manifest.deployDir),
  };
}

export function normalizeEnvName(value: string | undefined): TaskrailEnv | null {
  const lowered = String(value || '').trim().toLowerCase();
  if (lowered === 'local') return 'local';
  if (lowered === 'ci' || lowered === 'staging') return 'ci';
  if (lowered === 'prod' || lowered === 'production' || lowered === 'vps') return 'production';
  return null;
}

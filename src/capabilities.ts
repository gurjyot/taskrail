import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { CapabilityContract, CapabilityManifest, FrameworkManifest } from './types.js';

export interface ManagedAutomation {
  name: string;
  manifestPath: string;
  runtime: string;
  capabilities: string[];
  status: string;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

async function exists(target: string) {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

function manifestShape(value: any): CapabilityManifest | null {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.name !== 'string' || !value.name.trim()) return null;
  if (typeof value.version !== 'string' || !value.version.trim()) return null;
  if (typeof value.description !== 'string' || !value.description.trim()) return null;
  if (value.runtime !== 'node') return null;
  if (typeof value.canonicalPath !== 'string' || !value.canonicalPath.trim()) return null;
  if (value.requiredSharedFiles && !Array.isArray(value.requiredSharedFiles)) return null;
  if (value.healthCheck && typeof value.healthCheck !== 'object') return null;
  return value as CapabilityManifest;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function capabilityRootsFor(manifest?: FrameworkManifest, cwd = process.cwd()) {
  const roots = unique([
    ...(manifest?.capabilityRoots ?? []),
    ...(process.env.TASKRAIL_CAPABILITY_ROOTS?.split(path.delimiter) ?? []),
    path.join(cwd, 'capabilities'),
  ]);
  return roots.filter((root) => root.trim());
}

export async function discoverCapabilityFiles(roots: string[]) {
  const files: string[] = [];
  for (const root of roots) {
    if (!(await exists(root))) continue;
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = path.join(root, entry.name, 'capability.json');
      if (await stat(file).then(() => true, () => false)) files.push(file);
    }
  }
  return files.sort();
}

export async function loadCapabilities(roots: string[], cwd = process.cwd()): Promise<CapabilityContract[]> {
  const files = await discoverCapabilityFiles(roots);
  const items: CapabilityContract[] = [];
  for (const file of files) {
    const manifest = manifestShape(await readJson<CapabilityManifest>(file));
    if (!manifest) continue;
    const root = path.dirname(path.dirname(file));
    items.push({
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      runtime: manifest.runtime,
      canonicalPath: path.isAbsolute(manifest.canonicalPath) ? manifest.canonicalPath : path.resolve(root, manifest.canonicalPath),
      requiredSharedFiles: manifest.requiredSharedFiles,
      healthCheck: manifest.healthCheck,
      input: manifest.input,
      output: manifest.output,
      root,
      path: file,
      consumers: [],
    });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getCapability(name: string, roots: string[]) {
  return (await loadCapabilities(roots)).find((capability) => capability.name === name) ?? null;
}

export async function discoverAutomationManifests(cwd = process.cwd(), limit = 4): Promise<string[]> {
  const results: string[] = [];
  async function walk(dir: string, depth: number) {
    if (depth > limit) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.taskrail' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.name === 'automation.json') results.push(full);
    }
  }
  await walk(cwd, 0);
  return results.sort();
}

export async function findAutomation(nameOrPath: string, cwd = process.cwd()) {
  const direct = path.isAbsolute(nameOrPath) || nameOrPath.includes(path.sep) ? path.resolve(cwd, nameOrPath) : null;
  if (direct && await stat(direct).then(() => true, () => false)) return direct;
  const manifests = await discoverAutomationManifests(cwd);
  for (const manifestPath of manifests) {
    const manifest = await readJson<FrameworkManifest>(manifestPath);
    if (manifest?.name === nameOrPath) return manifestPath;
  }
  return null;
}

export async function listManagedAutomations(cwd = process.cwd()): Promise<ManagedAutomation[]> {
  const manifests = await discoverAutomationManifests(cwd);
  const items: ManagedAutomation[] = [];
  for (const manifestPath of manifests) {
    const manifest = await readJson<FrameworkManifest>(manifestPath);
    if (!manifest?.managed) continue;
    items.push({
      name: manifest.name,
      manifestPath,
      runtime: manifest.runtime,
      capabilities: unique(manifest.capabilities ?? []),
      status: manifest.capabilities?.length ? 'capability-aware' : 'managed',
    });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

export async function capabilityImpact(name: string, cwd = process.cwd()) {
  const manifests = await discoverAutomationManifests(cwd);
  const consumers: ManagedAutomation[] = [];
  for (const manifestPath of manifests) {
    const manifest = await readJson<FrameworkManifest>(manifestPath);
    if (!manifest?.managed) continue;
    if (!(manifest.capabilities ?? []).includes(name)) continue;
    consumers.push({
      name: manifest.name,
      manifestPath,
      runtime: manifest.runtime,
      capabilities: unique(manifest.capabilities ?? []),
      status: 'managed',
    });
  }
  return consumers.sort((a, b) => a.name.localeCompare(b.name));
}

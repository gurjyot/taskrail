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

export interface CapabilityLoadError {
  name?: string;
  path: string;
  message: string;
  conflictingPaths?: string[];
}

export interface CapabilityLoadResult {
  capabilities: CapabilityContract[];
  errors: CapabilityLoadError[];
}

export interface CapabilityResolutionResult {
  capability?: CapabilityContract;
  error?: CapabilityLoadError;
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
  if (value.input && typeof value.input !== 'string') return null;
  if (value.output && typeof value.output !== 'string') return null;
  return value as CapabilityManifest;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function projectDirForManifest(manifest: FrameworkManifest, cwd = process.cwd()) {
  return path.dirname(path.resolve(cwd, manifest.sourceDir));
}

export function capabilityRootsFor(manifest?: FrameworkManifest, cwd = process.cwd()) {
  const projectDir = manifest ? projectDirForManifest(manifest, cwd) : cwd;
  const roots = unique([
    ...(manifest?.capabilityRoots ?? []),
    ...(process.env.TASKRAIL_CAPABILITY_ROOTS?.split(path.delimiter) ?? []),
    path.join(projectDir, 'capabilities'),
  ]);
  return roots.map((root) => (path.isAbsolute(root) ? path.normalize(root) : path.resolve(projectDir, root)));
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

async function validateCapabilityFile(file: string): Promise<{ manifest?: CapabilityContract; error?: CapabilityLoadError }> {
  const raw = await readJson<CapabilityManifest>(file);
  const manifest = manifestShape(raw);
  if (!manifest) return { error: { path: file, message: 'invalid capability manifest' } };
  const root = path.dirname(file);
  const canonicalPath = path.isAbsolute(manifest.canonicalPath) ? path.normalize(manifest.canonicalPath) : path.resolve(root, manifest.canonicalPath);
  if (!(await stat(canonicalPath).then(() => true, () => false))) return { error: { name: manifest.name, path: file, message: `missing canonical implementation: ${canonicalPath}` } };
  const requiredSharedFiles = manifest.requiredSharedFiles ?? [];
  const missingSharedFiles: string[] = [];
  for (const shared of requiredSharedFiles) {
    const resolved = path.isAbsolute(shared) ? path.normalize(shared) : path.resolve(root, shared);
    if (!(await stat(resolved).then(() => true, () => false))) missingSharedFiles.push(resolved);
  }
  if (missingSharedFiles.length) return { error: { name: manifest.name, path: file, message: `missing required shared files: ${missingSharedFiles.join(', ')}` } };
  return {
    manifest: {
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      runtime: manifest.runtime,
      canonicalPath,
      requiredSharedFiles: manifest.requiredSharedFiles,
      healthCheck: manifest.healthCheck,
      input: manifest.input,
      output: manifest.output,
      root,
      path: file,
      consumers: [],
    },
  };
}

export async function loadCapabilities(roots: string[]): Promise<CapabilityLoadResult> {
  const files = await discoverCapabilityFiles(roots);
  const capabilities: CapabilityContract[] = [];
  const errors: CapabilityLoadError[] = [];
  const byName = new Map<string, CapabilityContract[]>();
  for (const file of files) {
    const result = await validateCapabilityFile(file);
    if (result.error || !result.manifest) {
      if (result.error) errors.push(result.error);
      continue;
    }
    const list = byName.get(result.manifest.name) ?? [];
    list.push(result.manifest);
    byName.set(result.manifest.name, list);
  }
  for (const [name, items] of byName) {
    if (items.length > 1) {
      errors.push({ name, path: items[0].path, message: `duplicate capability name: ${name}`, conflictingPaths: items.map((item) => item.path) });
      continue;
    }
    capabilities.push(items[0]);
  }
  return { capabilities: capabilities.sort((a, b) => a.name.localeCompare(b.name)), errors };
}

export async function resolveCapability(name: string, roots: string[]): Promise<CapabilityResolutionResult> {
  const loaded = await loadCapabilities(roots);
  const duplicate = loaded.errors.find((error) => error.name === name && error.conflictingPaths?.length);
  if (duplicate) return { error: duplicate };
  const capability = loaded.capabilities.find((item) => item.name === name);
  if (!capability) return { error: { name, path: '', message: `capability not found: ${name}` } };
  return { capability };
}

export async function getCapability(name: string, roots: string[]) {
  return (await resolveCapability(name, roots)).capability ?? null;
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


export async function workspaceCapabilityRoots(cwd = process.cwd()) {
  const roots = unique([
    ...(process.env.TASKRAIL_CAPABILITY_ROOTS?.split(path.delimiter) ?? []),
    path.join(cwd, 'capabilities'),
  ]);
  return roots.map((root) => (path.isAbsolute(root) ? path.normalize(root) : path.resolve(cwd, root)));
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

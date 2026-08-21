import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FrameworkManifest } from './types.js';
import { discoverAutomationManifests } from './capabilities.js';
import { resolveFrameworkManifest } from './framework.js';
import { resolvePaths } from './config.js';

export type IsolationRootKind = 'deploy' | 'state';

export interface IsolationRoot {
  automation: string;
  manifestPath: string;
  kind: IsolationRootKind;
  path: string;
}

export interface IsolationConflict {
  left: IsolationRoot;
  right: IsolationRoot;
  reason: 'same-root' | 'nested-root';
}

export interface IsolationAudit {
  ok: boolean;
  roots: IsolationRoot[];
  conflicts: IsolationConflict[];
  errors: string[];
}

async function readManifest(file: string): Promise<FrameworkManifest | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as FrameworkManifest;
  } catch {
    return null;
  }
}

function contains(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function conflictReason(left: string, right: string): IsolationConflict['reason'] | null {
  const a = path.resolve(left);
  const b = path.resolve(right);
  if (a === b) return 'same-root';
  if (contains(a, b) || contains(b, a)) return 'nested-root';
  return null;
}

export async function auditFleetIsolation(cwd = process.cwd()): Promise<IsolationAudit> {
  const manifestPaths = await discoverAutomationManifests(cwd);
  const roots: IsolationRoot[] = [];
  const errors: string[] = [];
  const seenAutomations = new Set<string>();

  for (const manifestPath of manifestPaths) {
    const raw = await readManifest(manifestPath);
    if (!raw?.managed || seenAutomations.has(raw.name)) continue;
    seenAutomations.add(raw.name);
    try {
      const resolved = resolveFrameworkManifest(raw);
      const projectRoot = path.dirname(manifestPath);
      const paths = resolvePaths(resolved, projectRoot);
      roots.push({ automation: resolved.name, manifestPath, kind: 'deploy', path: path.resolve(paths.deployDir) });
      if (resolved.statePath) {
        const state = path.isAbsolute(resolved.statePath) ? resolved.statePath : path.resolve(projectRoot, resolved.statePath);
        roots.push({ automation: resolved.name, manifestPath, kind: 'state', path: path.resolve(state) });
      }
    } catch (error) {
      errors.push(`${raw.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const conflicts: IsolationConflict[] = [];
  for (let leftIndex = 0; leftIndex < roots.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < roots.length; rightIndex += 1) {
      const left = roots[leftIndex];
      const right = roots[rightIndex];
      if (left.automation === right.automation) continue;
      const reason = conflictReason(left.path, right.path);
      if (reason) conflicts.push({ left, right, reason });
    }
  }

  roots.sort((a, b) => `${a.automation}:${a.kind}`.localeCompare(`${b.automation}:${b.kind}`));
  conflicts.sort((a, b) => `${a.left.automation}:${a.right.automation}:${a.left.kind}:${a.right.kind}`.localeCompare(`${b.left.automation}:${b.right.automation}:${b.left.kind}:${b.right.kind}`));
  errors.sort();
  return { ok: conflicts.length === 0 && errors.length === 0, roots, conflicts, errors };
}

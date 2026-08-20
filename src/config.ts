import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FrameworkConfig, FrameworkManifest } from './types.js';

export function taskrailConfigFromManifest(manifest: FrameworkManifest, environment: Record<string, string | undefined> = process.env): FrameworkConfig {
  return { projectName: manifest.name, environment, manifest };
}

export async function loadManifest(manifestPath: string): Promise<FrameworkManifest> {
  return JSON.parse(await readFile(manifestPath, 'utf8')) as FrameworkManifest;
}

export function isCompatible(current: string, declared?: string): boolean {
  if (!declared) return true;
  if (declared.endsWith('.x')) {
    const [major, minor] = declared.replace('.x', '').split('.');
    const [curMajor, curMinor] = current.split('.');
    return major === curMajor && minor === curMinor;
  }
  return current === declared;
}

export function resolvePaths(manifest: FrameworkManifest) {
  return {
    sourceDir: path.resolve(manifest.sourceDir),
    deployDir: path.resolve(manifest.deployDir),
  };
}

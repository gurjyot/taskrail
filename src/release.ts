import { cp, mkdir, readFile, rm, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { TASKRAIL_VERSION } from './version.js';
import type { FrameworkManifest, ReleaseMeta } from './types.js';

export function releaseId(manifest: FrameworkManifest, sourceRevision?: string) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return [ts, manifest.name, TASKRAIL_VERSION, sourceRevision || 'nogit'].join('__');
}

export async function createRelease(manifest: FrameworkManifest, sourceDir: string, releasesDir: string, sourceRevision?: string): Promise<ReleaseMeta> {
  const id = releaseId(manifest, sourceRevision);
  const releasePath = path.join(releasesDir, id);
  await mkdir(releasePath, { recursive: true });
  await cp(sourceDir, releasePath, { recursive: true, preserveTimestamps: true });
  const meta: ReleaseMeta = { releaseId: id, project: manifest.name, taskrailVersion: TASKRAIL_VERSION, sourceRevision, createdAt: new Date().toISOString(), path: releasePath };
  await writeFile(path.join(releasePath, 'release.json'), JSON.stringify(meta, null, 2));
  return meta;
}

export async function readRelease(metaPath: string): Promise<ReleaseMeta | null> {
  try {
    return JSON.parse(await readFile(metaPath, 'utf8')) as ReleaseMeta;
  } catch {
    return null;
  }
}

export async function listReleases(releasesDir: string) {
  try {
    return await readdir(releasesDir);
  } catch {
    return [];
  }
}

export async function restoreRelease(releasePath: string, targetPath: string) {
  await rm(targetPath, { recursive: true, force: true });
  await cp(releasePath, targetPath, { recursive: true, preserveTimestamps: true });
}

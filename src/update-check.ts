import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TASKRAIL_VERSION } from './version.js';
import { compareVersions } from './config.js';

export interface BuildIdentity { version: string; revision: string | null }
export interface UpdateStatus {
  schema: 1;
  checkedAt: string;
  status: 'ok' | 'unknown';
  installed: BuildIdentity;
  latestVersion: string | null;
  sourceRevision: string | null;
  releaseAvailable: boolean;
  sourceChangesAvailable: boolean;
  detail?: string;
}

export async function installedBuild(): Promise<BuildIdentity> {
  try {
    const info = JSON.parse(await readFile(fileURLToPath(new URL('./build-info.json', import.meta.url)), 'utf8'));
    return { version: TASKRAIL_VERSION, revision: /^[a-f0-9]{40}$/.test(info.revision) ? info.revision : null };
  } catch {
    return { version: TASKRAIL_VERSION, revision: null };
  }
}

export async function checkUpdates({ installed, fetchImpl = fetch, now = new Date(), timeoutMs = 10_000 }: {
  installed: BuildIdentity; fetchImpl?: typeof fetch; now?: Date; timeoutMs?: number;
}): Promise<UpdateStatus> {
  const result: UpdateStatus = {
    schema: 1, checkedAt: now.toISOString(), status: 'unknown', installed,
    latestVersion: null, sourceRevision: null, releaseAvailable: false, sourceChangesAvailable: false,
  };
  const signal = AbortSignal.timeout(timeoutMs);
  async function get(endpoint: string) {
    const response = await fetchImpl(`https://api.github.com/repos/gurjyot/taskrail/${endpoint}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'TaskRail-update-check' },
      signal, redirect: 'error',
    });
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > 1_000_000) throw new Error('GitHub response exceeds limit');
    return JSON.parse(text);
  }
  try {
    const release = await get('releases/latest');
    const latest = String(release.tag_name ?? '').replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+$/.test(latest) || release.draft || release.prerelease) throw new Error('Invalid stable release');
    result.latestVersion = latest;
    result.releaseAvailable = compareVersions(installed.version, latest) < 0;
    const main = await get('commits/main');
    if (!/^[a-f0-9]{40}$/.test(main.sha)) throw new Error('Invalid source revision');
    result.sourceRevision = main.sha;
    const base = installed.revision || `v${latest}`;
    if (base !== main.sha) {
      const comparison = await get(`compare/${encodeURIComponent(base)}...${main.sha}?per_page=1`);
      if (!['ahead', 'behind', 'identical', 'diverged'].includes(comparison.status)) throw new Error('Invalid comparison');
      result.sourceChangesAvailable = comparison.status === 'ahead' || comparison.status === 'diverged';
    }
    result.status = 'ok';
  } catch {
    // Do not persist remote error bodies or potentially sensitive transport errors.
    result.detail = 'GitHub update status unavailable; retry check-updates.';
  }
  return result;
}

function cacheFile() {
  return process.env.TASKRAIL_UPDATE_STATUS_FILE || path.join(process.env.TASKRAIL_HOME || path.join(homedir(), '.taskrail'), 'update-status.json');
}

export async function readUpdateStatus(): Promise<UpdateStatus | null> {
  try {
    const value = JSON.parse(await readFile(cacheFile(), 'utf8'));
    if (value.schema !== 1 || !['ok', 'unknown'].includes(value.status) || !Number.isFinite(Date.parse(value.checkedAt))) return null;
    if (value.latestVersion !== null && !/^\d+\.\d+\.\d+$/.test(value.latestVersion)) return null;
    if (!/^\d+\.\d+\.\d+$/.test(value.installed?.version) || typeof value.releaseAvailable !== 'boolean' || typeof value.sourceChangesAvailable !== 'boolean') return null;
    if (value.installed.revision !== null && !/^[a-f0-9]{40}$/.test(value.installed.revision)) return null;
    if (value.sourceRevision !== null && !/^[a-f0-9]{40}$/.test(value.sourceRevision)) return null;
    return value;
  } catch { return null; }
}

export async function printUpdateNotice() {
  if (process.env.TASKRAIL_UPDATE_NOTICES === '0') return;
  const status = await readUpdateStatus();
  if (!status) return;
  const age = Date.now() - Date.parse(status.checkedAt);
  if (status.status !== 'ok' || age > 48 * 60 * 60 * 1000 || age < 0) {
    console.error('TaskRail update status unknown or stale. Run taskrail check-updates.');
    return;
  }
  if (status.latestVersion && compareVersions(TASKRAIL_VERSION, status.latestVersion) < 0) {
    console.error(`TaskRail ${status.latestVersion} available (installed ${TASKRAIL_VERSION}). Review https://github.com/gurjyot/taskrail/releases/latest`);
  }
  const build = await installedBuild();
  if (status.installed.version !== build.version || status.installed.revision !== build.revision) {
    console.error('TaskRail installed build changed. Run taskrail check-updates.');
    return;
  }
  if (status.sourceChangesAvailable && status.sourceRevision !== build.revision) {
    console.error('TaskRail GitHub main has newer source changes. Run taskrail check-updates; review and certify before deployment.');
  }
}

export async function runUpdateCheck() {
  const status = await checkUpdates({ installed: await installedBuild() });
  const file = cacheFile();
  try {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, file);
  } catch {
    console.error('TaskRail update check completed; cache could not be saved. Check cache-directory permissions.');
    process.exitCode = 1;
  }
  console.log(JSON.stringify(status, null, 2));
  if (status.status === 'unknown') process.exitCode = 1;
}

import path from 'node:path';
import type { EnvironmentInfo, FrameworkManifest, TaskrailEnv } from './types.js';

function normalize(value: string | undefined): TaskrailEnv | null {
  const lowered = String(value || '').trim().toLowerCase();
  if (lowered === 'local') return 'local';
  if (lowered === 'ci' || lowered === 'staging') return 'ci';
  if (lowered === 'prod' || lowered === 'production' || lowered === 'vps') return 'production';
  return null;
}

export function detectEnvironment(manifest: FrameworkManifest, cwd = process.cwd(), env = process.env): EnvironmentInfo {
  const explicit = normalize(env.TASKRAIL_ENV || env.SMG_ENV || env.NODE_ENV);
  if (explicit) {
    return { name: explicit, overridden: true, reason: `override:${explicit}` };
  }

  if (env.CI === 'true' || env.GITHUB_ACTIONS === 'true' || env.BUILD_NUMBER) {
    return { name: 'ci', overridden: false, reason: 'ci env marker' };
  }

  const deployDir = path.resolve(cwd, manifest.deployDir);
  const sourceDir = path.resolve(cwd, manifest.sourceDir);
  const looksProduction = deployDir.startsWith('/opt/') || sourceDir.startsWith('/opt/');
  if (looksProduction) return { name: 'production', overridden: false, reason: 'production path or service manager' };

  return { name: 'local', overridden: false, reason: 'default local' };
}

export function appliesToEnvironment(rule: { environments?: TaskrailEnv[] } | undefined, env: TaskrailEnv): boolean {
  if (!rule?.environments?.length) return env === 'production';
  return rule.environments.includes(env);
}

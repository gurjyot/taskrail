import path from 'node:path';
import { discoverAutomationManifests, findAutomation } from './capabilities.js';
import { loadManifest } from './config.js';
import { resolveFrameworkManifest } from './framework.js';
import type { SharedUpdatePlan } from './update-plan.js';
import { pauseAutomationUpdates, readUpdatePause, resumeAutomationUpdates } from './update-pause.js';

export interface SharedPauseResult {
  ok: boolean;
  paused: string[];
  resumed: string[];
  errors: string[];
}

export async function pauseSharedUpdateConsumers(root: string, plan: SharedUpdatePlan, transactionId?: string): Promise<SharedPauseResult> {
  const result: SharedPauseResult = { ok: true, paused: [], resumed: [], errors: [] };
  if (plan.action === 'blocked') return { ...result, ok: false, errors: [...plan.reasons] };
  if (!plan.pauseRequired) return result;

  for (const automation of plan.pauseScope) {
    const manifestPath = await findAutomation(automation, root);
    if (!manifestPath) {
      result.errors.push(`automation not found: ${automation}`);
      continue;
    }
    const cwd = path.dirname(manifestPath);
    const manifest = resolveFrameworkManifest(await loadManifest(manifestPath));
    await pauseAutomationUpdates(manifest, cwd, {
      reason: `breaking ${plan.targetKind} update requires dependent automation migration`,
      targetKind: plan.targetKind,
      targetName: plan.targetName,
      transactionId,
    });
    result.paused.push(manifest.name);
  }
  result.paused.sort();
  result.ok = result.errors.length === 0;
  return result;
}

export async function resumeSharedUpdateConsumers(root: string, targetKind: 'component' | 'capability', targetName: string): Promise<SharedPauseResult> {
  const result: SharedPauseResult = { ok: true, paused: [], resumed: [], errors: [] };
  const manifestPaths = await discoverAutomationManifests(root);
  for (const manifestPath of manifestPaths) {
    try {
      const cwd = path.dirname(manifestPath);
      const manifest = resolveFrameworkManifest(await loadManifest(manifestPath));
      const pause = await readUpdatePause(manifest, cwd);
      if (pause?.targetKind !== targetKind || pause.targetName !== targetName) continue;
      await resumeAutomationUpdates(manifest, cwd);
      result.resumed.push(manifest.name);
    } catch (error) {
      result.errors.push(`${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  result.resumed.sort();
  result.ok = result.errors.length === 0;
  return result;
}

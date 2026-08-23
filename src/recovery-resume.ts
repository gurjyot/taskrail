import { cp, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AutomationPlugin, DeployState, FrameworkManifest } from './types.js';
import { resolvePaths } from './config.js';
import { runHealthCheck } from './deployment.js';
import { readUpdateCheckpoint, transitionUpdate, type UpdateCheckpoint } from './update-transaction.js';
import { recordRecoveryReadiness, validateLastKnownGoodRecovery } from './recovery-readiness.js';
import { readPrivateState, writePrivateState } from './private-state.js';

export interface RecoveryResumeResult {
  ok: boolean;
  action: 'none' | 'aborted-pre-activation' | 'restored' | 'recovery-required';
  reason?: string;
  checkpoint?: UpdateCheckpoint;
}

function stateFile(manifest: FrameworkManifest, cwd: string) {
  const target = resolvePaths(manifest, cwd).deployDir;
  return path.join(path.dirname(target), `${manifest.name}.deploy-state.json`);
}

async function readState(manifest: FrameworkManifest, cwd: string): Promise<DeployState | null> {
  return readPrivateState<DeployState & Record<string, unknown>>(stateFile(manifest, cwd), { allowLegacy: true });
}

async function exists(target: string) {
  return stat(target).then(() => true, () => false);
}

async function writeRecoveredState(manifest: FrameworkManifest, cwd: string, checkpoint: UpdateCheckpoint) {
  const target = resolvePaths(manifest, cwd).deployDir;
  const state: DeployState = {
    targetPath: target,
    releasePath: checkpoint.lastKnownGoodReleasePath,
    currentReleaseId: checkpoint.lastKnownGoodRelease,
    lastKnownGoodReleasePath: checkpoint.lastKnownGoodReleasePath,
    lastKnownGoodReleaseId: checkpoint.lastKnownGoodRelease,
  };
  await writePrivateState(stateFile(manifest, cwd), state as DeployState & Record<string, unknown>);
}

function declaredHealth(manifest: FrameworkManifest) {
  return manifest.healthChecks?.length ? manifest.healthChecks : manifest.healthCheck;
}

async function restoreRelease(manifest: FrameworkManifest, cwd: string, checkpoint: UpdateCheckpoint, plugin?: AutomationPlugin) {
  const source = checkpoint.lastKnownGoodReleasePath!;
  const target = resolvePaths(manifest, cwd).deployDir;
  const token = randomUUID();
  const candidate = `${target}.taskrail-recovery-${token}`;
  const quarantine = `${target}.taskrail-failed-${token}`;
  await rm(candidate, { recursive: true, force: true });
  await cp(source, candidate, { recursive: true, force: false });

  const offline = await runHealthCheck(
    declaredHealth(manifest),
    candidate,
    plugin,
    manifest.healthCommand || manifest.runtimeHealthCommand,
  );
  if (!offline.ok) {
    await rm(candidate, { recursive: true, force: true });
    throw new Error(`recovery candidate health failed: ${offline.details || 'unknown'}`);
  }

  let quarantined = false;
  try {
    if (await exists(target)) {
      await rename(target, quarantine);
      quarantined = true;
    }
    await rename(candidate, target);
    const restored = await runHealthCheck(
      declaredHealth(manifest),
      target,
      plugin,
      manifest.healthCommand || manifest.runtimeHealthCommand,
    );
    if (!restored.ok) throw new Error(`restored release health failed: ${restored.details || 'unknown'}`);
    await writeRecoveredState(manifest, cwd, checkpoint);
    if (quarantined) await rm(quarantine, { recursive: true, force: true });
  } catch (error) {
    await rm(candidate, { recursive: true, force: true }).catch(() => undefined);
    if (await exists(target)) await rm(target, { recursive: true, force: true }).catch(() => undefined);
    if (quarantined && await exists(quarantine)) await rename(quarantine, target).catch(() => undefined);
    throw error;
  }
}

export async function recoverInterruptedAutomation(
  manifest: FrameworkManifest,
  cwd = process.cwd(),
  plugin?: AutomationPlugin,
  migrationCompatible = !manifest.migrations,
): Promise<RecoveryResumeResult> {
  let checkpoint = await readUpdateCheckpoint(cwd, 'automation', manifest.name);
  if (!checkpoint) return { ok: true, action: 'none' };
  if (['committed', 'aborted'].includes(checkpoint.phase)) {
    return { ok: true, action: 'none', checkpoint };
  }
  if (!checkpoint.lastKnownGoodRelease || !checkpoint.lastKnownGoodReleasePath) {
    if (checkpoint.phase !== 'recovery-required') {
      checkpoint = await transitionUpdate(cwd, 'automation', manifest.name, 'recovery-required', 'checkpoint lacks immutable last-known-good recovery path');
    }
    return { ok: false, action: 'recovery-required', reason: 'last-known-good recovery path is missing', checkpoint };
  }

  let currentState: DeployState | null;
  try {
    currentState = await readState(manifest, cwd);
    if (currentState) await writePrivateState(stateFile(manifest, cwd), currentState as DeployState & Record<string, unknown>);
  } catch (error) {
    if (checkpoint.phase !== 'recovery-required') {
      checkpoint = await transitionUpdate(cwd, 'automation', manifest.name, 'recovery-required', 'deployment state integrity could not be verified');
    }
    return {
      ok: false,
      action: 'recovery-required',
      reason: `deployment state cannot be trusted: ${error instanceof Error ? error.message : String(error)}`,
      checkpoint,
    };
  }

  const preActivationPhases = new Set(['discovered', 'impact-checked', 'checkpointed', 'staged', 'validated', 'simulated', 'rollback-ready']);
  if (preActivationPhases.has(checkpoint.phase) && currentState?.currentReleaseId === checkpoint.lastKnownGoodRelease) {
    const health = await runHealthCheck(
      declaredHealth(manifest),
      resolvePaths(manifest, cwd).deployDir,
      plugin,
      manifest.healthCommand || manifest.runtimeHealthCommand,
    );
    if (health.ok) {
      checkpoint = await transitionUpdate(cwd, 'automation', manifest.name, 'aborted', 'recovery confirmed no activation occurred; existing last-known-good remains healthy');
      return { ok: true, action: 'aborted-pre-activation', checkpoint };
    }
  }

  if (checkpoint.phase !== 'recovery-required' && checkpoint.phase !== 'rollback-required' && checkpoint.phase !== 'rollback-validated') {
    checkpoint = await transitionUpdate(cwd, 'automation', manifest.name, 'recovery-required', 'interrupted transaction requires explicit last-known-good restore');
  }
  if (checkpoint.phase === 'recovery-required') {
    checkpoint = await transitionUpdate(cwd, 'automation', manifest.name, 'rollback-required', 'recovery resumed from durable checkpoint');
  }

  if (checkpoint.phase === 'rollback-required') {
    const recoveryState: DeployState = {
      targetPath: resolvePaths(manifest, cwd).deployDir,
      lastKnownGoodReleaseId: checkpoint.lastKnownGoodRelease,
      lastKnownGoodReleasePath: checkpoint.lastKnownGoodReleasePath,
    };
    const readiness = await validateLastKnownGoodRecovery({
      state: recoveryState,
      health: declaredHealth(manifest),
      configurationHealth: declaredHealth(manifest),
      plugin,
      migrationCompatible,
    });
    if (!readiness.ok) {
      checkpoint = await transitionUpdate(cwd, 'automation', manifest.name, 'recovery-required', `recovery readiness failed: ${readiness.reasons.join('; ')}`);
      return { ok: false, action: 'recovery-required', reason: readiness.reasons.join('; '), checkpoint };
    }
    checkpoint = await recordRecoveryReadiness(cwd, checkpoint, readiness);
  }

  try {
    await restoreRelease(manifest, cwd, checkpoint, plugin);
    checkpoint = await transitionUpdate(cwd, 'automation', manifest.name, 'restored', 'immutable last-known-good release restored and health verified');
    checkpoint = await transitionUpdate(cwd, 'automation', manifest.name, 'committed', 'recovery transaction committed', {
      currentRelease: checkpoint.lastKnownGoodRelease,
      currentReleasePath: checkpoint.lastKnownGoodReleasePath,
    });
    return { ok: true, action: 'restored', checkpoint };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const fallback = checkpoint;
    try {
      checkpoint = await transitionUpdate(cwd, 'automation', manifest.name, 'recovery-required', `recovery restore failed: ${reason}`);
    } catch {
      checkpoint = fallback;
    }
    return { ok: false, action: 'recovery-required', reason, checkpoint };
  }
}

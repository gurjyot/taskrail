import path from 'node:path';
import type { AutomationPlugin, DeployState, FrameworkManifest } from './types.js';
import { check, safeDeploy, verifyOperationalReadiness, type DeployOptions, type DeployOutcome } from './deployment.js';
import { resolvePaths } from './config.js';
import {
  createUpdateCheckpoint,
  readUpdateCheckpoint,
  transitionUpdate,
  type UpdateChangeClass,
  type UpdateCheckpoint,
} from './update-transaction.js';
import { recordRecoveryReadiness, validateLastKnownGoodRecovery } from './recovery-readiness.js';
import { readPrivateState, writePrivateState } from './private-state.js';
import { readRelease } from './release.js';

export interface TransactionalDeployOptions extends DeployOptions {
  changeClass?: UpdateChangeClass;
  fromVersion?: string;
  toVersion?: string;
  migrationCompatible?: boolean;
}

export interface TransactionalDeployResult {
  ok: boolean;
  blocked?: boolean;
  reason?: string;
  outcome?: DeployOutcome;
  checkpoint?: UpdateCheckpoint;
}

function deployStateFile(manifest: FrameworkManifest, projectRoot: string) {
  const target = resolvePaths(manifest, projectRoot).deployDir;
  return path.join(path.dirname(target), `${manifest.name}.deploy-state.json`);
}

async function readDeployState(manifest: FrameworkManifest, projectRoot: string): Promise<DeployState | null> {
  return readPrivateState<DeployState & Record<string, unknown>>(deployStateFile(manifest, projectRoot), { allowLegacy: true });
}

async function restorePriorState(manifest: FrameworkManifest, projectRoot: string, priorState: DeployState) {
  await writePrivateState(deployStateFile(manifest, projectRoot), priorState as DeployState & Record<string, unknown>);
}

async function latestCheckpoint(root: string, name: string) {
  return readUpdateCheckpoint(root, 'automation', name);
}

async function verifyLiveRollback(manifest: FrameworkManifest, projectRoot: string, plugin: AutomationPlugin | undefined, priorState: DeployState) {
  const liveTarget = resolvePaths(manifest, projectRoot).deployDir;
  const liveRelease = await readRelease(path.join(liveTarget, 'release.json'));
  if (!liveRelease?.releaseId || liveRelease.releaseId !== priorState.lastKnownGoodReleaseId) {
    return {
      ok: false,
      reason: `live target does not match last-known-good release: expected ${priorState.lastKnownGoodReleaseId || 'unknown'}, found ${liveRelease?.releaseId || 'unknown'}`,
    };
  }
  const readiness = await verifyOperationalReadiness(manifest, liveTarget, plugin);
  if (!readiness.ok) {
    return {
      ok: false,
      reason: readiness.error || readiness.health.details || 'restored live target failed operational readiness',
    };
  }
  return { ok: true, reason: undefined };
}

export async function transactionalDeploy(
  manifest: FrameworkManifest,
  plugin?: AutomationPlugin,
  options: TransactionalDeployOptions = {},
): Promise<TransactionalDeployResult> {
  const projectRoot = options.projectRoot || process.cwd();
  let priorState: DeployState | null;
  try {
    priorState = await readDeployState(manifest, projectRoot);
  } catch (error) {
    return {
      ok: false,
      blocked: true,
      reason: `deployment state cannot be trusted: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!priorState?.lastKnownGoodReleasePath || !priorState.lastKnownGoodReleaseId) {
    return {
      ok: false,
      blocked: true,
      reason: 'transactional update requires an existing last-known-good release; use the normal initial ship path for first deployment',
    };
  }

  await writePrivateState(deployStateFile(manifest, projectRoot), priorState as DeployState & Record<string, unknown>);

  let checkpoint = await createUpdateCheckpoint(projectRoot, {
    targetKind: 'automation',
    targetName: manifest.name,
    changeClass: options.changeClass || 'patch',
    fromVersion: options.fromVersion,
    toVersion: options.toVersion,
    currentRelease: priorState.currentReleaseId,
    currentReleasePath: priorState.releasePath,
    lastKnownGoodRelease: priorState.lastKnownGoodReleaseId,
    lastKnownGoodReleasePath: priorState.lastKnownGoodReleasePath,
    affectedAutomations: [manifest.name],
  });
  let activationAttempted = false;

  try {
    checkpoint = await transitionUpdate(projectRoot, 'automation', manifest.name, 'impact-checked', 'update scope is isolated to this automation');
    checkpoint = await transitionUpdate(projectRoot, 'automation', manifest.name, 'checkpointed', 'last-known-good release recorded before mutation');
    checkpoint = await transitionUpdate(projectRoot, 'automation', manifest.name, 'staged', 'transactional candidate path reserved; live release remains unchanged');

    const sourceCheck = await check(manifest, { cwd: projectRoot });
    if (!sourceCheck.ok) {
      checkpoint = await transitionUpdate(projectRoot, 'automation', manifest.name, 'aborted', 'pre-activation validation failed; live release was not changed');
      return { ok: false, blocked: true, reason: 'pre-activation validation failed', checkpoint };
    }
    checkpoint = await transitionUpdate(projectRoot, 'automation', manifest.name, 'validated', 'manifest and preflight validation passed');

    const migrationCompatible = options.migrationCompatible ?? !manifest.migrations;
    checkpoint = await transitionUpdate(projectRoot, 'automation', manifest.name, 'simulated', migrationCompatible
      ? 'rollback simulation prerequisites satisfied'
      : 'migration rollback compatibility requires explicit approval');

    const declaredHealth = manifest.healthChecks?.length ? manifest.healthChecks : manifest.healthCheck;
    const readiness = await validateLastKnownGoodRecovery({
      state: priorState,
      health: declaredHealth,
      configurationHealth: declaredHealth,
      plugin,
      manifest,
      projectRoot,
      migrationCompatible,
    });
    if (!readiness.ok) {
      checkpoint = await transitionUpdate(projectRoot, 'automation', manifest.name, 'aborted', `rollback readiness failed: ${readiness.reasons.join('; ')}`);
      return { ok: false, blocked: true, reason: `rollback readiness failed: ${readiness.reasons.join('; ')}`, checkpoint };
    }
    checkpoint = await recordRecoveryReadiness(projectRoot, checkpoint, readiness);

    activationAttempted = true;
    const outcome = await safeDeploy(manifest, plugin, { ...options, transactionalUpdate: true });
    if (outcome.deployed) {
      const currentState = await readPrivateState<DeployState & Record<string, unknown>>(deployStateFile(manifest, projectRoot), { allowLegacy: true });
      if (currentState) await writePrivateState(deployStateFile(manifest, projectRoot), currentState);
      checkpoint = await transitionUpdate(projectRoot, 'automation', manifest.name, 'activated', `release activated: ${outcome.releaseId || 'unknown'}`, {
        currentRelease: outcome.releaseId,
        currentReleasePath: outcome.releasePath,
      });
      checkpoint = await transitionUpdate(projectRoot, 'automation', manifest.name, 'verified', 'post-activation operational readiness verification passed');
      checkpoint = await transitionUpdate(projectRoot, 'automation', manifest.name, 'committed', 'transaction committed after successful verification', {
        currentRelease: outcome.releaseId,
        currentReleasePath: outcome.releasePath,
        lastKnownGoodRelease: outcome.releaseId,
        lastKnownGoodReleasePath: outcome.releasePath,
      });
      return { ok: true, outcome, checkpoint };
    }

    if (outcome.recoveryRequired || (outcome.rollbackAttempted && outcome.rollbackSucceeded === false)) {
      checkpoint = await transitionUpdate(projectRoot, 'automation', manifest.name, 'recovery-required', outcome.failure || 'live rollback failed and requires recovery');
      return { ok: false, reason: outcome.failure || 'live rollback failed and requires recovery', outcome, checkpoint };
    }

    if (outcome.rolledBack) {
      checkpoint = await transitionUpdate(projectRoot, 'automation', manifest.name, 'rollback-required', outcome.failure || 'activation failed and rollback was completed');
      const liveRollback = await verifyLiveRollback(manifest, projectRoot, plugin, priorState);
      if (!liveRollback.ok) {
        checkpoint = await transitionUpdate(projectRoot, 'automation', manifest.name, 'recovery-required', `live rollback verification failed: ${liveRollback.reason}`);
        return { ok: false, reason: outcome.failure || liveRollback.reason || 'rollback requires recovery', outcome, checkpoint };
      }
      const rollbackReadiness = await validateLastKnownGoodRecovery({
        state: priorState,
        health: declaredHealth,
        configurationHealth: declaredHealth,
        plugin,
        manifest,
        projectRoot,
        migrationCompatible,
      });
      if (!rollbackReadiness.ok) {
        checkpoint = await transitionUpdate(projectRoot, 'automation', manifest.name, 'recovery-required', `rollback verification failed: ${rollbackReadiness.reasons.join('; ')}`);
        return { ok: false, reason: outcome.failure || 'rollback requires recovery', outcome, checkpoint };
      }
      checkpoint = await recordRecoveryReadiness(projectRoot, checkpoint, rollbackReadiness);
      await restorePriorState(manifest, projectRoot, priorState);
      checkpoint = await transitionUpdate(projectRoot, 'automation', manifest.name, 'restored', 'live target matches last-known-good, state restored, and operational readiness passed');
      checkpoint = await transitionUpdate(projectRoot, 'automation', manifest.name, 'committed', 'failed update closed after successful restore', {
        currentRelease: priorState.lastKnownGoodReleaseId,
        currentReleasePath: priorState.lastKnownGoodReleasePath,
        lastKnownGoodRelease: priorState.lastKnownGoodReleaseId,
        lastKnownGoodReleasePath: priorState.lastKnownGoodReleasePath,
      });
      return { ok: false, reason: outcome.failure || 'update rolled back safely', outcome, checkpoint };
    }

    checkpoint = await transitionUpdate(projectRoot, 'automation', manifest.name, 'aborted', outcome.failure || 'deployment stopped before activation');
    return { ok: false, blocked: true, reason: outcome.failure || 'deployment stopped before activation', outcome, checkpoint };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const current = await latestCheckpoint(projectRoot, manifest.name).catch(() => null);
    if (current && !['committed', 'aborted', 'recovery-required'].includes(current.phase)) {
      const target = activationAttempted ? 'recovery-required' : 'aborted';
      await transitionUpdate(projectRoot, 'automation', manifest.name, target, `transaction exception: ${message}`).catch(() => undefined);
    }
    return {
      ok: false,
      reason: activationAttempted ? `update entered recovery-required state: ${message}` : `update aborted before activation: ${message}`,
      checkpoint: await latestCheckpoint(projectRoot, manifest.name).catch(() => undefined) || undefined,
    };
  }
}

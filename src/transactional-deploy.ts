import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AutomationPlugin, DeployState, FrameworkManifest } from './types.js';
import { check, safeDeploy, type DeployOptions, type DeployOutcome } from './deployment.js';
import { resolvePaths } from './config.js';
import {
  createUpdateCheckpoint,
  readUpdateCheckpoint,
  transitionUpdate,
  type UpdateChangeClass,
  type UpdateCheckpoint,
} from './update-transaction.js';
import { recordRecoveryReadiness, validateLastKnownGoodRecovery } from './recovery-readiness.js';

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

async function readDeployState(manifest: FrameworkManifest, projectRoot: string): Promise<DeployState | null> {
  const target = resolvePaths(manifest, projectRoot).deployDir;
  const file = path.join(path.dirname(target), `${manifest.name}.deploy-state.json`);
  try {
    return JSON.parse(await readFile(file, 'utf8')) as DeployState;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function latestCheckpoint(root: string, name: string) {
  return readUpdateCheckpoint(root, 'automation', name);
}

export async function transactionalDeploy(
  manifest: FrameworkManifest,
  plugin?: AutomationPlugin,
  options: TransactionalDeployOptions = {},
): Promise<TransactionalDeployResult> {
  const projectRoot = options.projectRoot || process.cwd();
  const priorState = await readDeployState(manifest, projectRoot);
  if (!priorState?.lastKnownGoodReleasePath || !priorState.lastKnownGoodReleaseId) {
    return {
      ok: false,
      blocked: true,
      reason: 'transactional update requires an existing last-known-good release; use the normal initial ship path for first deployment',
    };
  }

  let checkpoint = await createUpdateCheckpoint(projectRoot, {
    targetKind: 'automation',
    targetName: manifest.name,
    changeClass: options.changeClass || 'patch',
    fromVersion: options.fromVersion,
    toVersion: options.toVersion,
    currentRelease: priorState.currentReleaseId,
    lastKnownGoodRelease: priorState.lastKnownGoodReleaseId,
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

    const readiness = await validateLastKnownGoodRecovery({
      state: priorState,
      health: manifest.healthCheck ?? manifest.healthChecks?.[0],
      configurationHealth: manifest.healthCheck ?? manifest.healthChecks?.[0],
      plugin,
      migrationCompatible,
    });
    if (!readiness.ok) {
      checkpoint = await transitionUpdate(projectRoot, 'automation', manifest.name, 'aborted', `rollback readiness failed: ${readiness.reasons.join('; ')}`);
      return { ok: false, blocked: true, reason: `rollback readiness failed: ${readiness.reasons.join('; ')}`, checkpoint };
    }
    checkpoint = await recordRecoveryReadiness(projectRoot, checkpoint, readiness);

    activationAttempted = true;
    const outcome = await safeDeploy(manifest, plugin, options);
    if (outcome.deployed) {
      checkpoint = await transitionUpdate(projectRoot, 'automation', manifest.name, 'activated', `release activated: ${outcome.releaseId || 'unknown'}`, {
        currentRelease: outcome.releaseId,
      });
      checkpoint = await transitionUpdate(projectRoot, 'automation', manifest.name, 'verified', 'post-activation TaskRail health verification passed');
      checkpoint = await transitionUpdate(projectRoot, 'automation', manifest.name, 'committed', 'transaction committed after successful verification', {
        currentRelease: outcome.releaseId,
        lastKnownGoodRelease: outcome.releaseId,
      });
      return { ok: true, outcome, checkpoint };
    }

    if (outcome.rolledBack) {
      checkpoint = await transitionUpdate(projectRoot, 'automation', manifest.name, 'rollback-required', outcome.failure || 'activation failed and rollback was attempted');
      const rollbackReadiness = await validateLastKnownGoodRecovery({
        state: priorState,
        health: manifest.healthCheck ?? manifest.healthChecks?.[0],
        configurationHealth: manifest.healthCheck ?? manifest.healthChecks?.[0],
        plugin,
        migrationCompatible,
      });
      if (!rollbackReadiness.ok) {
        checkpoint = await transitionUpdate(projectRoot, 'automation', manifest.name, 'recovery-required', `rollback verification failed: ${rollbackReadiness.reasons.join('; ')}`);
        return { ok: false, reason: outcome.failure || 'rollback requires recovery', outcome, checkpoint };
      }
      checkpoint = await recordRecoveryReadiness(projectRoot, checkpoint, rollbackReadiness);
      checkpoint = await transitionUpdate(projectRoot, 'automation', manifest.name, 'restored', 'last-known-good release restored and reverified');
      checkpoint = await transitionUpdate(projectRoot, 'automation', manifest.name, 'committed', 'failed update closed after successful restore', {
        currentRelease: priorState.lastKnownGoodReleaseId,
        lastKnownGoodRelease: priorState.lastKnownGoodReleaseId,
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
      if (current.phase !== 'activated' || target === 'recovery-required') {
        await transitionUpdate(projectRoot, 'automation', manifest.name, target, `transaction exception: ${message}`).catch(() => undefined);
      }
    }
    return {
      ok: false,
      reason: activationAttempted ? `update entered recovery-required state: ${message}` : `update aborted before activation: ${message}`,
      checkpoint: await latestCheckpoint(projectRoot, manifest.name).catch(() => undefined) || undefined,
    };
  }
}

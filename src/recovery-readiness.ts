import { stat } from 'node:fs/promises';
import type { AutomationPlugin, DeployState, HealthCheckDefinition } from './types.js';
import { runHealthCheck } from './deployment.js';
import { transitionUpdate, type UpdateCheckpoint } from './update-transaction.js';

export interface RecoveryReadinessResult {
  ok: boolean;
  releaseExists: boolean;
  healthVerified: boolean;
  configurationVerified: boolean;
  migrationCompatible: boolean;
  releasePath?: string;
  reasons: string[];
}

export async function validateLastKnownGoodRecovery(input: {
  state: DeployState | null;
  health?: HealthCheckDefinition | HealthCheckDefinition[];
  configurationHealth?: HealthCheckDefinition | HealthCheckDefinition[];
  plugin?: AutomationPlugin;
  migrationCompatible: boolean;
}): Promise<RecoveryReadinessResult> {
  const releasePath = input.state?.lastKnownGoodReleasePath;
  const reasons: string[] = [];
  if (!releasePath) {
    return {
      ok: false,
      releaseExists: false,
      healthVerified: false,
      configurationVerified: false,
      migrationCompatible: input.migrationCompatible,
      reasons: ['last-known-good release path is missing'],
    };
  }

  const releaseExists = await stat(releasePath).then((value) => value.isDirectory(), () => false);
  if (!releaseExists) reasons.push('last-known-good release does not exist');

  let healthVerified = false;
  let configurationVerified = false;
  if (releaseExists) {
    const health = await runHealthCheck(input.health, releasePath, input.plugin);
    healthVerified = health.ok;
    if (!healthVerified) reasons.push(`last-known-good health probe failed${health.details ? `: ${health.details}` : ''}`);

    if (input.configurationHealth) {
      const config = await runHealthCheck(input.configurationHealth, releasePath, input.plugin);
      configurationVerified = config.ok;
      if (!configurationVerified) reasons.push(`last-known-good configuration probe failed${config.details ? `: ${config.details}` : ''}`);
    } else {
      configurationVerified = healthVerified;
    }
  }

  if (!input.migrationCompatible) reasons.push('migration rollback compatibility is not verified');
  return {
    ok: releaseExists && healthVerified && configurationVerified && input.migrationCompatible,
    releaseExists,
    healthVerified,
    configurationVerified,
    migrationCompatible: input.migrationCompatible,
    releasePath,
    reasons,
  };
}

export async function recordRecoveryReadiness(
  root: string,
  checkpoint: UpdateCheckpoint,
  readiness: RecoveryReadinessResult,
) {
  if (!readiness.ok) throw new Error(`recovery readiness failed: ${readiness.reasons.join('; ')}`);
  const patch = {
    recovery: {
      previousReleaseVerified: readiness.releaseExists && readiness.healthVerified,
      configurationVerified: readiness.configurationVerified,
      migrationCompatible: readiness.migrationCompatible,
      details: `verified ${readiness.releasePath}`,
    },
  };
  if (checkpoint.phase === 'simulated') {
    return transitionUpdate(root, checkpoint.targetKind, checkpoint.targetName, 'rollback-ready', 'rollback path prevalidated before activation', patch);
  }
  if (checkpoint.phase === 'rollback-required') {
    return transitionUpdate(root, checkpoint.targetKind, checkpoint.targetName, 'rollback-validated', 'rollback path revalidated after failure', patch);
  }
  throw new Error(`recovery readiness cannot be recorded during phase: ${checkpoint.phase}`);
}

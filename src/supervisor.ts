import { stat } from 'node:fs/promises';
import { heartbeatIsFresh, mapConcurrent, readHeartbeat } from './execution.js';

export type SupervisionStatus = 'healthy' | 'failed' | 'stale' | 'missing';

export interface SupervisionTarget {
  name: string;
  stateDir: string;
  staleAfterMs: number;
}

export interface SupervisionResult {
  name: string;
  status: SupervisionStatus;
  executionId?: string;
  updatedAt?: string;
  details?: string;
}

export async function inspectTarget(target: SupervisionTarget, now = Date.now()): Promise<SupervisionResult> {
  let heartbeat;
  try {
    heartbeat = await readHeartbeat(target.stateDir);
  } catch (error) {
    return {
      name: target.name,
      status: 'failed',
      details: `heartbeat unreadable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!heartbeat) {
    const stateExists = await stat(target.stateDir).then(() => true, () => false);
    return {
      name: target.name,
      status: 'missing',
      details: stateExists ? 'heartbeat missing' : 'state directory missing',
    };
  }
  if (heartbeat.status === 'failed') {
    return {
      name: target.name,
      status: 'failed',
      executionId: heartbeat.executionId,
      updatedAt: heartbeat.updatedAt,
      details: heartbeat.details,
    };
  }
  if (!heartbeatIsFresh(heartbeat, target.staleAfterMs, now)) {
    return {
      name: target.name,
      status: 'stale',
      executionId: heartbeat.executionId,
      updatedAt: heartbeat.updatedAt,
      details: heartbeat.details ?? 'heartbeat stale',
    };
  }
  return {
    name: target.name,
    status: 'healthy',
    executionId: heartbeat.executionId,
    updatedAt: heartbeat.updatedAt,
    details: heartbeat.details,
  };
}

export async function inspectTargets(targets: readonly SupervisionTarget[], concurrency = 16, now = Date.now()) {
  return await mapConcurrent(targets, concurrency, (target) => inspectTarget(target, now));
}

export function unhealthyTargets(results: readonly SupervisionResult[]) {
  return results.filter((result) => result.status !== 'healthy');
}

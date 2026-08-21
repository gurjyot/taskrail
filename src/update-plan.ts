import type { CompatibilityAssessment } from './compatibility-contract.js';
import type { UsageGraph } from './usage-graph.js';
import { usageImpact } from './usage-graph.js';
import type { UpdateChangeClass, UpdateTargetKind } from './update-transaction.js';

export interface SharedUpdatePlan {
  targetKind: Extract<UpdateTargetKind, 'component' | 'capability'>;
  targetName: string;
  fromVersion?: string;
  toVersion?: string;
  changeClass: UpdateChangeClass;
  exists: boolean;
  affectedAutomations: string[];
  affectedCount: number;
  pauseRequired: boolean;
  pauseScope: string[];
  action: 'safe-to-stage' | 'migration-required' | 'blocked';
  reasons: string[];
}

function numericVersion(value: string | undefined) {
  if (!value) return null;
  const match = value.trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)] as const;
}

export function classifyVersionChange(fromVersion?: string, toVersion?: string, explicitBreaking = false): UpdateChangeClass {
  if (explicitBreaking) return 'breaking';
  const from = numericVersion(fromVersion);
  const to = numericVersion(toVersion);
  if (!from || !to) return 'minor';
  if (to[0] !== from[0]) return 'breaking';
  if (to[1] !== from[1]) return 'minor';
  return 'patch';
}

export function planSharedUpdate(
  graph: UsageGraph,
  input: {
    targetKind: 'component' | 'capability';
    targetName: string;
    fromVersion?: string;
    toVersion?: string;
    breaking?: boolean;
    compatibility?: CompatibilityAssessment;
  },
): SharedUpdatePlan {
  const impact = usageImpact(graph, input.targetKind, input.targetName);
  const compatibilityBreaking = Boolean(input.compatibility?.breaking || input.compatibility?.affected.length);
  const changeClass = classifyVersionChange(input.fromVersion, input.toVersion, Boolean(input.breaking || compatibilityBreaking));
  const reasons: string[] = [];

  if (!impact.exists) reasons.push(`${input.targetKind} is not present in the current usage graph`);
  if (graph.errors.length) reasons.push(`usage graph has ${graph.errors.length} error(s); blast radius is not trustworthy`);
  if (input.compatibility?.errors.length) reasons.push(`compatibility contract has ${input.compatibility.errors.length} error(s)`);
  if (input.compatibility?.affected.length) reasons.push(`compatibility contract requires migration for ${input.compatibility.affected.length} consumer(s)`);
  if (changeClass === 'breaking' && impact.count > 0) reasons.push(`breaking change affects ${impact.count} automation(s)`);
  if (changeClass === 'patch') reasons.push('patch change may proceed without pausing consumers after compatibility checks');
  if (changeClass === 'minor') reasons.push('additive/minor change may proceed without pausing consumers after compatibility checks');

  const blocked = !impact.exists || graph.errors.length > 0 || Boolean(input.compatibility?.errors.length);
  const pauseRequired = !blocked && changeClass === 'breaking' && impact.count > 0;
  return {
    targetKind: input.targetKind,
    targetName: input.targetName,
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
    changeClass,
    exists: impact.exists,
    affectedAutomations: impact.transitiveAutomationConsumers,
    affectedCount: impact.count,
    pauseRequired,
    pauseScope: pauseRequired ? impact.transitiveAutomationConsumers : [],
    action: blocked ? 'blocked' : pauseRequired ? 'migration-required' : 'safe-to-stage',
    reasons,
  };
}

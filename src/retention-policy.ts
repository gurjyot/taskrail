export interface RetentionRecord {
  id: string;
  kind: 'health' | 'reconciliation' | 'diagnostic' | 'deployment' | 'failure' | 'audit';
  createdAt: string;
  important?: boolean;
}

export interface RetentionPolicy {
  healthDays: number;
  reconciliationDays: number;
  diagnosticDays: number;
  auditDays: number;
  preserveDeploymentHistory: boolean;
  preserveFailures: boolean;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = Object.freeze({
  healthDays: 7,
  reconciliationDays: 7,
  diagnosticDays: 30,
  auditDays: 30,
  preserveDeploymentHistory: true,
  preserveFailures: true,
});

function maxAgeDays(kind: RetentionRecord['kind'], policy: RetentionPolicy) {
  if (kind === 'health') return policy.healthDays;
  if (kind === 'reconciliation') return policy.reconciliationDays;
  if (kind === 'diagnostic') return policy.diagnosticDays;
  if (kind === 'audit') return policy.auditDays;
  return Infinity;
}

export function retentionDecision(record: RetentionRecord, now = new Date(), policy: RetentionPolicy = DEFAULT_RETENTION_POLICY) {
  if (record.important) return { retain: true, reason: 'record explicitly marked important' };
  if (record.kind === 'deployment' && policy.preserveDeploymentHistory) return { retain: true, reason: 'deployment history preserved by policy' };
  if (record.kind === 'failure' && policy.preserveFailures) return { retain: true, reason: 'failure record preserved by policy' };
  const ageMs = now.getTime() - Date.parse(record.createdAt);
  const limit = maxAgeDays(record.kind, policy);
  if (!Number.isFinite(ageMs) || ageMs < 0) return { retain: true, reason: 'invalid or future timestamp fails safe' };
  return ageMs <= limit * 86_400_000
    ? { retain: true, reason: 'inside retention window' }
    : { retain: false, reason: `older than ${limit} day retention window` };
}

export function planRetention(records: RetentionRecord[], now = new Date(), policy: RetentionPolicy = DEFAULT_RETENTION_POLICY) {
  const retain: RetentionRecord[] = [];
  const prune: RetentionRecord[] = [];
  for (const record of records) (retentionDecision(record, now, policy).retain ? retain : prune).push(record);
  return { retain, prune };
}

import { appendJsonl } from './components/fs-safe.js';

export interface ExecutionGuardPolicy {
  maxSteps: number;
  maxElapsedMs: number;
  maxRepeatedFingerprint: number;
  maxConsecutiveFailures: number;
}

export const DEFAULT_EXECUTION_GUARD_POLICY: ExecutionGuardPolicy = Object.freeze({
  maxSteps: 10_000,
  maxElapsedMs: 300_000,
  maxRepeatedFingerprint: 25,
  maxConsecutiveFailures: 10,
});

export type ExecutionGuardReason = 'max-steps' | 'max-elapsed' | 'repeated-state' | 'consecutive-failures';

export interface ExecutionGuardObservation {
  fingerprint?: string;
  ok?: boolean;
  at?: number;
}

export interface ExecutionGuardTrip {
  tripped: true;
  reason: ExecutionGuardReason;
  message: string;
  steps: number;
  elapsedMs: number;
  repeatedFingerprint?: string;
  repeatedCount?: number;
  consecutiveFailures: number;
}

export interface ExecutionGuardStatus {
  tripped: false;
  steps: number;
  elapsedMs: number;
  consecutiveFailures: number;
}

function validPositiveInt(value: number, name: string) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
}

export function validateExecutionGuardPolicy(policy: ExecutionGuardPolicy) {
  validPositiveInt(policy.maxSteps, 'maxSteps');
  validPositiveInt(policy.maxElapsedMs, 'maxElapsedMs');
  validPositiveInt(policy.maxRepeatedFingerprint, 'maxRepeatedFingerprint');
  validPositiveInt(policy.maxConsecutiveFailures, 'maxConsecutiveFailures');
  return policy;
}

export class RunawayExecutionGuard {
  private readonly startedAt: number;
  private steps = 0;
  private consecutiveFailures = 0;
  private readonly fingerprints = new Map<string, number>();
  private trip?: ExecutionGuardTrip;

  constructor(
    readonly policy: ExecutionGuardPolicy = DEFAULT_EXECUTION_GUARD_POLICY,
    startedAt = Date.now(),
  ) {
    validateExecutionGuardPolicy(policy);
    this.startedAt = startedAt;
  }

  observe(observation: ExecutionGuardObservation = {}): ExecutionGuardStatus | ExecutionGuardTrip {
    if (this.trip) return this.trip;
    const now = observation.at ?? Date.now();
    const elapsedMs = Math.max(0, now - this.startedAt);
    this.steps += 1;
    this.consecutiveFailures = observation.ok === false ? this.consecutiveFailures + 1 : 0;

    if (this.steps > this.policy.maxSteps) return this.setTrip('max-steps', `execution exceeded ${this.policy.maxSteps} steps`, elapsedMs);
    if (elapsedMs > this.policy.maxElapsedMs) return this.setTrip('max-elapsed', `execution exceeded ${this.policy.maxElapsedMs}ms`, elapsedMs);

    if (observation.fingerprint) {
      const count = (this.fingerprints.get(observation.fingerprint) ?? 0) + 1;
      this.fingerprints.set(observation.fingerprint, count);
      if (count > this.policy.maxRepeatedFingerprint) {
        return this.setTrip('repeated-state', `execution repeated the same state more than ${this.policy.maxRepeatedFingerprint} times`, elapsedMs, observation.fingerprint, count);
      }
    }

    if (this.consecutiveFailures > this.policy.maxConsecutiveFailures) {
      return this.setTrip('consecutive-failures', `execution exceeded ${this.policy.maxConsecutiveFailures} consecutive failures`, elapsedMs);
    }

    return { tripped: false, steps: this.steps, elapsedMs, consecutiveFailures: this.consecutiveFailures };
  }

  status(at = Date.now()): ExecutionGuardStatus | ExecutionGuardTrip {
    if (this.trip) return this.trip;
    return { tripped: false, steps: this.steps, elapsedMs: Math.max(0, at - this.startedAt), consecutiveFailures: this.consecutiveFailures };
  }

  private setTrip(reason: ExecutionGuardReason, message: string, elapsedMs: number, repeatedFingerprint?: string, repeatedCount?: number): ExecutionGuardTrip {
    this.trip = {
      tripped: true,
      reason,
      message,
      steps: this.steps,
      elapsedMs,
      repeatedFingerprint,
      repeatedCount,
      consecutiveFailures: this.consecutiveFailures,
    };
    return this.trip;
  }
}

export interface GuardrailJournalRecord {
  schema: 1;
  at: string;
  automation: string;
  executionId?: string;
  event: 'execution-guardrail-tripped';
  reason: ExecutionGuardReason;
  steps: number;
  elapsedMs: number;
  repeatedCount?: number;
  consecutiveFailures: number;
}

export async function journalExecutionGuardTrip(file: string, input: { automation: string; executionId?: string; trip: ExecutionGuardTrip; at?: Date }) {
  const record: GuardrailJournalRecord = {
    schema: 1,
    at: (input.at ?? new Date()).toISOString(),
    automation: input.automation,
    executionId: input.executionId,
    event: 'execution-guardrail-tripped',
    reason: input.trip.reason,
    steps: input.trip.steps,
    elapsedMs: input.trip.elapsedMs,
    repeatedCount: input.trip.repeatedCount,
    consecutiveFailures: input.trip.consecutiveFailures,
  };
  await appendJsonl(file, record, 0o600);
  return record;
}

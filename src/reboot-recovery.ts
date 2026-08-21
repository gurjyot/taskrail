export type MissedRunPolicy = 'run-on-recovery' | 'skip' | 'manual';

export interface RebootAutomationState {
  name: string;
  enabled: boolean;
  managed: boolean;
  healthyBeforeShutdown?: boolean;
  missedRuns?: number;
  missedRunPolicy?: MissedRunPolicy;
}

export interface RebootAction {
  automation: string;
  action: 'start' | 'catch-up' | 'skip-missed' | 'manual-review' | 'ignore';
  reason: string;
}

export function planRebootRecovery(automations: RebootAutomationState[]): RebootAction[] {
  return [...automations]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((automation) => {
      if (!automation.managed || !automation.enabled) return { automation: automation.name, action: 'ignore', reason: 'automation is unmanaged or disabled' };
      const missed = Math.max(0, automation.missedRuns ?? 0);
      if (missed > 0) {
        const policy = automation.missedRunPolicy ?? 'run-on-recovery';
        if (policy === 'run-on-recovery') return { automation: automation.name, action: 'catch-up', reason: `${missed} run(s) missed while host was unavailable` };
        if (policy === 'skip') return { automation: automation.name, action: 'skip-missed', reason: `${missed} missed run(s) intentionally skipped by policy` };
        return { automation: automation.name, action: 'manual-review', reason: `${missed} missed run(s) require operator review` };
      }
      return { automation: automation.name, action: 'start', reason: 'managed enabled automation should be reconciled after boot' };
    });
}

export function rebootRecoverySafe(actions: RebootAction[]) {
  return actions.every((action) => action.action !== 'manual-review');
}

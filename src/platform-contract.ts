import { withTimeout } from './execution.js';

export const TASKRAIL_PLATFORM_API_VERSION = '1' as const;

export type PlatformRole = 'viewer' | 'operator' | 'admin';
export type PlatformAutomationState = 'running' | 'stopped' | 'paused' | 'failed' | 'unknown';
export type PlatformHealth = 'healthy' | 'degraded' | 'failed' | 'unknown';
export type PlatformNotificationSeverity = 'info' | 'warning' | 'error' | 'critical';
export type PlatformNotificationStatus = 'open' | 'acknowledged' | 'resolved';

export interface PlatformTestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  failedIds: string[];
}

export interface PlatformAutomationSummary {
  id: string;
  category?: string;
  state: PlatformAutomationState;
  health: PlatformHealth;
  tests: PlatformTestSummary;
}

export interface PlatformSnapshot {
  apiVersion: typeof TASKRAIL_PLATFORM_API_VERSION;
  generatedAt: string;
  counts: {
    automations: number;
    components: number;
    capabilities: number;
    running: number;
    stopped: number;
    paused: number;
    failed: number;
  };
  automations: PlatformAutomationSummary[];
  components: string[];
  capabilities: string[];
}

export interface PlatformNotification {
  id: string;
  createdAt: string;
  severity: PlatformNotificationSeverity;
  status: PlatformNotificationStatus;
  title: string;
  message: string;
  automation?: string;
  fingerprint?: string;
}

export type PlatformEventKind =
  | 'automation.state'
  | 'automation.health'
  | 'tests.completed'
  | 'guardrail.tripped'
  | 'security.failed'
  | 'deployment.changed'
  | 'notification.created'
  | 'notification.updated';

export interface PlatformEvent {
  apiVersion: typeof TASKRAIL_PLATFORM_API_VERSION;
  id: string;
  at: string;
  kind: PlatformEventKind;
  automation?: string;
  data: Readonly<Record<string, unknown>>;
}

export type PlatformCommandName =
  | 'automation.start'
  | 'automation.stop'
  | 'automation.pause'
  | 'automation.resume'
  | 'automation.run'
  | 'scheduler.enable'
  | 'scheduler.disable'
  | 'notification.acknowledge'
  | 'notification.resolve';

export interface PlatformCommandIntent {
  command: PlatformCommandName;
  target: string;
}

export interface ResolvedPlatformCommand {
  command: PlatformCommandName;
  target: string;
  minimumRole: PlatformRole;
  risk: 'write' | 'control';
}

export interface PlatformCommandContext {
  role: PlatformRole;
  actor?: string;
  requestId?: string;
}

export interface PlatformCommandResult {
  ok: boolean;
  command: PlatformCommandName;
  target: string;
  message?: string;
}

export type PlatformCommandExecutor = (
  command: Readonly<ResolvedPlatformCommand>,
  context: Readonly<PlatformCommandContext>,
) => Promise<PlatformCommandResult> | PlatformCommandResult;

const SAFE_TARGET = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/;
const ROLE_RANK: Record<PlatformRole, number> = { viewer: 0, operator: 1, admin: 2 };

const COMMANDS: Record<PlatformCommandName, Omit<ResolvedPlatformCommand, 'command' | 'target'>> = {
  'automation.start': { minimumRole: 'operator', risk: 'control' },
  'automation.stop': { minimumRole: 'operator', risk: 'control' },
  'automation.pause': { minimumRole: 'operator', risk: 'control' },
  'automation.resume': { minimumRole: 'operator', risk: 'control' },
  'automation.run': { minimumRole: 'operator', risk: 'control' },
  'scheduler.enable': { minimumRole: 'admin', risk: 'control' },
  'scheduler.disable': { minimumRole: 'admin', risk: 'control' },
  'notification.acknowledge': { minimumRole: 'operator', risk: 'write' },
  'notification.resolve': { minimumRole: 'operator', risk: 'write' },
};

export function platformCommandDefinitions() {
  return Object.entries(COMMANDS).map(([command, definition]) => ({ command: command as PlatformCommandName, ...definition }));
}

export function authorizePlatformCommand(role: PlatformRole, command: PlatformCommandName) {
  return ROLE_RANK[role] >= ROLE_RANK[COMMANDS[command].minimumRole];
}

export function resolvePlatformCommand(intent: PlatformCommandIntent): ResolvedPlatformCommand {
  if (!SAFE_TARGET.test(intent.target)) throw new Error('invalid platform command target');
  const definition = COMMANDS[intent.command];
  if (!definition) throw new Error(`unsupported platform command: ${intent.command}`);
  return { command: intent.command, target: intent.target, ...definition };
}

export class PlatformCommandGateway {
  constructor(private readonly executor: PlatformCommandExecutor) {}

  async execute(intent: PlatformCommandIntent, context: PlatformCommandContext): Promise<PlatformCommandResult> {
    const resolved = resolvePlatformCommand(intent);
    if (!authorizePlatformCommand(context.role, resolved.command)) {
      throw new Error(`platform role ${context.role} is not authorized for ${resolved.command}`);
    }
    return this.executor(Object.freeze(resolved), Object.freeze({ ...context }));
  }
}

export interface PlatformEventSubscription {
  name: string;
  kinds?: PlatformEventKind[];
  automation?: string;
  timeoutMs?: number;
  handler(event: Readonly<PlatformEvent>): Promise<void> | void;
}

export interface PlatformEventDelivery {
  subscriber: string;
  ok: boolean;
  durationMs: number;
  error?: string;
}

export class PlatformEventBus {
  private readonly subscriptions: PlatformEventSubscription[] = [];

  constructor(private readonly options: { defaultTimeoutMs?: number; maxSubscribers?: number } = {}) {}

  subscribe(subscription: PlatformEventSubscription) {
    if (!subscription.name.trim()) throw new Error('platform subscriber name is required');
    if (this.subscriptions.some((item) => item.name === subscription.name)) throw new Error(`duplicate platform subscriber: ${subscription.name}`);
    if (this.subscriptions.length >= (this.options.maxSubscribers ?? 64)) throw new Error('platform subscriber limit reached');
    const timeoutMs = subscription.timeoutMs ?? this.options.defaultTimeoutMs ?? 5_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new Error('invalid platform subscriber timeout');
    this.subscriptions.push({ ...subscription, timeoutMs });
  }

  list() {
    return this.subscriptions.map(({ handler: _handler, ...subscription }) => ({ ...subscription }));
  }

  async publish(event: PlatformEvent): Promise<PlatformEventDelivery[]> {
    if (event.apiVersion !== TASKRAIL_PLATFORM_API_VERSION) throw new Error(`unsupported platform API version: ${event.apiVersion}`);
    const matches = this.subscriptions.filter((subscription) =>
      (!subscription.kinds?.length || subscription.kinds.includes(event.kind)) &&
      (!subscription.automation || subscription.automation === event.automation)
    );
    const frozen = Object.freeze({ ...event, data: Object.freeze({ ...event.data }) }) as Readonly<PlatformEvent>;
    const outcomes: PlatformEventDelivery[] = [];
    for (const subscription of matches) {
      const started = Date.now();
      try {
        await withTimeout(async () => subscription.handler(frozen), subscription.timeoutMs ?? this.options.defaultTimeoutMs ?? 5_000);
        outcomes.push({ subscriber: subscription.name, ok: true, durationMs: Date.now() - started });
      } catch (error) {
        outcomes.push({ subscriber: subscription.name, ok: false, durationMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return outcomes;
  }
}

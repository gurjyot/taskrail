import { withTimeout } from './execution.js';

export type LifecycleEvent =
  | 'requirement:analyzed'
  | 'architecture:planned'
  | 'candidate:staged'
  | 'preflight:passed'
  | 'preflight:failed'
  | 'migration:preflight'
  | 'activation:before'
  | 'activation:after'
  | 'health:passed'
  | 'health:failed'
  | 'rollback:before'
  | 'rollback:after'
  | 'release:committed'
  | 'recovery:required';

export type LifecycleHookMode = 'observe' | 'mutate';

export interface LifecycleContext {
  event: LifecycleEvent;
  automation?: string;
  transactionId?: string;
  releaseId?: string;
  data?: Readonly<Record<string, unknown>>;
}

export interface LifecycleHook {
  name: string;
  event: LifecycleEvent;
  mode?: LifecycleHookMode;
  priority?: number;
  timeoutMs?: number;
  required?: boolean;
  handler(context: Readonly<LifecycleContext>): Promise<void> | void;
}

export interface LifecycleHookOutcome {
  name: string;
  event: LifecycleEvent;
  mode: LifecycleHookMode;
  ok: boolean;
  required: boolean;
  durationMs: number;
  error?: string;
}

export interface LifecycleEmitResult {
  ok: boolean;
  event: LifecycleEvent;
  outcomes: LifecycleHookOutcome[];
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  return value;
}

export class LifecycleBus {
  private readonly hooks: LifecycleHook[] = [];

  constructor(private readonly options: { allowMutationHandlers?: boolean; defaultTimeoutMs?: number } = {}) {}

  register(hook: LifecycleHook) {
    if (!hook.name?.trim()) throw new Error('lifecycle hook name is required');
    const mode = hook.mode ?? 'observe';
    if (mode === 'mutate' && !this.options.allowMutationHandlers) throw new Error(`mutation lifecycle hook is not authorized: ${hook.name}`);
    const timeoutMs = hook.timeoutMs ?? this.options.defaultTimeoutMs ?? 5_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new Error(`invalid lifecycle hook timeout: ${hook.name}`);
    if (this.hooks.some((item) => item.name === hook.name && item.event === hook.event)) throw new Error(`duplicate lifecycle hook: ${hook.event}:${hook.name}`);
    this.hooks.push({ ...hook, mode, timeoutMs });
  }

  list(event?: LifecycleEvent) {
    return this.hooks
      .filter((hook) => !event || hook.event === event)
      .map(({ handler: _handler, ...hook }) => ({ ...hook }))
      .sort((a, b) => (a.event === b.event ? (a.priority ?? 100) - (b.priority ?? 100) || a.name.localeCompare(b.name) : a.event.localeCompare(b.event)));
  }

  async emit(event: LifecycleEvent, context: Omit<LifecycleContext, 'event'> = {}): Promise<LifecycleEmitResult> {
    const hooks = this.hooks
      .filter((hook) => hook.event === event)
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100) || a.name.localeCompare(b.name));
    const frozen = deepFreeze({ event, ...context }) as Readonly<LifecycleContext>;
    const outcomes: LifecycleHookOutcome[] = [];

    for (const hook of hooks) {
      const started = Date.now();
      try {
        await withTimeout(Promise.resolve(hook.handler(frozen)), hook.timeoutMs ?? this.options.defaultTimeoutMs ?? 5_000);
        outcomes.push({
          name: hook.name,
          event,
          mode: hook.mode ?? 'observe',
          ok: true,
          required: hook.required ?? true,
          durationMs: Date.now() - started,
        });
      } catch (error) {
        outcomes.push({
          name: hook.name,
          event,
          mode: hook.mode ?? 'observe',
          ok: false,
          required: hook.required ?? true,
          durationMs: Date.now() - started,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { ok: outcomes.every((outcome) => outcome.ok || !outcome.required), event, outcomes };
  }
}

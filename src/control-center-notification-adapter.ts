import type { PlatformEventSubscription, PlatformNotification } from './platform-contract.js';

export type ControlCenterNotificationSeverity = 'info' | 'success' | 'warning' | 'error' | 'critical';

export interface ControlCenterNotificationEnvelope {
  id: string;
  kind: string;
  source: string;
  title: string;
  message?: string;
  severity: ControlCenterNotificationSeverity;
  occurredAt: string;
  requiresAction?: boolean;
  actionId?: string;
  entity?: { type: string; id: string };
  data?: Record<string, unknown>;
}

export type ControlCenterNotificationSender = (
  notification: Readonly<ControlCenterNotificationEnvelope>,
) => Promise<void> | void;

function mapSeverity(severity: PlatformNotification['severity']): ControlCenterNotificationSeverity {
  return severity;
}

export function toControlCenterNotification(
  notification: Readonly<PlatformNotification>,
  options: {
    source?: string;
    requiresAction?: boolean;
    actionId?: string;
    entity?: { type: string; id: string };
    data?: Record<string, unknown>;
  } = {},
): ControlCenterNotificationEnvelope {
  if (!notification.id.trim()) throw new Error('platform notification id is required');
  if (!notification.title.trim()) throw new Error(`platform notification title is required: ${notification.id}`);
  if (!notification.createdAt.trim()) throw new Error(`platform notification createdAt is required: ${notification.id}`);

  return {
    id: notification.id,
    kind: 'platform.notification',
    source: options.source ?? notification.automation ?? 'taskrail',
    title: notification.title,
    message: notification.message,
    severity: mapSeverity(notification.severity),
    occurredAt: notification.createdAt,
    requiresAction: options.requiresAction,
    actionId: options.actionId,
    entity: options.entity ?? (notification.automation ? { type: 'automation', id: notification.automation } : undefined),
    data: {
      platform_status: notification.status,
      fingerprint: notification.fingerprint,
      ...(options.data ?? {}),
    },
  };
}

function isPlatformNotification(value: unknown): value is PlatformNotification {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PlatformNotification>;
  return typeof candidate.id === 'string'
    && typeof candidate.createdAt === 'string'
    && typeof candidate.severity === 'string'
    && typeof candidate.status === 'string'
    && typeof candidate.title === 'string'
    && typeof candidate.message === 'string';
}

export function createControlCenterNotificationSubscription(
  send: ControlCenterNotificationSender,
  options: { name?: string; timeoutMs?: number; source?: string } = {},
): PlatformEventSubscription {
  return {
    name: options.name ?? 'control-center-notifications',
    kinds: ['notification.created', 'notification.updated'],
    timeoutMs: options.timeoutMs,
    async handler(event) {
      const raw = event.data.notification;
      if (!isPlatformNotification(raw)) return;
      await send(toControlCenterNotification(raw, {
        source: options.source ?? raw.automation ?? 'taskrail',
        data: {
          platform_event_id: event.id,
          platform_event_kind: event.kind,
        },
      }));
    },
  };
}

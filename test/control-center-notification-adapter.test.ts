import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createControlCenterNotificationSubscription,
  toControlCenterNotification,
} from '../src/control-center-notification-adapter.js';
import {
  PlatformEventBus,
  TASKRAIL_PLATFORM_API_VERSION,
  type PlatformNotification,
} from '../src/platform-contract.js';

const notification: PlatformNotification = {
  id: 'notif-1',
  createdAt: '2026-08-29T00:00:00.000Z',
  severity: 'warning',
  status: 'open',
  title: 'Approval required',
  message: 'Campaign budget change needs review',
  automation: 'meta-ads',
  fingerprint: 'meta-ads:budget-change',
};

test('maps TaskRail platform notifications to Control Center envelopes', () => {
  const mapped = toControlCenterNotification(notification, {
    requiresAction: true,
    actionId: 'approval-1',
  });

  assert.equal(mapped.id, 'notif-1');
  assert.equal(mapped.source, 'meta-ads');
  assert.equal(mapped.severity, 'warning');
  assert.equal(mapped.requiresAction, true);
  assert.deepEqual(mapped.entity, { type: 'automation', id: 'meta-ads' });
  assert.equal(mapped.data?.platform_status, 'open');
});

test('subscription forwards notification events through PlatformEventBus', async () => {
  const delivered: unknown[] = [];
  const bus = new PlatformEventBus();
  bus.subscribe(createControlCenterNotificationSubscription((item) => {
    delivered.push(item);
  }));

  const outcomes = await bus.publish({
    apiVersion: TASKRAIL_PLATFORM_API_VERSION,
    id: 'event-1',
    at: '2026-08-29T00:00:01.000Z',
    kind: 'notification.created',
    automation: 'meta-ads',
    data: { notification },
  });

  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].ok, true);
  assert.equal(delivered.length, 1);
  const item = delivered[0] as { id: string; data?: Record<string, unknown> };
  assert.equal(item.id, 'notif-1');
  assert.equal(item.data?.platform_event_id, 'event-1');
});

test('subscription ignores malformed notification event payloads', async () => {
  let delivered = false;
  const bus = new PlatformEventBus();
  bus.subscribe(createControlCenterNotificationSubscription(() => {
    delivered = true;
  }));

  await bus.publish({
    apiVersion: TASKRAIL_PLATFORM_API_VERSION,
    id: 'event-2',
    at: '2026-08-29T00:00:01.000Z',
    kind: 'notification.created',
    data: { notification: { id: 'broken' } },
  });

  assert.equal(delivered, false);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_CONTROL_CENTER_PAGE_SIZE,
  canTransitionAction,
  canTransitionApproval,
  canTransitionDraftSet,
  canTransitionIntelligenceRequest,
  canTransitionIntervention,
  assertActionTransition,
  assertApprovalTransition,
  assertInterventionTransition,
  normalizeControlCenterPageSize,
  shouldNotifyPriority,
  validateActionRequest,
  validateApprovalRequest,
  validateDraftSet,
  validateIntelligenceRequest,
  validateInterventionItem,
  type ActionRequest,
  type ApprovalRequest,
  type DraftSet,
  type IntelligenceRequest,
  type InterventionItem,
} from '../src/public/platform.js';

const human = { kind: 'human' as const, id: 'owner' };
const automation = { kind: 'automation' as const, id: 'daily-report' };

test('intervention, approval, action, draft and intelligence lifecycles fail closed on invalid transitions', () => {
  assert.equal(canTransitionIntervention('open', 'waiting'), true);
  assert.equal(canTransitionIntervention('waiting', 'in_progress'), true);
  assert.equal(canTransitionIntervention('completed', 'open'), false);
  assert.doesNotThrow(() => assertInterventionTransition('open', 'in_progress'));
  assert.throws(() => assertInterventionTransition('dismissed', 'open'), /invalid intervention transition/);

  assert.equal(canTransitionApproval('pending', 'approved'), true);
  assert.equal(canTransitionApproval('approved', 'rejected'), false);
  assert.doesNotThrow(() => assertApprovalTransition('pending', 'rejected'));
  assert.throws(() => assertApprovalTransition('approved', 'rejected'), /invalid approval transition/);

  assert.equal(canTransitionDraftSet('generating', 'ready'), true);
  assert.equal(canTransitionDraftSet('ready', 'generating'), false);

  assert.equal(canTransitionAction('waiting_for_approval', 'approved'), true);
  assert.equal(canTransitionAction('completed', 'executing'), false);
  assert.doesNotThrow(() => assertActionTransition('failed_retryable', 'executing'));
  assert.throws(() => assertActionTransition('completed', 'executing'), /invalid action transition/);

  assert.equal(canTransitionIntelligenceRequest('pending', 'running'), true);
  assert.equal(canTransitionIntelligenceRequest('completed', 'running'), false);
});

test('priority notification defaults interrupt only for high and urgent', () => {
  assert.equal(shouldNotifyPriority('urgent'), true);
  assert.equal(shouldNotifyPriority('high'), true);
  assert.equal(shouldNotifyPriority('normal'), false);
  assert.equal(shouldNotifyPriority('low'), false);
});

test('Control Center history defaults to 50 and rejects unbounded page sizes', () => {
  assert.equal(normalizeControlCenterPageSize(), DEFAULT_CONTROL_CENTER_PAGE_SIZE);
  assert.equal(normalizeControlCenterPageSize(1), 1);
  assert.equal(normalizeControlCenterPageSize(200), 200);
  assert.throws(() => normalizeControlCenterPageSize(0), /page size/);
  assert.throws(() => normalizeControlCenterPageSize(201), /page size/);
  assert.throws(() => normalizeControlCenterPageSize(10.5), /page size/);
});

test('intervention records require authoritative identity and consistent dismiss state', () => {
  const item: InterventionItem = {
    id: 'item-1',
    version: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    category: 'ads',
    kind: 'approval',
    priority: 'high',
    status: 'open',
    title: 'Review proposed budget change',
    source: { type: 'automation', id: 'ads-agent' },
    contextRefs: [],
    actionIds: ['action-1'],
    intelligenceRequestIds: [],
  };
  assert.deepEqual(validateInterventionItem(item), []);
  assert.match(validateInterventionItem({ ...item, title: '' }).join('; '), /title is required/);
  assert.match(validateInterventionItem({ ...item, status: 'dismissed' }).join('; '), /requires dismissedAt/);
  assert.deepEqual(validateInterventionItem({ ...item, status: 'dismissed', dismissedAt: new Date(1).toISOString() }), []);
});

test('approval records are bound to an immutable action payload and decision metadata', () => {
  const approval: ApprovalRequest = {
    id: 'approval-1',
    version: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    status: 'pending',
    risk: 'high',
    requestedBy: automation,
    requestedActionId: 'action-1',
    actionPayloadHash: 'sha256:abc',
  };
  assert.deepEqual(validateApprovalRequest(approval), []);
  assert.match(validateApprovalRequest({ ...approval, actionPayloadHash: '' }).join('; '), /payload hash/);
  assert.match(validateApprovalRequest({ ...approval, status: 'approved' }).join('; '), /requires decidedAt/);
  assert.deepEqual(validateApprovalRequest({
    ...approval,
    status: 'approved',
    decidedAt: new Date(1).toISOString(),
    decidedBy: human,
  }), []);
});

test('ready draft sets require real drafts and recommended draft must belong to the set', () => {
  const base: DraftSet = {
    id: 'draft-set-1',
    workItemId: 'item-1',
    generation: 1,
    version: 1,
    status: 'ready',
    createdAt: new Date(0).toISOString(),
    createdBy: automation,
    contextRefs: [],
    recommendedDraftId: 'draft-1',
    drafts: [
      { id: 'draft-1', label: 'recommended', body: 'Balanced response' },
      { id: 'draft-2', label: 'concise', body: 'Short response' },
      { id: 'draft-3', label: 'detailed', body: 'Detailed response' },
    ],
  };
  assert.deepEqual(validateDraftSet(base), []);
  assert.match(validateDraftSet({ ...base, drafts: [] }).join('; '), /at least one draft/);
  assert.match(validateDraftSet({ ...base, recommendedDraftId: 'missing' }).join('; '), /recommended draft id/);
  assert.match(validateDraftSet({ ...base, drafts: [...base.drafts, base.drafts[0]!] }).join('; '), /duplicate draft id/);
});

test('consequential actions require stable idempotency and payload identity', () => {
  const action: ActionRequest = {
    id: 'action-1',
    version: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    type: 'communications.whatsapp.send',
    status: 'waiting_for_approval',
    requestedBy: human,
    target: { type: 'conversation', id: 'client-1' },
    payload: { text: 'Approved message' },
    payloadHash: 'sha256:abc',
    idempotencyKey: 'send:client-1:message-1',
    attemptCount: 0,
  };
  assert.deepEqual(validateActionRequest(action), []);
  assert.match(validateActionRequest({ ...action, idempotencyKey: '' }).join('; '), /idempotency key/);
  assert.match(validateActionRequest({ ...action, payloadHash: '' }).join('; '), /payload hash/);
  assert.match(validateActionRequest({ ...action, attemptCount: -1 }).join('; '), /attempt count/);
});

test('intelligence requests require a declared result schema and terminal evidence', () => {
  const request: IntelligenceRequest = {
    id: 'intel-1',
    version: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    type: 'drafts',
    status: 'running',
    requestedBy: automation,
    contextRefs: [],
    input: { purpose: 'prepare replies' },
    expectedSchema: 'communication-drafts@1',
  };
  assert.deepEqual(validateIntelligenceRequest(request), []);
  assert.match(validateIntelligenceRequest({ ...request, expectedSchema: '' }).join('; '), /expected schema/);
  assert.match(validateIntelligenceRequest({ ...request, status: 'completed' }).join('; '), /requires a result/);
  assert.deepEqual(validateIntelligenceRequest({ ...request, status: 'completed', result: { drafts: [] } }), []);
  assert.match(validateIntelligenceRequest({ ...request, status: 'failed_retryable' }).join('; '), /requires an error/);
});

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type PlatformPriority = 'low' | 'normal' | 'high' | 'urgent';
export type ActorKind = 'human' | 'agent' | 'automation' | 'system';

export interface ActorReference {
  kind: ActorKind;
  id: string;
  displayName?: string;
}

export interface SourceReference {
  type: string;
  id: string;
  label?: string;
}

export interface ResourceReference {
  type: string;
  id: string;
  label?: string;
}

export type InterventionKind = 'attention' | 'approval' | 'draft_approval' | 'retry' | 'escalation';
export type InterventionStatus = 'open' | 'in_progress' | 'waiting' | 'completed' | 'dismissed' | 'cancelled';

export interface InterventionItem {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  category: string;
  kind: InterventionKind;
  priority: PlatformPriority;
  status: InterventionStatus;
  title: string;
  summary?: string;
  source: SourceReference;
  contextRefs: SourceReference[];
  approvalId?: string;
  draftSetId?: string;
  actionIds: string[];
  intelligenceRequestIds: string[];
  assignedTo?: ActorReference;
  dueAt?: string;
  tags?: string[];
  readAt?: string;
  dismissedAt?: string;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired' | 'superseded';
export type ApprovalRisk = 'low' | 'medium' | 'high' | 'critical';

export interface ApprovalRequest {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  status: ApprovalStatus;
  risk: ApprovalRisk;
  requestedBy: ActorReference;
  requestedActionId: string;
  actionPayloadHash: string;
  reason?: string;
  expiresAt?: string;
  decidedAt?: string;
  decidedBy?: ActorReference;
  decisionReason?: string;
}

export type DraftSetStatus = 'generating' | 'ready' | 'failed' | 'superseded';

export interface DraftOption {
  id: string;
  label: string;
  body: string;
  rationale?: string;
  metadata?: Record<string, JsonValue>;
}

export interface DraftSet {
  id: string;
  workItemId: string;
  generation: number;
  version: number;
  status: DraftSetStatus;
  createdAt: string;
  createdBy: ActorReference;
  contextRefs: SourceReference[];
  recommendedDraftId?: string;
  drafts: DraftOption[];
  requestId?: string;
}

export type ActionStatus =
  | 'pending'
  | 'waiting_for_ai'
  | 'waiting_for_approval'
  | 'approved'
  | 'executing'
  | 'completed'
  | 'failed_retryable'
  | 'failed_permanent'
  | 'rejected'
  | 'cancelled';

export interface SelectedDraftReference {
  draftSetId: string;
  draftId: string;
  generation: number;
}

export interface ActionRequest {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  type: string;
  status: ActionStatus;
  requestedBy: ActorReference;
  target: ResourceReference;
  payload: JsonValue;
  payloadHash: string;
  idempotencyKey: string;
  approvalId?: string;
  selectedDraft?: SelectedDraftReference;
  attemptCount: number;
  lastExecutionId?: string;
}

export type ExecutionStatus = 'executing' | 'succeeded' | 'failed_retryable' | 'failed_permanent' | 'cancelled' | 'unknown_outcome';

export interface NormalizedError {
  code: string;
  message: string;
  retryable?: boolean;
}

export interface ExecutionAttempt {
  id: string;
  actionId: string;
  attempt: number;
  startedAt: string;
  finishedAt?: string;
  executor: ActorReference;
  provider?: string;
  status: ExecutionStatus;
  providerOperationId?: string;
  durationMs?: number;
  error?: NormalizedError;
  result?: JsonValue;
}

export type IntelligenceRequestType = 'drafts' | 'analysis' | 'classification' | 'specialist';
export type IntelligenceRequestStatus = 'pending' | 'running' | 'completed' | 'failed_retryable' | 'failed_permanent' | 'cancelled';

export interface IntelligenceRequest {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  type: IntelligenceRequestType;
  status: IntelligenceRequestStatus;
  requestedBy: ActorReference;
  workItemId?: string;
  contextRefs: SourceReference[];
  input: JsonValue;
  expectedSchema: string;
  assignedAgent?: ActorReference;
  result?: JsonValue;
  error?: NormalizedError;
}

export interface AuditRecord {
  id: string;
  at: string;
  actor: ActorReference;
  action: string;
  object: ResourceReference;
  requestId?: string;
  source?: SourceReference;
  reason?: string;
  approvalId?: string;
  result: 'accepted' | 'rejected' | 'succeeded' | 'failed';
  metadata?: Record<string, JsonValue>;
}

export interface AutomationRunSummary {
  runId: string;
  automationId: string;
  startedAt: string;
  finishedAt?: string;
  trigger: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown_outcome';
  productionData: boolean;
  summary?: string;
  result?: JsonValue;
  error?: NormalizedError;
}

export type HumanInterventionEventKind =
  | 'intervention.created'
  | 'intervention.updated'
  | 'approval.created'
  | 'approval.decided'
  | 'draft_set.created'
  | 'draft_set.ready'
  | 'draft_set.failed'
  | 'action.updated'
  | 'execution.updated'
  | 'intelligence.updated';

export interface HumanInterventionEvent {
  id: string;
  sequence: number;
  at: string;
  kind: HumanInterventionEventKind;
  object: ResourceReference;
  actor?: ActorReference;
  data: Readonly<Record<string, JsonValue>>;
}

const APPROVAL_TRANSITIONS: Readonly<Record<ApprovalStatus, readonly ApprovalStatus[]>> = {
  pending: ['approved', 'rejected', 'cancelled', 'expired', 'superseded'],
  approved: [],
  rejected: [],
  cancelled: [],
  expired: [],
  superseded: [],
};

const DRAFT_SET_TRANSITIONS: Readonly<Record<DraftSetStatus, readonly DraftSetStatus[]>> = {
  generating: ['ready', 'failed'],
  ready: ['superseded'],
  failed: [],
  superseded: [],
};

const ACTION_TRANSITIONS: Readonly<Record<ActionStatus, readonly ActionStatus[]>> = {
  pending: ['waiting_for_ai', 'waiting_for_approval', 'approved', 'cancelled'],
  waiting_for_ai: ['waiting_for_approval', 'approved', 'failed_retryable', 'failed_permanent', 'cancelled'],
  waiting_for_approval: ['approved', 'rejected', 'cancelled'],
  approved: ['executing', 'cancelled'],
  executing: ['completed', 'failed_retryable', 'failed_permanent', 'cancelled'],
  completed: [],
  failed_retryable: ['executing', 'cancelled'],
  failed_permanent: [],
  rejected: [],
  cancelled: [],
};

const INTELLIGENCE_TRANSITIONS: Readonly<Record<IntelligenceRequestStatus, readonly IntelligenceRequestStatus[]>> = {
  pending: ['running', 'cancelled'],
  running: ['completed', 'failed_retryable', 'failed_permanent', 'cancelled'],
  completed: [],
  failed_retryable: ['running', 'failed_permanent', 'cancelled'],
  failed_permanent: [],
  cancelled: [],
};

function canTransition<T extends string>(transitions: Readonly<Record<T, readonly T[]>>, from: T, to: T) {
  return from === to || transitions[from].includes(to);
}

export function canTransitionApproval(from: ApprovalStatus, to: ApprovalStatus) {
  return canTransition(APPROVAL_TRANSITIONS, from, to);
}

export function canTransitionDraftSet(from: DraftSetStatus, to: DraftSetStatus) {
  return canTransition(DRAFT_SET_TRANSITIONS, from, to);
}

export function canTransitionAction(from: ActionStatus, to: ActionStatus) {
  return canTransition(ACTION_TRANSITIONS, from, to);
}

export function canTransitionIntelligenceRequest(from: IntelligenceRequestStatus, to: IntelligenceRequestStatus) {
  return canTransition(INTELLIGENCE_TRANSITIONS, from, to);
}

export function assertApprovalTransition(from: ApprovalStatus, to: ApprovalStatus) {
  if (!canTransitionApproval(from, to)) throw new Error(`invalid approval transition: ${from} -> ${to}`);
}

export function assertDraftSetTransition(from: DraftSetStatus, to: DraftSetStatus) {
  if (!canTransitionDraftSet(from, to)) throw new Error(`invalid draft set transition: ${from} -> ${to}`);
}

export function assertActionTransition(from: ActionStatus, to: ActionStatus) {
  if (!canTransitionAction(from, to)) throw new Error(`invalid action transition: ${from} -> ${to}`);
}

export function assertIntelligenceRequestTransition(from: IntelligenceRequestStatus, to: IntelligenceRequestStatus) {
  if (!canTransitionIntelligenceRequest(from, to)) throw new Error(`invalid intelligence request transition: ${from} -> ${to}`);
}

export function shouldNotifyPriority(priority: PlatformPriority) {
  return priority === 'high' || priority === 'urgent';
}

export const DEFAULT_CONTROL_CENTER_PAGE_SIZE = 50;
export const MAX_CONTROL_CENTER_PAGE_SIZE = 200;

export function normalizeControlCenterPageSize(value?: number) {
  if (value === undefined) return DEFAULT_CONTROL_CENTER_PAGE_SIZE;
  if (!Number.isInteger(value) || value < 1 || value > MAX_CONTROL_CENTER_PAGE_SIZE) {
    throw new Error(`control center page size must be an integer from 1 to ${MAX_CONTROL_CENTER_PAGE_SIZE}`);
  }
  return value;
}

export function validateDraftSet(draftSet: DraftSet) {
  const errors: string[] = [];
  if (!draftSet.id.trim()) errors.push('draft set id is required');
  if (!draftSet.workItemId.trim()) errors.push('draft set work item id is required');
  if (!Number.isInteger(draftSet.generation) || draftSet.generation < 1) errors.push('draft set generation must be a positive integer');
  if (!Number.isInteger(draftSet.version) || draftSet.version < 1) errors.push('draft set version must be a positive integer');
  if (draftSet.status === 'ready' && draftSet.drafts.length === 0) errors.push('ready draft set must contain at least one draft');
  const ids = new Set<string>();
  for (const draft of draftSet.drafts) {
    if (!draft.id.trim()) errors.push('draft id is required');
    if (ids.has(draft.id)) errors.push(`duplicate draft id: ${draft.id}`);
    ids.add(draft.id);
    if (!draft.body.trim()) errors.push(`draft body is required: ${draft.id || '(unknown)'}`);
  }
  if (draftSet.recommendedDraftId && !ids.has(draftSet.recommendedDraftId)) errors.push('recommended draft id must reference a draft in the set');
  return errors;
}

export function validateActionRequest(action: ActionRequest) {
  const errors: string[] = [];
  if (!action.id.trim()) errors.push('action id is required');
  if (!action.type.trim()) errors.push('action type is required');
  if (!action.idempotencyKey.trim()) errors.push('action idempotency key is required');
  if (!action.payloadHash.trim()) errors.push('action payload hash is required');
  if (!Number.isInteger(action.version) || action.version < 1) errors.push('action version must be a positive integer');
  if (!Number.isInteger(action.attemptCount) || action.attemptCount < 0) errors.push('action attempt count must be a non-negative integer');
  return errors;
}

import type {
  ApprovalRequest,
  IntelligenceRequest,
  InterventionItem,
  InterventionStatus,
} from './human-intervention.js';

const INTERVENTION_TRANSITIONS: Readonly<Record<InterventionStatus, readonly InterventionStatus[]>> = {
  open: ['in_progress', 'waiting', 'completed', 'dismissed', 'cancelled'],
  in_progress: ['waiting', 'completed', 'dismissed', 'cancelled'],
  waiting: ['in_progress', 'completed', 'dismissed', 'cancelled'],
  completed: [],
  dismissed: [],
  cancelled: [],
};

export function canTransitionIntervention(from: InterventionStatus, to: InterventionStatus) {
  return from === to || INTERVENTION_TRANSITIONS[from].includes(to);
}

export function assertInterventionTransition(from: InterventionStatus, to: InterventionStatus) {
  if (!canTransitionIntervention(from, to)) {
    throw new Error(`invalid intervention transition: ${from} -> ${to}`);
  }
}

function validateVersion(version: number, label: string, errors: string[]) {
  if (!Number.isInteger(version) || version < 1) errors.push(`${label} version must be a positive integer`);
}

function validateActorId(id: string, label: string, errors: string[]) {
  if (!id.trim()) errors.push(`${label} actor id is required`);
}

export function validateInterventionItem(item: InterventionItem) {
  const errors: string[] = [];
  if (!item.id.trim()) errors.push('intervention id is required');
  validateVersion(item.version, 'intervention', errors);
  if (!item.category.trim()) errors.push('intervention category is required');
  if (!item.title.trim()) errors.push('intervention title is required');
  if (!item.source.type.trim() || !item.source.id.trim()) errors.push('intervention source type and id are required');
  if (!Array.isArray(item.contextRefs)) errors.push('intervention context refs must be an array');
  if (!Array.isArray(item.actionIds)) errors.push('intervention action ids must be an array');
  if (!Array.isArray(item.intelligenceRequestIds)) errors.push('intervention intelligence request ids must be an array');
  if (item.assignedTo) validateActorId(item.assignedTo.id, 'assigned', errors);
  if (item.status === 'dismissed' && !item.dismissedAt) errors.push('dismissed intervention requires dismissedAt');
  if (item.status !== 'dismissed' && item.dismissedAt) errors.push('dismissedAt is only valid for dismissed interventions');
  return errors;
}

export function validateApprovalRequest(approval: ApprovalRequest) {
  const errors: string[] = [];
  if (!approval.id.trim()) errors.push('approval id is required');
  validateVersion(approval.version, 'approval', errors);
  validateActorId(approval.requestedBy.id, 'requesting', errors);
  if (!approval.requestedActionId.trim()) errors.push('approval requested action id is required');
  if (!approval.actionPayloadHash.trim()) errors.push('approval action payload hash is required');

  const humanDecision = approval.status === 'approved' || approval.status === 'rejected';
  if (humanDecision && !approval.decidedAt) errors.push(`${approval.status} approval requires decidedAt`);
  if (humanDecision && !approval.decidedBy) errors.push(`${approval.status} approval requires decidedBy`);
  if (approval.decidedBy) validateActorId(approval.decidedBy.id, 'deciding', errors);
  if (approval.status === 'pending' && (approval.decidedAt || approval.decidedBy)) {
    errors.push('pending approval cannot contain decision metadata');
  }
  return errors;
}

export function validateIntelligenceRequest(request: IntelligenceRequest) {
  const errors: string[] = [];
  if (!request.id.trim()) errors.push('intelligence request id is required');
  validateVersion(request.version, 'intelligence request', errors);
  validateActorId(request.requestedBy.id, 'requesting', errors);
  if (!request.expectedSchema.trim()) errors.push('intelligence request expected schema is required');
  if (!Array.isArray(request.contextRefs)) errors.push('intelligence request context refs must be an array');
  if (request.assignedAgent) validateActorId(request.assignedAgent.id, 'assigned', errors);

  if (request.status === 'completed' && request.result === undefined) {
    errors.push('completed intelligence request requires a result');
  }
  if ((request.status === 'failed_retryable' || request.status === 'failed_permanent') && !request.error) {
    errors.push(`${request.status} intelligence request requires an error`);
  }
  return errors;
}

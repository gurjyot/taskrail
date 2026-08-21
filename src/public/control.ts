export { LifecycleBus } from '../hooks.js';
export {
  createUpdateCheckpoint,
  readUpdateCheckpoint,
  transitionUpdate,
  canTransitionUpdate,
  rollbackReadiness,
  requireRollbackReady,
  transactionFile,
} from '../update-transaction.js';
export {
  validateLastKnownGoodRecovery,
  recordRecoveryReadiness,
} from '../recovery-readiness.js';
export { transactionalDeploy } from '../transactional-deploy.js';
export { recoverInterruptedAutomation } from '../recovery-resume.js';
export {
  updatePauseFile,
  readUpdatePause,
  pauseAutomationUpdates,
  resumeAutomationUpdates,
} from '../update-pause.js';
export {
  pauseSharedUpdateConsumers,
  resumeSharedUpdateConsumers,
} from '../shared-update-control.js';
export { verifyProvenance, provenancePayload, sha256 } from '../provenance.js';
export { assessSharedArtifactUpdate, satisfiesSimpleRange } from '../compatibility-contract.js';
export { assessSecurityDeclaration, TASKRAIL_SECURITY_POLICY } from '../security-policy.js';
export { groupDiagnostics, diagnosticIssueKey } from '../error-intelligence.js';
export type {
  LifecycleEvent,
  LifecycleContext,
  LifecycleHook,
  LifecycleHookOutcome,
  LifecycleEmitResult,
} from '../hooks.js';
export type {
  UpdateCheckpoint,
  UpdateTargetKind,
  UpdateChangeClass,
  UpdatePhase,
} from '../update-transaction.js';
export type { RecoveryReadinessResult } from '../recovery-readiness.js';
export type { TransactionalDeployOptions, TransactionalDeployResult } from '../transactional-deploy.js';
export type { RecoveryResumeResult } from '../recovery-resume.js';
export type { UpdatePauseRecord } from '../update-pause.js';
export type { SharedPauseResult } from '../shared-update-control.js';
export type { ProvenanceStatement, ProvenancePolicy, ProvenanceResult } from '../provenance.js';
export type { CompatibilityContract, CompatibilityConsumer, CompatibilityAssessment, SharedArtifactKind, ChangeLevel } from '../compatibility-contract.js';
export type { SecurityPolicy, SecurityDeclaration, SecurityControl } from '../security-policy.js';
export type { DiagnosticGroup } from '../error-intelligence.js';

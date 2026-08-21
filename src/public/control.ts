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
export type { UpdatePauseRecord } from '../update-pause.js';
export type { SharedPauseResult } from '../shared-update-control.js';

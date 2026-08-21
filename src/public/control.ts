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

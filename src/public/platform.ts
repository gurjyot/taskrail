export {
  TASKRAIL_PLATFORM_API_VERSION,
  PlatformEventBus,
  platformCommandDefinitions,
  authorizePlatformCommand,
  resolvePlatformCommand,
} from '../platform-contract.js';
export {
  DEFAULT_EXECUTION_GUARD_POLICY,
  RunawayExecutionGuard,
  validateExecutionGuardPolicy,
  journalExecutionGuardTrip,
} from '../execution-guardrails.js';
export type {
  PlatformRole,
  PlatformAutomationState,
  PlatformHealth,
  PlatformNotificationSeverity,
  PlatformNotificationStatus,
  PlatformTestSummary,
  PlatformAutomationSummary,
  PlatformSnapshot,
  PlatformNotification,
  PlatformEventKind,
  PlatformEvent,
  PlatformCommandName,
  PlatformCommandIntent,
  ResolvedPlatformCommand,
  PlatformEventSubscription,
  PlatformEventDelivery,
} from '../platform-contract.js';
export type {
  ExecutionGuardPolicy,
  ExecutionGuardReason,
  ExecutionGuardObservation,
  ExecutionGuardTrip,
  ExecutionGuardStatus,
  GuardrailJournalRecord,
} from '../execution-guardrails.js';

import {
  createExecutionContext,
  LocalStateStore,
  IdempotencyStore,
  runIdempotent,
  withRetry,
  withTimeout,
  mapConcurrent,
  effectiveExecutionPolicy,
} from '../execution.js';

export {
  createExecutionContext,
  LocalStateStore,
  IdempotencyStore,
  runIdempotent,
  withRetry,
  withTimeout,
  mapConcurrent,
  effectiveExecutionPolicy,
};

export const execution = Object.freeze({ createExecutionContext, effectiveExecutionPolicy });
export const state = Object.freeze({ LocalStateStore });
export const idempotency = Object.freeze({ IdempotencyStore, runIdempotent });
export const retry = Object.freeze({ withRetry });
export const timeout = Object.freeze({ withTimeout });
export const concurrency = Object.freeze({ mapConcurrent });

export * as config from './config.js';
export * as fsSafe from './fs-safe.js';
export * as http from './http.js';
export * as log from './log.js';

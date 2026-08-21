export { validateConfig } from '../validation.js';
export {
  frameworkCapabilities,
  frameworkProfiles,
  resolveFrameworkManifest,
  compactManifest,
  inferProfile,
} from '../framework.js';
export { resolvePaths, isCompatible } from '../config.js';
export type {
  FrameworkConfig,
  FrameworkManifest,
  FrameworkCapabilityDefinition,
  FrameworkProfileDefinition,
  IsolationPolicy,
  ExecutionPolicy,
  ResourcePolicy,
  HealthCheckDefinition,
  DeployStrategy,
  ServiceManagerDefinition,
} from '../types.js';

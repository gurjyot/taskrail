export type Severity = 'debug' | 'info' | 'warn' | 'error';
export type TaskrailEnv = 'local' | 'ci' | 'production';
export type RuntimeKind = 'node' | 'python' | 'shell';
export type HealthTier = 'process' | 'integration' | 'end-to-end';
export type GateVerdict = 'PASS' | 'FAIL' | 'MISCONFIGURED';
export type ChangeRisk = 'low' | 'medium' | 'high' | 'blocked';
export type DeployEligibility = 'allowed' | 'blocked';
export type DriftKind = 'source' | 'runtime' | 'generated';
export type ServiceManagerType = 'systemd';
export type DeployStrategyType = 'replace-in-place' | 'release-symlink';
export type DependencyManagerTool = 'npm' | 'pnpm' | 'bun' | 'pip';

export interface ManifestPathRule {
  path: string;
  environments?: TaskrailEnv[];
  mode?: 'must-exist' | 'writable';
  secret?: boolean;
}

export interface DependencyManagerConfig {
  tool: DependencyManagerTool;
  lockfile?: string;
  manifest?: string;
  installCommand?: string;
}

export interface RuntimeRequirement {
  kind: RuntimeKind;
  version?: string;
  command?: string;
}

export interface ServiceUnitDefinition {
  name: string;
  kind: 'service' | 'timer';
  oneshotOkay?: boolean;
  user?: string;
  staleAfterMs?: number;
}

export interface ServiceManagerDefinition {
  type: ServiceManagerType;
  units: ServiceUnitDefinition[];
}

export interface MigrationHooks {
  checkCommand?: string;
  applyCommand?: string;
  destructive?: boolean;
}

export interface DeployStrategy {
  type: DeployStrategyType;
  releaseRoot?: string;
}

export interface RetryPolicy {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: boolean;
}

export interface ExecutionPolicy {
  timeoutMs?: number;
  maxConcurrency?: number;
  staleAfterMs?: number;
  retry?: RetryPolicy;
}

export interface ResourcePolicy {
  memoryMaxMb?: number;
  cpuQuotaPercent?: number;
  tasksMax?: number;
  nice?: number;
}

export interface FrameworkManifest {
  name: string;
  taskrailCompatibility?: string;
  profile?: string;
  frameworkCapabilities?: string[];
  runtime: RuntimeKind;
  runtimeVersion?: string;
  managed: boolean;
  sourceDir: string;
  deployDir: string;
  validationCommand: string;
  testCommand: string;
  buildCommand?: string;
  releaseCommand?: string;
  healthCommand?: string;
  capabilities?: string[];
  capabilityRoots?: string[];
  healthCheck?: HealthCheckDefinition;
  healthChecks?: HealthCheckDefinition[];
  runtimeHealthCommand?: string;
  backup?: BackupPolicy;
  plugins?: PluginReference[];
  requiredEnv?: string[];
  requiredSharedFiles?: Array<string | ManifestPathRule>;
  requiredChecks?: Array<'validation' | 'test' | 'build' | 'health' | 'drift' | 'migrate'>;
  protectedPaths?: string[];
  releaseOwnedPaths?: string[];
  runtimePaths?: string[];
  generatedPaths?: string[];
  dependencyManager?: DependencyManagerConfig;
  deployStrategy?: DeployStrategy;
  serviceManager?: ServiceManagerDefinition;
  migrations?: MigrationHooks;
  execution?: ExecutionPolicy;
  resources?: ResourcePolicy;
  statePath?: string;
  database?: {
    required?: boolean;
    schema?: string;
  };
}

export interface FrameworkCapabilityDefinition {
  id: string;
  apply(manifest: FrameworkManifest): Partial<FrameworkManifest>;
  preconditions?(manifest: FrameworkManifest): string[];
}

export interface FrameworkProfileDefinition {
  id: string;
  frameworkCapabilities: string[];
  defaults: Partial<FrameworkManifest>;
  preconditions?(manifest: FrameworkManifest): string[];
}

export type HealthCheckDefinition =
  | { type: 'command'; command: string }
  | { type: 'file'; path: string }
  | { type: 'http'; url: string; expectStatus?: number };

export interface BackupPolicy {
  retain: number;
}

export interface PluginReference {
  name: string;
  module: string;
}

export interface CapabilityManifest {
  name: string;
  version: string;
  description: string;
  runtime: 'node';
  canonicalPath: string;
  requiredSharedFiles?: string[];
  healthCheck?: HealthCheckDefinition;
  input?: string;
  output?: string;
}

export interface CapabilityContract extends CapabilityManifest {
  root: string;
  path: string;
  consumers?: string[];
}

export interface FrameworkConfig {
  projectName: string;
  environment: Record<string, string | undefined>;
  manifest: FrameworkManifest;
}

export interface EnvironmentInfo {
  name: TaskrailEnv;
  overridden: boolean;
  reason: string;
}

export interface LogEvent {
  level: Severity;
  message: string;
  scope?: string;
  data?: unknown;
}

export interface HealthResult {
  ok: boolean;
  details?: string;
}

export interface BackupResult {
  path: string;
}

export interface DeployResult {
  deployed: boolean;
  rolledBack: boolean;
}

export interface GitState {
  available: boolean;
  repoRoot?: string;
  sha?: string;
  clean?: boolean;
  changedFiles?: string[];
  error?: string;
}

export interface ReleaseMeta {
  releaseId: string;
  project: string;
  taskrailVersion: string;
  sourceRevision?: string;
  createdAt: string;
  path: string;
  environment?: TaskrailEnv;
  manifestHash?: string;
  receiptPath?: string;
}

export interface FailureReport {
  project: string;
  taskrailVersion: string;
  stage: string;
  failedCommand?: string;
  exitCode?: number;
  category: string;
  message: string;
  releaseId?: string;
  rollbackAttempted: boolean;
  rollbackResult?: 'success' | 'failed' | 'not-needed';
  nextStep?: string;
  environment?: TaskrailEnv;
}

export interface PluginContext {
  config: FrameworkConfig;
  log(event: LogEvent): void;
}

export interface AutomationPlugin {
  name: string;
  setup?(context: PluginContext): void;
  validate?(config: FrameworkConfig): string[];
  healthCheck?(): Promise<HealthResult> | HealthResult;
  backup?(): Promise<BackupResult> | BackupResult;
  rollback?(): Promise<void> | void;
  reviewChange?(change: ChangeReviewInput): Promise<ChangeReviewResult> | ChangeReviewResult;
}

export interface ChangeReviewInput {
  changedFiles: string[];
  protectedPaths: string[];
  risk: ChangeRisk;
  gate: GateVerdict;
  deployAllowed: boolean;
}

export interface ChangeReviewResult {
  ok: boolean;
  summary?: string;
}

export interface DeploymentContext {
  sourceDir: string;
  deployDir: string;
  candidateDir: string;
  backupDir: string;
}

export interface HealthCheckOutcome {
  tier: HealthTier;
  ok: boolean;
  details?: string;
}

export interface DriftItem {
  path: string;
  kind: DriftKind;
  reason: string;
}

export interface DeployState {
  backupPath?: string;
  targetPath: string;
  releasePath?: string;
  previousReleasePath?: string;
  currentReleaseId?: string;
  currentSha?: string;
  currentFingerprint?: string;
  lastKnownGoodReleasePath?: string;
  lastKnownGoodReleaseId?: string;
  lastKnownGoodSha?: string;
}

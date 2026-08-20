export type LifecycleStep =
  | 'create'
  | 'check'
  | 'test'
  | 'build'
  | 'deploy'
  | 'verify'
  | 'run';

export type Severity = 'debug' | 'info' | 'warn' | 'error';

export interface FrameworkManifest {
  name: string;
  taskrailCompatibility?: string;
  runtime: 'node';
  managed: boolean;
  sourceDir: string;
  deployDir: string;
  validationCommand: string;
  testCommand: string;
  buildCommand?: string;
  releaseCommand?: string;
  healthCheck?: HealthCheckDefinition;
  healthChecks?: HealthCheckDefinition[];
  backup?: BackupPolicy;
  plugins?: PluginReference[];
  requiredEnv?: string[];
  requiredFiles?: string[];
  requiredChecks?: Array<'validation' | 'test' | 'build' | 'health' | 'drift'>;
  protectedPaths?: string[];
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

export interface FrameworkConfig {
  projectName: string;
  environment: Record<string, string | undefined>;
  manifest: FrameworkManifest;
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

export interface ReleaseMeta {
  releaseId: string;
  project: string;
  taskrailVersion: string;
  sourceRevision?: string;
  createdAt: string;
  path: string;
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

export type GateVerdict = 'PASS' | 'FAIL' | 'MISCONFIGURED';
export type ChangeRisk = 'low' | 'medium' | 'high' | 'blocked';
export type DeployEligibility = 'allowed' | 'blocked';

export interface DeploymentContext {
  sourceDir: string;
  deployDir: string;
  candidateDir: string;
  backupDir: string;
}

export type HealthTier = 'process' | 'integration' | 'end-to-end';

export interface HealthCheckOutcome {
  tier: HealthTier;
  ok: boolean;
  details?: string;
}

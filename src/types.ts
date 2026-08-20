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
  runtime: 'node';
  managed: boolean;
  sourceDir: string;
  deployDir: string;
  validationCommand: string;
  testCommand: string;
  buildCommand?: string;
  healthCheck?: HealthCheckDefinition;
  backup?: BackupPolicy;
  plugins?: PluginReference[];
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
}

export interface DeploymentContext {
  sourceDir: string;
  deployDir: string;
  candidateDir: string;
  backupDir: string;
}

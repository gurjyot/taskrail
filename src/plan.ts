import type { AutomationPlugin, FrameworkManifest } from './types.js';
import { resolvePaths } from './config.js';

export interface PlanOutput {
  project: string;
  source: string;
  target: string;
  commands: { validation: string; test: string; build?: string };
  healthChecks: string[];
  plugins: string[];
  backupAction: string;
  systemActions: string[];
}

export function buildPlan(manifest: FrameworkManifest, plugins: AutomationPlugin[] = []): PlanOutput {
  const paths = resolvePaths(manifest);
  return {
    project: manifest.name,
    source: paths.sourceDir,
    target: paths.deployDir,
    commands: { validation: manifest.validationCommand, test: manifest.testCommand, build: manifest.buildCommand },
    healthChecks: [manifest.healthCheck, ...(manifest.healthChecks ?? [])].filter(Boolean).map((h) => JSON.stringify(h)),
    plugins: plugins.map((p) => p.name),
    backupAction: 'create release snapshot and backup current healthy release',
    systemActions: ['no production changes', 'no service restarts', 'no rollback unless explicitly requested'],
  };
}

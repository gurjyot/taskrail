import { isCompatible } from './config.js';
import { getComponent } from './component-registry.js';
import { TASKRAIL_VERSION } from './version.js';
import type { FrameworkManifest } from './types.js';

export const TASKRAIL_ECOSYSTEM_CONTRACT = 1 as const;
export type EcosystemRepositoryRole = 'core' | 'hub' | 'automations';

export interface EcosystemCheckResult {
  ok: boolean;
  contract: typeof TASKRAIL_ECOSYSTEM_CONTRACT;
  errors: string[];
  warnings: string[];
}

export interface HubCapabilityPublication {
  name: string;
  version: string;
  taskrailCompatibility: string;
  description: string;
  purpose: string;
  domain: string;
  operations: string[];
  components: string[];
  status?: 'active' | 'deprecated' | 'superseded';
  supersededBy?: string;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonEmpty);
}

export function validateHubCapabilityPublication(value: unknown, taskrailVersion = TASKRAIL_VERSION): EcosystemCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const raw = value as Partial<HubCapabilityPublication> | null;
  if (!raw || typeof raw !== 'object') return { ok: false, contract: TASKRAIL_ECOSYSTEM_CONTRACT, errors: ['capability publication must be an object'], warnings };

  for (const field of ['name', 'version', 'taskrailCompatibility', 'description', 'purpose', 'domain'] as const) {
    if (!nonEmpty(raw[field])) errors.push(`${field} is required`);
  }
  if (nonEmpty(raw.taskrailCompatibility) && !isCompatible(taskrailVersion, raw.taskrailCompatibility)) {
    errors.push(`TaskRail ${taskrailVersion} does not satisfy ${raw.taskrailCompatibility}`);
  }
  if (!stringArray(raw.operations) || !raw.operations.length) errors.push('operations must contain at least one operation');
  if (!Array.isArray(raw.components)) errors.push('components must be an array');
  else {
    const unknown = raw.components.filter((item) => !nonEmpty(item) || !getComponent(item));
    if (unknown.length) errors.push(`unknown TaskRail components: ${unknown.join(', ')}`);
  }
  if (raw.status === 'superseded' && !nonEmpty(raw.supersededBy)) errors.push('superseded capability requires supersededBy');
  if (!raw.components?.length) warnings.push('capability declares no TaskRail components; verify that it is genuinely integration-only');
  return { ok: errors.length === 0, contract: TASKRAIL_ECOSYSTEM_CONTRACT, errors, warnings };
}

export function validateAutomationPublication(manifest: FrameworkManifest, taskrailVersion = TASKRAIL_VERSION): EcosystemCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!manifest.name?.trim()) errors.push('automation name is required');
  if (!manifest.managed) errors.push('published reference automation must be TaskRail-managed');
  if (!manifest.taskrailCompatibility) errors.push('taskrailCompatibility is required for published automations');
  else if (!isCompatible(taskrailVersion, manifest.taskrailCompatibility)) errors.push(`TaskRail ${taskrailVersion} does not satisfy ${manifest.taskrailCompatibility}`);
  if (!manifest.sourceDir?.trim()) errors.push('sourceDir is required');
  if (!manifest.deployDir?.trim()) errors.push('deployDir is required');
  if (!manifest.validationCommand?.trim()) errors.push('validationCommand is required');
  if (!manifest.testCommand?.trim()) errors.push('testCommand is required');
  if (!manifest.healthCheck && !manifest.healthChecks?.length && !manifest.healthCommand && !manifest.runtimeHealthCommand) {
    errors.push('published reference automation requires a health contract');
  }
  if (!manifest.profile) warnings.push('published automation has no profile; verify that explicit manifest settings are intentional');
  return { ok: errors.length === 0, contract: TASKRAIL_ECOSYSTEM_CONTRACT, errors, warnings };
}

export function ecosystemRepositoryRules(role: EcosystemRepositoryRole) {
  if (role === 'core') return {
    role,
    owns: ['components', 'public-sdk', 'lifecycle', 'safety', 'compatibility', 'skills'],
    mustNotOwn: ['community-capability-catalog', 'reference-automation-catalog'],
  };
  if (role === 'hub') return {
    role,
    owns: ['governed-capabilities'],
    mustNotOwn: ['taskrail-core-components', 'automation-business-workflows'],
  };
  return {
    role,
    owns: ['reference-automations'],
    mustNotOwn: ['taskrail-core-components', 'canonical-capability-implementations'],
  };
}

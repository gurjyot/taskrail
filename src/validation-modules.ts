import type { FrameworkConfig } from './types.js';
import { validateConfig } from './validation.js';
import { ValidationRegistry, validationModule } from './validation-registry.js';

export interface TaskRailValidationInput {
  config?: FrameworkConfig;
  checksumValid?: boolean;
  rollbackReady?: boolean;
  dependenciesCompatible?: boolean;
  rebootReady?: boolean;
}

export function createTaskRailValidationRegistry() {
  return new ValidationRegistry()
    .register(validationModule<TaskRailValidationInput>({
      id: 'manifest.config',
      version: '1',
      description: 'Validate the TaskRail automation manifest contract.',
      contexts: ['install', 'update', 'deploy', 'certification'],
      tags: ['manifest', 'baseline'],
      validate: ({ config }) => !config ? [] : validateConfig(config).map((message) => ({
        module: 'manifest.config', code: 'manifest-invalid', severity: 'error' as const, message,
      })),
    }))
    .register(validationModule<TaskRailValidationInput>({
      id: 'artifact.checksum',
      version: '1',
      description: 'Require verified artifact integrity when a checksum result is supplied.',
      contexts: ['install', 'update', 'certification'],
      tags: ['integrity', 'baseline'],
      validate: ({ checksumValid }) => checksumValid === false ? [{
        module: 'artifact.checksum', code: 'checksum-invalid', severity: 'error', message: 'artifact checksum verification failed',
      }] : [],
    }))
    .register(validationModule<TaskRailValidationInput>({
      id: 'dependency.compatibility',
      version: '1',
      description: 'Require component/capability compatibility before activation.',
      contexts: ['update', 'deploy', 'certification'],
      tags: ['compatibility', 'baseline'],
      dependsOn: ['manifest.config'],
      validate: ({ dependenciesCompatible }) => dependenciesCompatible === false ? [{
        module: 'dependency.compatibility', code: 'dependency-incompatible', severity: 'error', message: 'shared dependency compatibility check failed',
      }] : [],
    }))
    .register(validationModule<TaskRailValidationInput>({
      id: 'rollback.readiness',
      version: '1',
      description: 'Require a verified recovery path before an update/deploy is activated.',
      contexts: ['update', 'deploy', 'rollback', 'certification'],
      tags: ['recovery', 'baseline'],
      validate: ({ rollbackReady }) => rollbackReady === false ? [{
        module: 'rollback.readiness', code: 'rollback-not-ready', severity: 'error', message: 'rollback/recovery readiness check failed',
      }] : [],
    }))
    .register(validationModule<TaskRailValidationInput>({
      id: 'reboot.readiness',
      version: '1',
      description: 'Verify managed automation startup state is safe across host reboot.',
      contexts: ['runtime', 'certification'],
      tags: ['reboot', 'resilience'],
      validate: ({ rebootReady }) => rebootReady === false ? [{
        module: 'reboot.readiness', code: 'reboot-not-ready', severity: 'error', message: 'one or more managed automations are not reboot-ready',
      }] : [],
    }));
}

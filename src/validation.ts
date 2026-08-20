import type { FrameworkConfig } from './types.js';

export function validateConfig(config: FrameworkConfig): string[] {
  const errors: string[] = [];
  if (!config.projectName) errors.push('projectName is required');
  if (!config.manifest.name) errors.push('manifest.name is required');
  if (config.manifest.runtime !== 'node') errors.push('runtime must be node');
  if (!config.manifest.sourceDir) errors.push('manifest.sourceDir is required');
  if (!config.manifest.deployDir) errors.push('manifest.deployDir is required');
  if (!config.manifest.validationCommand) errors.push('manifest.validationCommand is required');
  if (!config.manifest.testCommand) errors.push('manifest.testCommand is required');
  if (config.manifest.requiredChecks && !config.manifest.requiredChecks.every((check) => ['validation', 'test', 'build', 'health', 'drift'].includes(check))) errors.push('manifest.requiredChecks contains an unsupported value');
  if (config.manifest.protectedPaths && !config.manifest.protectedPaths.every((p) => typeof p === 'string' && p.trim().length > 0)) errors.push('manifest.protectedPaths must contain non-empty strings');
  return errors;
}

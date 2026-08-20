import type { FrameworkConfig } from './types.js';

const allowedChecks = new Set(['validation', 'test', 'build', 'health', 'drift']);

export function validateConfig(config: FrameworkConfig): string[] {
  const errors: string[] = [];
  if (!config.projectName) errors.push('projectName is required');
  if (!config.manifest.name) errors.push('manifest.name is required');
  if (config.manifest.runtime !== 'node') errors.push('runtime must be node');
  if (!config.manifest.sourceDir) errors.push('manifest.sourceDir is required');
  if (!config.manifest.deployDir) errors.push('manifest.deployDir is required');
  if (!config.manifest.validationCommand) errors.push('manifest.validationCommand is required');
  if (!config.manifest.testCommand) errors.push('manifest.testCommand is required');
  if (config.manifest.requiredChecks && !config.manifest.requiredChecks.every((check) => allowedChecks.has(check))) errors.push('manifest.requiredChecks contains an unsupported value');
  if (config.manifest.protectedPaths && !config.manifest.protectedPaths.every((p) => typeof p === 'string' && p.trim().length > 0)) errors.push('manifest.protectedPaths must contain non-empty strings');
  if (config.manifest.backup && (!Number.isInteger(config.manifest.backup.retain) || config.manifest.backup.retain < 0)) errors.push('manifest.backup.retain must be a non-negative integer');
  return errors;
}

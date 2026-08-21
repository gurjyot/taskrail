import type { FrameworkConfig } from './types.js';

const allowedChecks = new Set(['validation', 'test', 'build', 'health', 'drift', 'migrate']);

export function validateConfig(config: FrameworkConfig): string[] {
  const errors: string[] = [];
  if (!config.projectName) errors.push('projectName is required');
  if (!config.manifest.name) errors.push('manifest.name is required');
  if (!['node', 'python', 'shell'].includes(config.manifest.runtime)) errors.push('runtime must be node, python, or shell');
  if (!config.manifest.sourceDir) errors.push('manifest.sourceDir is required');
  if (!config.manifest.deployDir) errors.push('manifest.deployDir is required');
  if (!config.manifest.validationCommand) errors.push('manifest.validationCommand is required');
  if (!config.manifest.testCommand) errors.push('manifest.testCommand is required');
  if (config.manifest.requiredChecks && !config.manifest.requiredChecks.every((check) => allowedChecks.has(check))) errors.push('manifest.requiredChecks contains an unsupported value');
  if (config.manifest.protectedPaths && !config.manifest.protectedPaths.every((p) => typeof p === 'string' && p.trim().length > 0)) errors.push('manifest.protectedPaths must contain non-empty strings');
  if (config.manifest.capabilities && !config.manifest.capabilities.every((cap) => typeof cap === 'string' && cap.trim().length > 0)) errors.push('manifest.capabilities must contain non-empty strings');
  if (config.manifest.capabilityRoots && !config.manifest.capabilityRoots.every((root) => typeof root === 'string' && root.trim().length > 0)) errors.push('manifest.capabilityRoots must contain non-empty strings');
  if ('requiredFiles' in (config.manifest as any)) errors.push('manifest.requiredFiles is not supported; use manifest.requiredSharedFiles');
  if (config.manifest.requiredSharedFiles && !config.manifest.requiredSharedFiles.every((file) => (typeof file === 'string' && file.trim().length > 0) || (typeof file === 'object' && typeof file.path === 'string' && file.path.trim().length > 0))) errors.push('manifest.requiredSharedFiles must contain non-empty paths');
  if (config.manifest.backup && (!Number.isInteger(config.manifest.backup.retain) || config.manifest.backup.retain < 0)) errors.push('manifest.backup.retain must be a non-negative integer');
  if (config.manifest.deployStrategy?.type && !['replace-in-place', 'release-symlink'].includes(config.manifest.deployStrategy.type)) errors.push('manifest.deployStrategy.type is invalid');
  if (config.manifest.migrations?.destructive && !config.manifest.migrations.applyCommand) errors.push('destructive migrations require migrations.applyCommand');
  if (config.manifest.serviceManager?.type && config.manifest.serviceManager.type !== 'systemd') errors.push('manifest.serviceManager.type must be systemd');
  return errors;
}

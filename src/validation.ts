import path from 'node:path';
import type { FrameworkConfig } from './types.js';

const allowedChecks = new Set(['validation', 'test', 'build', 'health', 'drift', 'migrate']);

function hasDuplicates(values: string[]) {
  return new Set(values).size !== values.length;
}

function validateHealthDefinition(definition: unknown, label: string, errors: string[]) {
  if (!definition || typeof definition !== 'object') {
    errors.push(`${label} must be an object`);
    return;
  }
  const value = definition as Record<string, unknown>;
  if (value.type === 'command') {
    if (typeof value.command !== 'string' || !value.command.trim()) errors.push(`${label}.command must be a non-empty string`);
    return;
  }
  if (value.type === 'file') {
    if (typeof value.path !== 'string' || !value.path.trim()) errors.push(`${label}.path must be a non-empty string`);
    return;
  }
  if (value.type === 'http') {
    if (typeof value.url !== 'string' || !value.url.trim()) errors.push(`${label}.url must be a non-empty URL`);
    else {
      try {
        const parsed = new URL(value.url);
        if (!['http:', 'https:'].includes(parsed.protocol)) errors.push(`${label}.url must use http or https`);
      } catch {
        errors.push(`${label}.url must be a valid URL`);
      }
    }
    if (value.expectStatus !== undefined && (!Number.isInteger(value.expectStatus) || Number(value.expectStatus) < 100 || Number(value.expectStatus) > 599)) errors.push(`${label}.expectStatus must be an integer from 100 to 599`);
    return;
  }
  errors.push(`${label}.type must be command, file, or http`);
}

export function validateConfig(config: FrameworkConfig): string[] {
  const errors: string[] = [];
  if (!config.projectName) errors.push('projectName is required');
  if (!config.manifest.name) errors.push('manifest.name is required');
  if (!['node', 'python', 'shell', 'php'].includes(config.manifest.runtime)) errors.push('runtime must be node, python, shell, or php');
  if (!config.manifest.sourceDir) errors.push('manifest.sourceDir is required');
  if (!config.manifest.deployDir) errors.push('manifest.deployDir is required');
  if (!config.manifest.validationCommand) errors.push('manifest.validationCommand is required');
  if (!config.manifest.testCommand) errors.push('manifest.testCommand is required');
  const rawManifest = config.manifest as any;
  if (rawManifest.healthCheck && Array.isArray(rawManifest.healthChecks) && rawManifest.healthChecks.length) errors.push('manifest must use healthCheck or healthChecks, not both');
  if (rawManifest.healthChecks !== undefined && !Array.isArray(rawManifest.healthChecks)) errors.push('manifest.healthChecks must be an array');
  if (rawManifest.healthCheck !== undefined) validateHealthDefinition(rawManifest.healthCheck, 'manifest.healthCheck', errors);
  if (Array.isArray(rawManifest.healthChecks)) rawManifest.healthChecks.forEach((item: unknown, index: number) => validateHealthDefinition(item, `manifest.healthChecks[${index}]`, errors));
  if (config.manifest.requiredChecks && !config.manifest.requiredChecks.every((check) => allowedChecks.has(check))) errors.push('manifest.requiredChecks contains an unsupported value');
  if (config.manifest.requiredChecks?.includes('build') && !config.manifest.buildCommand?.trim()) errors.push('required build check requires manifest.buildCommand');
  if (config.manifest.requiredChecks?.includes('migrate') && !config.manifest.migrations?.checkCommand?.trim()) errors.push('required migrate check requires manifest.migrations.checkCommand');
  if (config.manifest.protectedPaths && !config.manifest.protectedPaths.every((p) => typeof p === 'string' && p.trim().length > 0)) errors.push('manifest.protectedPaths must contain non-empty strings');
  if (config.manifest.components && !config.manifest.components.every((component) => typeof component === 'string' && component.trim().length > 0)) errors.push('manifest.components must contain non-empty strings');
  if (config.manifest.components && hasDuplicates(config.manifest.components)) errors.push('manifest.components must not contain duplicates');
  if (config.manifest.capabilities && !config.manifest.capabilities.every((cap) => typeof cap === 'string' && cap.trim().length > 0)) errors.push('manifest.capabilities must contain non-empty strings');
  if (config.manifest.capabilities && hasDuplicates(config.manifest.capabilities)) errors.push('manifest.capabilities must not contain duplicates');
  if (config.manifest.capabilityRoots && !config.manifest.capabilityRoots.every((root) => typeof root === 'string' && root.trim().length > 0)) errors.push('manifest.capabilityRoots must contain non-empty strings');
  if (config.manifest.plugins && config.manifest.plugins.length > 1) errors.push('manifest.plugins supports at most one operational plugin');
  if ('requiredFiles' in (config.manifest as any)) errors.push('manifest.requiredFiles is not supported; use manifest.requiredSharedFiles');
  if (config.manifest.requiredSharedFiles && !config.manifest.requiredSharedFiles.every((file) => (typeof file === 'string' && file.trim().length > 0) || (typeof file === 'object' && typeof file.path === 'string' && file.path.trim().length > 0))) errors.push('manifest.requiredSharedFiles must contain non-empty paths');
  if (config.manifest.backup && (!Number.isInteger(config.manifest.backup.retain) || config.manifest.backup.retain < 0)) errors.push('manifest.backup.retain must be a non-negative integer');
  if (config.manifest.deployStrategy?.type && !['replace-in-place', 'release-symlink'].includes(config.manifest.deployStrategy.type)) errors.push('manifest.deployStrategy.type is invalid');
  if (config.manifest.migrations?.destructive && !config.manifest.migrations.applyCommand) errors.push('destructive migrations require migrations.applyCommand');
  if (config.manifest.serviceManager?.type && config.manifest.serviceManager.type !== 'systemd') errors.push('manifest.serviceManager.type must be systemd');
  for (const unit of config.manifest.serviceManager?.units ?? []) {
    if (unit.staleAfterMs !== undefined && (!Number.isInteger(unit.staleAfterMs) || unit.staleAfterMs <= 0)) errors.push(`service unit ${unit.name} staleAfterMs must be a positive integer`);
  }

  const execution = config.manifest.execution;
  if (execution?.timeoutMs !== undefined && (!Number.isInteger(execution.timeoutMs) || execution.timeoutMs <= 0)) errors.push('manifest.execution.timeoutMs must be a positive integer');
  if (execution?.maxConcurrency !== undefined && (!Number.isInteger(execution.maxConcurrency) || execution.maxConcurrency < 1)) errors.push('manifest.execution.maxConcurrency must be an integer >= 1');
  if (execution?.staleAfterMs !== undefined && (!Number.isInteger(execution.staleAfterMs) || execution.staleAfterMs <= 0)) errors.push('manifest.execution.staleAfterMs must be a positive integer');
  if (execution?.retry?.maxAttempts !== undefined && (!Number.isInteger(execution.retry.maxAttempts) || execution.retry.maxAttempts < 1)) errors.push('manifest.execution.retry.maxAttempts must be an integer >= 1');
  if (execution?.retry?.baseDelayMs !== undefined && (!Number.isInteger(execution.retry.baseDelayMs) || execution.retry.baseDelayMs < 0)) errors.push('manifest.execution.retry.baseDelayMs must be a non-negative integer');
  if (execution?.retry?.maxDelayMs !== undefined && (!Number.isInteger(execution.retry.maxDelayMs) || execution.retry.maxDelayMs < 0)) errors.push('manifest.execution.retry.maxDelayMs must be a non-negative integer');
  if (execution?.retry?.baseDelayMs !== undefined && execution?.retry?.maxDelayMs !== undefined && execution.retry.maxDelayMs < execution.retry.baseDelayMs) errors.push('manifest.execution.retry.maxDelayMs must be >= baseDelayMs');

  const resources = config.manifest.resources;
  if (resources?.memoryMaxMb !== undefined && (!Number.isInteger(resources.memoryMaxMb) || resources.memoryMaxMb < 32)) errors.push('manifest.resources.memoryMaxMb must be an integer >= 32');
  if (resources?.cpuQuotaPercent !== undefined && (!Number.isFinite(resources.cpuQuotaPercent) || resources.cpuQuotaPercent <= 0 || resources.cpuQuotaPercent > 1000)) errors.push('manifest.resources.cpuQuotaPercent must be > 0 and <= 1000');
  if (resources?.tasksMax !== undefined && (!Number.isInteger(resources.tasksMax) || resources.tasksMax < 1)) errors.push('manifest.resources.tasksMax must be an integer >= 1');
  if (resources?.nice !== undefined && (!Number.isInteger(resources.nice) || resources.nice < -20 || resources.nice > 19)) errors.push('manifest.resources.nice must be between -20 and 19');

  const isolation = config.manifest.isolation;
  if (isolation?.level && !['standard', 'strict'].includes(isolation.level)) errors.push('manifest.isolation.level must be standard or strict');
  if (isolation?.writablePaths && !isolation.writablePaths.every((value) => typeof value === 'string' && value.trim().length > 0)) errors.push('manifest.isolation.writablePaths must contain non-empty strings');
  if (isolation?.writablePaths && hasDuplicates(isolation.writablePaths)) errors.push('manifest.isolation.writablePaths must not contain duplicates');
  if (isolation?.level === 'strict') {
    if (config.manifest.statePath && !path.isAbsolute(config.manifest.statePath)) errors.push('strict isolation requires an absolute manifest.statePath');
    if ((isolation.writablePaths ?? []).some((value) => !path.isAbsolute(value))) errors.push('strict isolation requires absolute isolation.writablePaths');
  }

  return errors;
}

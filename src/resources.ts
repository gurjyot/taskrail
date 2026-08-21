import type { ResourcePolicy } from './types.js';

export interface SystemdResourceDirectives {
  MemoryMax?: string;
  CPUQuota?: string;
  TasksMax?: string;
  Nice?: string;
}

export function systemdResourceDirectives(policy?: ResourcePolicy): SystemdResourceDirectives {
  if (!policy) return {};
  const directives: SystemdResourceDirectives = {};
  if (policy.memoryMaxMb !== undefined) directives.MemoryMax = `${policy.memoryMaxMb}M`;
  if (policy.cpuQuotaPercent !== undefined) directives.CPUQuota = `${policy.cpuQuotaPercent}%`;
  if (policy.tasksMax !== undefined) directives.TasksMax = String(policy.tasksMax);
  if (policy.nice !== undefined) directives.Nice = String(policy.nice);
  return directives;
}

export function renderSystemdResourceBlock(policy?: ResourcePolicy) {
  const directives = systemdResourceDirectives(policy);
  return Object.entries(directives).map(([key, value]) => `${key}=${value}`).join('\n');
}

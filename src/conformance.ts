import path from 'node:path';
import type { FrameworkConfig, FrameworkManifest } from './types.js';
import { discoverAutomationManifests } from './capabilities.js';
import { validateConfig } from './validation.js';
import { buildUsageGraph } from './usage-graph.js';
import { auditFleetIsolation } from './isolation-audit.js';
import { effectiveExecutionPolicy } from './execution.js';
import { loadResolvedManifest } from './config.js';

export const TASKRAIL_ENGINEERING_STANDARD = '1';

export type ConformanceSeverity = 'error' | 'warning' | 'info';

export interface ConformanceFinding {
  rule: string;
  severity: ConformanceSeverity;
  automation?: string;
  message: string;
  deduction: number;
}

export interface ConformanceReport {
  ok: boolean;
  standard: string;
  score: number;
  automations: number;
  findings: ConformanceFinding[];
  summary: { errors: number; warnings: number; info: number };
}

function finding(rule: string, severity: ConformanceSeverity, message: string, automation?: string, deduction?: number): ConformanceFinding {
  return {
    rule,
    severity,
    automation,
    message,
    deduction: deduction ?? (severity === 'error' ? 25 : severity === 'warning' ? 5 : 0),
  };
}

export async function evaluateConformance(cwd = process.cwd()): Promise<ConformanceReport> {
  const findings: ConformanceFinding[] = [];
  const graph = await buildUsageGraph(cwd);
  const isolation = await auditFleetIsolation(cwd);
  const manifestPaths = await discoverAutomationManifests(cwd);
  const seen = new Set<string>();
  const seenUnits = new Map<string, string>();
  let automationCount = 0;

  for (const error of graph.errors) findings.push(finding('dependency-graph-integrity', 'error', error));
  for (const conflict of isolation.conflicts) {
    findings.push(finding(
      'managed-root-isolation',
      'error',
      `${conflict.left.automation} ${conflict.left.kind} root conflicts with ${conflict.right.automation} ${conflict.right.kind} root (${conflict.reason})`,
    ));
  }
  for (const error of isolation.errors) findings.push(finding('isolation-audit', 'error', error));

  for (const manifestPath of manifestPaths) {
    let resolved: FrameworkManifest;
    try {
      resolved = await loadResolvedManifest(manifestPath);
    } catch (error) {
      findings.push(finding('manifest-resolution', 'error', error instanceof Error ? error.message : String(error), manifestPath));
      continue;
    }
    if (!resolved.managed) continue;
    if (seen.has(resolved.name)) {
      findings.push(finding('duplicate-automation-name', 'error', `duplicate automation name: ${resolved.name}`, resolved.name));
      continue;
    }
    seen.add(resolved.name);
    automationCount += 1;
    const projectRoot = path.dirname(manifestPath);
    const config: FrameworkConfig = { projectName: resolved.name, environment: process.env, manifest: resolved };
    for (const error of validateConfig(config)) findings.push(finding('manifest-validity', 'error', error, resolved.name));
    for (const unit of resolved.serviceManager?.units ?? []) {
      const owner = seenUnits.get(unit.name);
      if (owner && owner !== resolved.name) findings.push(finding('duplicate-systemd-unit', 'error', `${unit.name} is declared by ${owner} and ${resolved.name}`, resolved.name));
      else seenUnits.set(unit.name, resolved.name);
    }

    const execution = effectiveExecutionPolicy(resolved.execution);
    const retryAttempts = execution.retry.maxAttempts ?? 3;
    if (execution.timeoutMs > 3_600_000) findings.push(finding('bounded-timeout', 'warning', `execution timeout is unusually high: ${execution.timeoutMs}ms`, resolved.name));
    if (execution.maxConcurrency > 64) findings.push(finding('bounded-concurrency', 'warning', `max concurrency is unusually high: ${execution.maxConcurrency}`, resolved.name));
    if (retryAttempts > 8) findings.push(finding('bounded-retry', 'warning', `retry attempts are unusually high: ${retryAttempts}`, resolved.name));

    const hasHealth = Boolean(resolved.healthCheck || resolved.healthChecks?.length || resolved.healthCommand || resolved.runtimeHealthCommand);
    if (!hasHealth) findings.push(finding('health-required', 'error', 'managed automation has no health probe', resolved.name));

    if (resolved.serviceManager?.type === 'systemd') {
      if (!resolved.resources?.memoryMaxMb) findings.push(finding('memory-budget', 'warning', 'systemd automation has no memory ceiling', resolved.name));
      if (!resolved.resources?.cpuQuotaPercent) findings.push(finding('cpu-budget', 'warning', 'systemd automation has no CPU ceiling', resolved.name));
      if (!resolved.resources?.tasksMax) findings.push(finding('task-budget', 'warning', 'systemd automation has no child-task ceiling', resolved.name));
      if (resolved.isolation?.level !== 'strict') findings.push(finding('strict-isolation', 'warning', 'systemd automation has not opted into strict filesystem isolation', resolved.name, 3));
    }

    if ((resolved.capabilities ?? []).length === 0 && (resolved.components ?? []).length === 0) {
      findings.push(finding('composition-declaration', 'info', 'automation declares no reusable components or capabilities', resolved.name, 0));
    }

    if (resolved.migrations?.destructive) findings.push(finding('destructive-migration', 'warning', 'destructive migration requires an explicit recovery compatibility decision before activation', resolved.name, 8));

    if (projectRoot.includes(`${path.sep}.taskrail${path.sep}`)) findings.push(finding('source-placement', 'warning', 'automation source is stored inside a TaskRail generated directory', resolved.name));
  }

  const errors = findings.filter((item) => item.severity === 'error').length;
  const warnings = findings.filter((item) => item.severity === 'warning').length;
  const info = findings.filter((item) => item.severity === 'info').length;
  const score = Math.max(0, 100 - findings.reduce((sum, item) => sum + item.deduction, 0));
  return {
    ok: errors === 0,
    standard: TASKRAIL_ENGINEERING_STANDARD,
    score,
    automations: automationCount,
    findings: findings.sort((a, b) => `${a.severity}:${a.automation ?? ''}:${a.rule}`.localeCompare(`${b.severity}:${b.automation ?? ''}:${b.rule}`)),
    summary: { errors, warnings, info },
  };
}

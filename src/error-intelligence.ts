import type { DiagnosticReport } from './diagnostics.js';
import { validateDiagnosticReport } from './diagnostics.js';

export interface DiagnosticGroup {
  fingerprint: string;
  occurrences: number;
  severity: DiagnosticReport['severity'];
  code: string;
  stage: string;
  taskrailVersions: string[];
  platforms: string[];
  firstSeen: string;
  lastSeen: string;
}

const severityRank: Record<DiagnosticReport['severity'], number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
};

export function groupDiagnostics(reports: DiagnosticReport[]): DiagnosticGroup[] {
  const groups = new Map<string, DiagnosticGroup>();
  for (const report of reports) {
    const validation = validateDiagnosticReport(report);
    if (!validation.ok) continue;
    const existing = groups.get(report.fingerprint);
    if (!existing) {
      groups.set(report.fingerprint, {
        fingerprint: report.fingerprint,
        occurrences: 1,
        severity: report.severity,
        code: report.code,
        stage: report.stage,
        taskrailVersions: [report.taskrailVersion],
        platforms: [report.platform],
        firstSeen: report.createdAt,
        lastSeen: report.createdAt,
      });
      continue;
    }
    existing.occurrences += 1;
    if (severityRank[report.severity] > severityRank[existing.severity]) existing.severity = report.severity;
    if (!existing.taskrailVersions.includes(report.taskrailVersion)) existing.taskrailVersions.push(report.taskrailVersion);
    if (!existing.platforms.includes(report.platform)) existing.platforms.push(report.platform);
    if (report.createdAt < existing.firstSeen) existing.firstSeen = report.createdAt;
    if (report.createdAt > existing.lastSeen) existing.lastSeen = report.createdAt;
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      taskrailVersions: group.taskrailVersions.sort(),
      platforms: group.platforms.sort(),
    }))
    .sort((a, b) => severityRank[b.severity] - severityRank[a.severity] || b.occurrences - a.occurrences || a.fingerprint.localeCompare(b.fingerprint));
}

export function diagnosticIssueKey(group: DiagnosticGroup) {
  return `taskrail-diagnostic:${group.fingerprint}`;
}

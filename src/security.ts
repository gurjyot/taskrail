import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const secretPatterns = [
  /api[_-]?key\s*[:=]\s*[^\s,;]+/i,
  /(?:access|refresh|auth)?[_-]?token\s*[:=]\s*[^\s,;]+/i,
  /password\s*[:=]\s*[^\s,;]+/i,
  /bearer\s+[A-Za-z0-9._~+\/-]{16,}=*/i,
  /bot[a-z0-9]{6,}:[A-Za-z0-9_-]{20,}/i,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
  /postgres(?:ql)?:\/\/[^\s]+:[^\s]+@/i,
  /mysql:\/\/[^\s]+:[^\s]+@/i,
];

const sourceWarnings: Array<{ code: string; pattern: RegExp; message: string }> = [
  { code: 'shell-exec', pattern: /\bexec(?:Sync)?\s*\(/, message: 'direct shell execution detected; prefer argument-safe spawn/execFile APIs' },
  { code: 'shell-true', pattern: /shell\s*:\s*true/, message: 'shell-enabled process execution expands command-injection risk' },
  { code: 'sql-interpolation', pattern: /(?:SELECT|INSERT|UPDATE|DELETE)[\s\S]{0,160}\$\{|(?:query|execute)\s*\(\s*`[^`]*\$\{/i, message: 'possible interpolated SQL; use parameterized queries' },
  { code: 'eval', pattern: /\beval\s*\(|new\s+Function\s*\(/, message: 'dynamic code evaluation detected' },
  { code: 'insecure-http-listen', pattern: /listen\s*\(\s*(?:80|8080|3000)\b/, message: 'network listener detected; TaskRail core should not expose a network service by default' },
];

export interface SecurityFinding {
  code: string;
  severity: 'warning' | 'error';
  file: string;
  message: string;
}

export interface SecurityAuditResult {
  ok: boolean;
  findings: SecurityFinding[];
}

export async function scanForSecrets(files: string[]): Promise<string[]> {
  const hits: string[] = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8').catch(() => '');
    if (text.includes('=.env')) hits.push(`${file}: embedded env reference`);
    for (const pattern of secretPatterns) if (pattern.test(text)) hits.push(`${file}: likely secret pattern`);
  }
  return hits;
}

export async function auditSourceSecurity(files: string[], strict = false): Promise<SecurityAuditResult> {
  const findings: SecurityFinding[] = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8').catch(() => '');
    if (!text) continue;
    for (const pattern of secretPatterns) {
      if (pattern.test(text)) {
        findings.push({ code: 'secret-material', severity: 'error', file, message: 'likely secret material found in source' });
        break;
      }
    }
    for (const warning of sourceWarnings) {
      if (warning.pattern.test(text)) findings.push({ code: warning.code, severity: strict ? 'error' : 'warning', file, message: warning.message });
    }
  }
  return { ok: findings.every((finding) => finding.severity !== 'error'), findings };
}

export async function auditPrivateFile(file: string): Promise<SecurityFinding[]> {
  if (process.platform === 'win32') return [];
  try {
    const mode = (await stat(file)).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      return [{ code: 'state-permissions', severity: 'error', file: path.resolve(file), message: `private TaskRail state must not be group/world accessible (mode ${mode.toString(8)})` }];
    }
  } catch {
    return [];
  }
  return [];
}

export function securityPrinciples() {
  return {
    coreNetworkExposure: 'deny-by-default',
    externalAccess: 'authorized-automation-only',
    secrets: 'scoped-and-redacted',
    shellExecution: 'argument-safe-only',
    sql: 'parameterized-only',
    aiContent: 'untrusted-data-never-authority',
    diagnostics: 'local-preview-opt-in-submission',
  } as const;
}

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const secretValuePatterns = [
  /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|password|passwd|secret)\s*[:=]\s*["'`]([^"'`\s]{8,})["'`]/i,
  /authorization\s*[:=]\s*["'`]bearer\s+[A-Za-z0-9._~+\/-]{16,}=*["'`]/i,
  /bot[a-z0-9]{6,}:[A-Za-z0-9_-]{20,}/i,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
  /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/:]+:[^\s/@]+@/i,
];

const sourceWarnings: Array<{ code: string; test(text: string): boolean; message: string }> = [
  {
    code: 'shell-exec',
    test: (text) => /(?:^|[^A-Za-z0-9_])exec(?:Sync)?\s*\(/m.test(text),
    message: 'direct shell execution detected; prefer argument-safe spawn/execFile APIs',
  },
  {
    code: 'shell-true',
    test: (text) => /shell\s*:\s*true/.test(text),
    message: 'shell-enabled process execution expands command-injection risk',
  },
  {
    code: 'sql-interpolation',
    test: (text) => {
      const templates = text.match(/`(?:\\.|[^`])*`/gs) ?? [];
      return templates.some((template) => /\b(?:SELECT|INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i.test(template) && /\$\{/.test(template));
    },
    message: 'interpolated SQL template detected; use parameterized queries',
  },
  {
    code: 'eval',
    test: (text) => /(?:^|[^A-Za-z0-9_])eval\s*\(|new\s+Function\s*\(/m.test(text),
    message: 'dynamic code evaluation detected',
  },
  {
    code: 'insecure-http-listen',
    test: (text) => /\.listen\s*\(\s*(?:80|8080|3000)\b/.test(text),
    message: 'network listener detected; TaskRail core should not expose a network service by default',
  },
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

function containsSecretMaterial(text: string) {
  return secretValuePatterns.some((pattern) => pattern.test(text));
}

export async function scanForSecrets(files: string[]): Promise<string[]> {
  const hits: string[] = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8').catch(() => '');
    if (text.includes('=.env')) hits.push(`${file}: embedded env reference`);
    if (containsSecretMaterial(text)) hits.push(`${file}: likely secret material`);
  }
  return hits;
}

export async function auditSourceSecurity(files: string[], strict = false): Promise<SecurityAuditResult> {
  const findings: SecurityFinding[] = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8').catch(() => '');
    if (!text) continue;
    if (containsSecretMaterial(text)) {
      findings.push({ code: 'secret-material', severity: 'error', file, message: 'likely literal secret material found in source' });
    }
    for (const warning of sourceWarnings) {
      if (warning.test(text)) findings.push({ code: warning.code, severity: strict ? 'error' : 'warning', file, message: warning.message });
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

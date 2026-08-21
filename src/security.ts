import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { SecurityRegistry, securityControl } from './security-registry.js';

const secretValuePatterns = [
  /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|password|passwd|secret)\s*[:=]\s*["'`]([^"'`\s]{8,})["'`]/i,
  /authorization\s*[:=]\s*["'`]bearer\s+[A-Za-z0-9._~+\/-]{16,}=*["'`]/i,
  /bot[a-z0-9]{6,}:[A-Za-z0-9_-]{20,}/i,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
  /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/:]+:[^\s/@]+@/i,
];

function importsChildProcessExec(text: string) {
  const imports = text.match(/import\s*\{([^}]*)\}\s*from\s*["']node:child_process["']/gs) ?? [];
  return imports.some((entry) => /\bexec(?:Sync)?\b/.test(entry));
}

function callsImportedExec(text: string) {
  if (!importsChildProcessExec(text)) return false;
  return /(?:^|[^A-Za-z0-9_])exec(?:Sync)?\s*\(/m.test(text);
}

function containsInterpolatedSql(text: string) {
  const templates = text.match(/`(?:\\.|[^`])*`/gs) ?? [];
  return templates.some((template) => {
    if (!/\$\{/.test(template)) return false;
    const sql = template.slice(1, -1).trim();
    return /^(?:SELECT\b[\s\S]*\bFROM\b|INSERT\s+INTO\b|UPDATE\s+[A-Za-z0-9_."`]+\s+SET\b|DELETE\s+FROM\b|ALTER\s+TABLE\b|DROP\s+(?:TABLE|DATABASE)\b|CREATE\s+(?:TABLE|DATABASE)\b)/i.test(sql);
  });
}

export interface SecurityFinding {
  code: string;
  severity: 'warning' | 'error';
  file: string;
  message: string;
}

export interface SecurityAuditResult {
  ok: boolean;
  findings: SecurityFinding[];
  controls?: string[];
}

interface SourceEntry { file: string; text: string }
interface SourceAuditInput { entries: SourceEntry[] }

function containsSecretMaterial(text: string) {
  return secretValuePatterns.some((pattern) => pattern.test(text));
}

function sourceControl(id: string, message: string, test: (text: string) => boolean, severity: 'warning' | 'error' = 'warning') {
  return securityControl<SourceAuditInput>({
    id,
    version: '1',
    description: message,
    contexts: ['source'],
    tags: ['source-baseline'],
    evaluate: ({ entries }) => entries
      .filter((entry) => test(entry.text))
      .map((entry) => ({ control: id, code: id, severity, target: entry.file, message })),
  });
}

export function createSourceSecurityRegistry() {
  return new SecurityRegistry()
    .register(sourceControl('secret-material', 'likely literal secret material found in source', containsSecretMaterial, 'error'))
    .register(sourceControl('shell-exec', 'direct shell execution detected; prefer argument-safe spawn/execFile APIs', callsImportedExec))
    .register(sourceControl('shell-true', 'shell-enabled process execution expands command-injection risk', (text) => /shell\s*:\s*true/.test(text)))
    .register(sourceControl('sql-interpolation', 'interpolated SQL template detected; use parameterized queries', containsInterpolatedSql))
    .register(sourceControl('eval', 'dynamic code evaluation detected', (text) => /(?:^|[^A-Za-z0-9_])eval\s*\(|new\s+Function\s*\(/m.test(text)))
    .register(sourceControl('insecure-http-listen', 'network listener detected; TaskRail core should not expose a network service by default', (text) => /\.listen\s*\(\s*(?:80|8080|3000)\b/.test(text)));
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
  const entries: SourceEntry[] = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8').catch(() => '');
    if (text) entries.push({ file, text });
  }
  const report = await createSourceSecurityRegistry().run({ name: strict ? 'source-strict' : 'source', tags: ['source-baseline'], strict }, { entries });
  return {
    ok: report.ok,
    controls: report.controls,
    findings: report.findings.map((finding) => ({
      code: finding.code,
      severity: finding.severity,
      file: finding.target || '',
      message: finding.message,
    })),
  };
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
    controls: 'modular-versioned-profiled',
  } as const;
}

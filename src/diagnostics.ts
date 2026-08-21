import { createHash } from 'node:crypto';
import { TASKRAIL_VERSION } from './version.js';

export type DiagnosticSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface DiagnosticInput {
  code: string;
  severity: DiagnosticSeverity;
  stage: string;
  message: string;
  platform?: string;
  runtime?: string;
  taskrailVersion?: string;
  details?: unknown;
}

export interface DiagnosticReport {
  schema: 1;
  fingerprint: string;
  code: string;
  severity: DiagnosticSeverity;
  stage: string;
  message: string;
  platform: string;
  runtime: string;
  taskrailVersion: string;
  createdAt: string;
  details?: unknown;
  privacy: {
    networkSubmitted: false;
    secretsIncluded: false;
    businessPayloadIncluded: false;
    automationIdentityIncluded: false;
    filesystemPathsIncluded: false;
  };
}

const secretKey = /(password|passwd|secret|token|api[_-]?key|authorization|cookie|session|private[_-]?key|credential|connection[_-]?string)/i;
const secretText = [
  /bearer\s+[a-z0-9._~+\/-]+=*/gi,
  /(?:api[_-]?key|token|secret|password|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /https?:\/\/[^\s/@:]+:[^\s/@]+@/g,
  /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s]+/gi,
];
const identityText = [
  /\b[A-Z]:\\(?:[^\s\\]+\\)*[^\s\\]*/gi,
  /\/(?:home|Users|var|srv|opt|tmp)\/(?:[^\s/]+\/)*[^\s/]*/g,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/gi,
];

function redactString(value: string) {
  let result = value;
  for (const pattern of secretText) result = result.replace(pattern, '[REDACTED]');
  for (const pattern of identityText) result = result.replace(pattern, '[PRIVATE]');
  return result.slice(0, 4000);
}

export function sanitizeDiagnosticValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeDiagnosticValue(item, depth + 1));
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
      result[key] = secretKey.test(key) ? '[REDACTED]' : sanitizeDiagnosticValue(item, depth + 1);
    }
    return result;
  }
  return redactString(String(value));
}

export function createDiagnosticReport(input: DiagnosticInput): DiagnosticReport {
  const platform = input.platform || `${process.platform}-${process.arch}`;
  const taskrailVersion = input.taskrailVersion || TASKRAIL_VERSION;
  const stable = `${input.code}|${input.stage}|${platform}|${taskrailVersion}`;
  return {
    schema: 1,
    fingerprint: createHash('sha256').update(stable).digest('hex').slice(0, 20),
    code: redactString(input.code).slice(0, 120),
    severity: input.severity,
    stage: redactString(input.stage).slice(0, 120),
    message: redactString(input.message),
    platform,
    runtime: input.runtime || `node-${process.version}`,
    taskrailVersion,
    createdAt: new Date().toISOString(),
    details: input.details === undefined ? undefined : sanitizeDiagnosticValue(input.details),
    privacy: {
      networkSubmitted: false,
      secretsIncluded: false,
      businessPayloadIncluded: false,
      automationIdentityIncluded: false,
      filesystemPathsIncluded: false,
    },
  };
}

export function diagnosticSystemSummary() {
  return {
    platform: `${process.platform}-${process.arch}`,
    runtime: `node-${process.version}`,
  };
}

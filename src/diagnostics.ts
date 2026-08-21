import { createHash } from 'node:crypto';
import { TASKRAIL_VERSION } from './version.js';

export type DiagnosticSeverity = 'info' | 'warning' | 'error' | 'critical';
export const MAX_DIAGNOSTIC_BYTES = 16 * 1024;

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

export interface DiagnosticValidationResult {
  ok: boolean;
  bytes: number;
  errors: string[];
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
const reportKeys = new Set(['schema', 'fingerprint', 'code', 'severity', 'stage', 'message', 'platform', 'runtime', 'taskrailVersion', 'createdAt', 'details', 'privacy']);
const severityValues = new Set<DiagnosticSeverity>(['info', 'warning', 'error', 'critical']);

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
    platform: redactString(platform).slice(0, 120),
    runtime: redactString(input.runtime || `node-${process.version}`).slice(0, 120),
    taskrailVersion: redactString(taskrailVersion).slice(0, 80),
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

export function validateDiagnosticReport(value: unknown, maxBytes = MAX_DIAGNOSTIC_BYTES): DiagnosticValidationResult {
  const errors: string[] = [];
  let serialized = '';
  try {
    serialized = JSON.stringify(value);
  } catch {
    return { ok: false, bytes: 0, errors: ['diagnostic report is not JSON serializable'] };
  }
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > maxBytes) errors.push(`diagnostic report exceeds ${maxBytes} byte limit`);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, bytes, errors: [...errors, 'diagnostic report must be an object'] };
  const report = value as Record<string, any>;
  const unknown = Object.keys(report).filter((key) => !reportKeys.has(key));
  if (unknown.length) errors.push(`diagnostic report contains unsupported fields: ${unknown.sort().join(', ')}`);
  if (report.schema !== 1) errors.push('diagnostic schema must equal 1');
  if (typeof report.fingerprint !== 'string' || !/^[a-f0-9]{20}$/.test(report.fingerprint)) errors.push('diagnostic fingerprint is invalid');
  if (typeof report.code !== 'string' || !report.code || report.code.length > 120) errors.push('diagnostic code is invalid');
  if (!severityValues.has(report.severity)) errors.push('diagnostic severity is invalid');
  if (typeof report.stage !== 'string' || !report.stage || report.stage.length > 120) errors.push('diagnostic stage is invalid');
  if (typeof report.message !== 'string' || report.message.length > 4000) errors.push('diagnostic message is invalid');
  if (typeof report.platform !== 'string' || report.platform.length > 120) errors.push('diagnostic platform is invalid');
  if (typeof report.runtime !== 'string' || report.runtime.length > 120) errors.push('diagnostic runtime is invalid');
  if (typeof report.taskrailVersion !== 'string' || report.taskrailVersion.length > 80) errors.push('diagnostic TaskRail version is invalid');
  if (typeof report.createdAt !== 'string' || Number.isNaN(Date.parse(report.createdAt))) errors.push('diagnostic timestamp is invalid');
  const privacy = report.privacy;
  if (!privacy || typeof privacy !== 'object' || Object.values(privacy).some((flag) => flag !== false)) errors.push('diagnostic privacy flags must all be false');
  if (containsForbiddenDiagnosticText(serialized)) errors.push('diagnostic report still contains forbidden sensitive material');
  return { ok: errors.length === 0, bytes, errors };
}

function containsForbiddenDiagnosticText(text: string) {
  if (secretText.some((pattern) => { pattern.lastIndex = 0; return pattern.test(text); })) return true;
  if (identityText.some((pattern) => { pattern.lastIndex = 0; return pattern.test(text); })) return true;
  return false;
}

export function diagnosticSystemSummary() {
  return {
    platform: `${process.platform}-${process.arch}`,
    runtime: `node-${process.version}`,
  };
}

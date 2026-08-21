import { createHash, randomUUID } from 'node:crypto';
import { validateDiagnosticReport, type DiagnosticReport } from './diagnostics.js';

export const DIAGNOSTIC_INTAKE_SCHEMA = 1 as const;
export const MAX_DIAGNOSTIC_BATCH = 25;

export interface DiagnosticSubmissionEnvelope {
  schema: typeof DIAGNOSTIC_INTAKE_SCHEMA;
  submissionId: string;
  installation: string;
  createdAt: string;
  reports: DiagnosticReport[];
  privacy: {
    explicitOptIn: true;
    automaticSubmission: false;
    credentialsIncluded: false;
    businessPayloadIncluded: false;
  };
}

export interface DiagnosticSubmissionOptions {
  installationId: string;
  explicitOptIn: boolean;
  submissionId?: string;
  createdAt?: Date;
}

function anonymousInstallationId(value: string) {
  if (!value.trim()) throw new Error('installationId is required');
  return createHash('sha256').update(`taskrail-diagnostic-installation:${value}`).digest('hex').slice(0, 24);
}

export function createDiagnosticSubmissionEnvelope(
  reports: DiagnosticReport[],
  options: DiagnosticSubmissionOptions,
): DiagnosticSubmissionEnvelope {
  if (options.explicitOptIn !== true) throw new Error('diagnostic submission requires explicit opt-in');
  if (!Array.isArray(reports) || reports.length < 1) throw new Error('diagnostic submission requires at least one report');
  if (reports.length > MAX_DIAGNOSTIC_BATCH) throw new Error(`diagnostic submission exceeds ${MAX_DIAGNOSTIC_BATCH} report batch limit`);

  const validated = reports.map((report) => validateDiagnosticReport(report));
  const invalid = validated.findIndex((result) => !result.ok);
  if (invalid >= 0) throw new Error(`diagnostic report ${invalid} failed privacy validation: ${validated[invalid]?.errors.join('; ')}`);

  return {
    schema: DIAGNOSTIC_INTAKE_SCHEMA,
    submissionId: options.submissionId ?? randomUUID(),
    installation: anonymousInstallationId(options.installationId),
    createdAt: (options.createdAt ?? new Date()).toISOString(),
    reports: reports.map((report) => structuredClone(report)),
    privacy: {
      explicitOptIn: true,
      automaticSubmission: false,
      credentialsIncluded: false,
      businessPayloadIncluded: false,
    },
  };
}

export function validateDiagnosticSubmissionEnvelope(value: unknown) {
  const errors: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, errors: ['submission must be an object'] };
  const envelope = value as Partial<DiagnosticSubmissionEnvelope>;
  if (envelope.schema !== DIAGNOSTIC_INTAKE_SCHEMA) errors.push('submission schema is invalid');
  if (typeof envelope.submissionId !== 'string' || envelope.submissionId.length < 8 || envelope.submissionId.length > 100) errors.push('submissionId is invalid');
  if (typeof envelope.installation !== 'string' || !/^[a-f0-9]{24}$/.test(envelope.installation)) errors.push('anonymous installation identifier is invalid');
  if (typeof envelope.createdAt !== 'string' || Number.isNaN(Date.parse(envelope.createdAt))) errors.push('submission timestamp is invalid');
  if (!Array.isArray(envelope.reports) || envelope.reports.length < 1 || envelope.reports.length > MAX_DIAGNOSTIC_BATCH) {
    errors.push('submission report batch is invalid');
  } else {
    envelope.reports.forEach((report, index) => {
      const validation = validateDiagnosticReport(report);
      if (!validation.ok) errors.push(`report ${index} failed validation`);
    });
  }
  const privacy = envelope.privacy;
  if (!privacy || privacy.explicitOptIn !== true || privacy.automaticSubmission !== false || privacy.credentialsIncluded !== false || privacy.businessPayloadIncluded !== false) {
    errors.push('submission privacy contract is invalid');
  }
  return { ok: errors.length === 0, errors };
}

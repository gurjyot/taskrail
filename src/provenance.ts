import { createHash, createPublicKey, verify } from 'node:crypto';

export interface ProvenanceStatement {
  schema: 1;
  subject: string;
  version: string;
  sha256: string;
  source: string;
  issuedAt: string;
  signature?: string;
  keyId?: string;
}

export interface ProvenancePolicy {
  allowedSources: string[];
  trustedKeys?: Record<string, string>;
  requireSignature?: boolean;
}

export interface ProvenanceResult {
  ok: boolean;
  errors: string[];
}

export function sha256(data: string | Buffer) {
  return createHash('sha256').update(data).digest('hex');
}

export function provenancePayload(statement: ProvenanceStatement) {
  return JSON.stringify({
    schema: statement.schema,
    subject: statement.subject,
    version: statement.version,
    sha256: statement.sha256,
    source: statement.source,
    issuedAt: statement.issuedAt,
  });
}

export function verifyProvenance(statement: ProvenanceStatement, artifact: Buffer, policy: ProvenancePolicy): ProvenanceResult {
  const errors: string[] = [];
  if (statement.schema !== 1) errors.push('unsupported provenance schema');
  if (!/^[a-f0-9]{64}$/i.test(statement.sha256)) errors.push('invalid provenance sha256');
  if (sha256(artifact) !== statement.sha256.toLowerCase()) errors.push('artifact checksum does not match provenance');
  if (!policy.allowedSources.includes(statement.source)) errors.push('provenance source is not trusted');
  if (Number.isNaN(Date.parse(statement.issuedAt))) errors.push('invalid provenance timestamp');

  const requireSignature = policy.requireSignature ?? false;
  if (requireSignature && (!statement.signature || !statement.keyId)) errors.push('signed provenance is required');
  if (statement.signature || statement.keyId) {
    if (!statement.signature || !statement.keyId) errors.push('incomplete provenance signature metadata');
    else {
      const pem = policy.trustedKeys?.[statement.keyId];
      if (!pem) errors.push('provenance signing key is not trusted');
      else {
        try {
          const valid = verify(null, Buffer.from(provenancePayload(statement)), createPublicKey(pem), Buffer.from(statement.signature, 'base64'));
          if (!valid) errors.push('provenance signature is invalid');
        } catch {
          errors.push('provenance signature could not be verified');
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

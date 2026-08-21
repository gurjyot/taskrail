export type SecurityControl =
  | 'secret-redaction'
  | 'scoped-secrets'
  | 'no-open-listener'
  | 'untrusted-input-boundary'
  | 'sql-parameterization'
  | 'shell-argument-boundary'
  | 'private-state'
  | 'signed-provenance';

export interface SecurityPolicy {
  id: string;
  version: number;
  required: SecurityControl[];
}

export interface SecurityDeclaration {
  policyId: string;
  policyVersion: number;
  controls: SecurityControl[];
}

export const TASKRAIL_SECURITY_POLICY: SecurityPolicy = {
  id: 'taskrail-security',
  version: 1,
  required: [
    'secret-redaction',
    'scoped-secrets',
    'no-open-listener',
    'untrusted-input-boundary',
    'sql-parameterization',
    'shell-argument-boundary',
    'private-state',
  ],
};

export function assessSecurityDeclaration(
  declaration: SecurityDeclaration,
  policy: SecurityPolicy = TASKRAIL_SECURITY_POLICY,
) {
  const missing = policy.required.filter((control) => !declaration.controls.includes(control));
  const stale = declaration.policyId !== policy.id || declaration.policyVersion < policy.version;
  return {
    ok: !stale && missing.length === 0,
    stale,
    missing,
    requiredPolicy: `${policy.id}@${policy.version}`,
  };
}

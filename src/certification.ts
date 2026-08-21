export type CertificationGateName = 'core-ci' | 'package-golden-path' | 'installer-golden-path' | 'release-readiness' | 'fault-injection' | 'security-policy' | 'provenance' | 'compatibility' | 'mcp-adapter';

export interface CertificationGate {
  name: CertificationGateName;
  ok: boolean;
  required?: boolean;
  detail?: string;
}

export interface CertificationReport {
  certified: boolean;
  verdict: 'PASS' | 'FAIL';
  failed: CertificationGateName[];
  gates: CertificationGate[];
}

export function certifyTaskRail(gates: CertificationGate[]): CertificationReport {
  const normalized = gates.map((gate) => ({ ...gate, required: gate.required ?? true }));
  const failed = normalized.filter((gate) => gate.required && !gate.ok).map((gate) => gate.name);
  return {
    certified: failed.length === 0,
    verdict: failed.length === 0 ? 'PASS' : 'FAIL',
    failed,
    gates: normalized,
  };
}

import { auditPrivateFile, auditSourceSecurity } from './security.js';
import { SecurityRegistry, securityControl } from './security-registry.js';

export interface TaskRailSecurityInput {
  sourceFiles?: string[];
  privateFiles?: string[];
}

export function createTaskRailSecurityRegistry() {
  return new SecurityRegistry()
    .register(securityControl<TaskRailSecurityInput>({
      id: 'source.secure-code',
      version: '1',
      description: 'Scan source for embedded secrets, unsafe shell execution, interpolated SQL, dynamic evaluation and unexpected listeners.',
      contexts: ['source', 'agent', 'release'],
      tags: ['baseline', 'source'],
      evaluate: async ({ sourceFiles = [] }) => {
        const result = await auditSourceSecurity(sourceFiles, false);
        return result.findings.map((finding) => ({
          control: 'source.secure-code',
          code: finding.code,
          severity: finding.severity,
          message: finding.message,
          target: finding.file,
        }));
      },
    }))
    .register(securityControl<TaskRailSecurityInput>({
      id: 'state.private-permissions',
      version: '1',
      description: 'Require private TaskRail state to remain owner-only where POSIX permissions are available.',
      contexts: ['state', 'runtime', 'release'],
      tags: ['baseline', 'state'],
      evaluate: async ({ privateFiles = [] }) => {
        const findings = (await Promise.all(privateFiles.map((file) => auditPrivateFile(file)))).flat();
        return findings.map((finding) => ({
          control: 'state.private-permissions', code: finding.code, severity: finding.severity, message: finding.message, target: finding.file,
        }));
      },
    }))
    .register(securityControl<TaskRailSecurityInput>({
      id: 'network.default-deny',
      version: '1',
      description: 'Enforce the TaskRail default-deny network exposure policy through source review.',
      contexts: ['network', 'source', 'release'],
      tags: ['baseline', 'network'],
      dependsOn: ['source.secure-code'],
      evaluate: () => [],
    }));
}

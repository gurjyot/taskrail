export type AgentActionRisk = 'read' | 'write' | 'control';

export interface AgentActionDefinition {
  name: string;
  description: string;
  risk: AgentActionRisk;
  cli: string;
  defaultAllowed: boolean;
}

export interface AgentAuthorizationPolicy {
  allowWrite?: boolean;
  allowControl?: boolean;
  allow?: string[];
  deny?: string[];
}

const actions: AgentActionDefinition[] = [
  { name: 'status', description: 'Read framework and automation status.', risk: 'read', cli: 'taskrail status --json', defaultAllowed: true },
  { name: 'components.list', description: 'List TaskRail-owned components.', risk: 'read', cli: 'taskrail components', defaultAllowed: true },
  { name: 'capabilities.find', description: 'Search reusable capabilities before creating one.', risk: 'read', cli: 'taskrail capability-find <query>', defaultAllowed: true },
  { name: 'usage.inspect', description: 'Inspect component/capability/profile consumers.', risk: 'read', cli: 'taskrail usage', defaultAllowed: true },
  { name: 'conformance', description: 'Run engineering and isolation conformance checks.', risk: 'read', cli: 'taskrail conformance', defaultAllowed: true },
  { name: 'diagnostics.preview', description: 'Generate a privacy-safe local diagnostic preview.', risk: 'read', cli: 'taskrail diagnostics preview', defaultAllowed: true },
  { name: 'security.audit', description: 'Run TaskRail security checks.', risk: 'read', cli: 'taskrail security audit', defaultAllowed: true },
  { name: 'automation.scaffold', description: 'Create a new automation scaffold.', risk: 'write', cli: 'taskrail init automation <name> --profile <profile>', defaultAllowed: false },
  { name: 'capability.scaffold', description: 'Create a governed capability after duplicate checks.', risk: 'write', cli: 'taskrail init capability <name> ...', defaultAllowed: false },
  { name: 'automation.update', description: 'Run a transactional automation update.', risk: 'control', cli: 'taskrail update <automation>', defaultAllowed: false },
  { name: 'automation.recover', description: 'Recover an interrupted automation update.', risk: 'control', cli: 'taskrail recover <automation>', defaultAllowed: false },
  { name: 'shared.pause', description: 'Pause only affected deployment/update paths for a breaking shared change.', risk: 'control', cli: 'taskrail update-plan ... --pause', defaultAllowed: false },
];

export function agentActions() {
  return actions.map((item) => ({ ...item }));
}

export function authorizeAgentAction(name: string, policy: AgentAuthorizationPolicy = {}) {
  const action = actions.find((item) => item.name === name);
  if (!action) return { allowed: false, reason: 'unknown-action' as const };
  if (policy.deny?.includes(name)) return { allowed: false, action, reason: 'explicit-deny' as const };
  if (policy.allow?.includes(name)) return { allowed: true, action, reason: 'explicit-allow' as const };
  if (action.risk === 'control') return { allowed: policy.allowControl === true, action, reason: policy.allowControl ? 'control-enabled' as const : 'control-disabled' as const };
  if (action.risk === 'write') return { allowed: policy.allowWrite === true, action, reason: policy.allowWrite ? 'write-enabled' as const : 'write-disabled' as const };
  return { allowed: action.defaultAllowed, action, reason: 'read-default' as const };
}

export function mcpSecurityContract() {
  return {
    transportDefault: 'stdio',
    networkListenerDefault: false,
    cliCanonical: true,
    readActionsDefault: true,
    writeActionsDefault: false,
    controlActionsDefault: false,
    authorizationRequiredForMutation: true,
    auditRequired: true,
    protocolTarget: '2026-07-28',
  } as const;
}

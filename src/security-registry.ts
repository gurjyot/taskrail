export type SecurityControlContext = 'source' | 'runtime' | 'state' | 'network' | 'agent' | 'release';
export type SecurityControlSeverity = 'warning' | 'error';

export interface SecurityControlFinding {
  control: string;
  code: string;
  severity: SecurityControlSeverity;
  message: string;
  target?: string;
}

export interface SecurityControl<Input = unknown> {
  id: string;
  version: string;
  description: string;
  contexts: SecurityControlContext[];
  tags?: string[];
  dependsOn?: string[];
  evaluate(input: Input): Promise<SecurityControlFinding[]> | SecurityControlFinding[];
}

export interface SecurityProfile {
  name: string;
  contexts?: SecurityControlContext[];
  controls?: string[];
  tags?: string[];
  strict?: boolean;
}

export interface SecurityProfileResult {
  ok: boolean;
  profile: string;
  controls: string[];
  findings: SecurityControlFinding[];
}

export class SecurityRegistry {
  readonly #controls = new Map<string, SecurityControl<any>>();

  register(control: SecurityControl<any>) {
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(control.id)) throw new Error(`invalid security control id: ${control.id}`);
    if (this.#controls.has(control.id)) throw new Error(`security control already registered: ${control.id}`);
    this.#controls.set(control.id, Object.freeze({ ...control, contexts: [...control.contexts], tags: [...(control.tags ?? [])], dependsOn: [...(control.dependsOn ?? [])] }));
    return this;
  }

  list() {
    return [...this.#controls.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  resolve(profile: SecurityProfile) {
    const selected = new Set<string>(profile.controls ?? []);
    const contexts = new Set(profile.contexts ?? []);
    const tags = new Set(profile.tags ?? []);
    for (const control of this.#controls.values()) {
      if (contexts.size && control.contexts.some((context) => contexts.has(context))) selected.add(control.id);
      if (tags.size && (control.tags ?? []).some((tag) => tags.has(tag))) selected.add(control.id);
    }
    const ordered: SecurityControl<any>[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) throw new Error(`security dependency cycle detected at ${id}`);
      const control = this.#controls.get(id);
      if (!control) throw new Error(`unknown security control: ${id}`);
      visiting.add(id);
      for (const dependency of control.dependsOn ?? []) visit(dependency);
      visiting.delete(id);
      visited.add(id);
      ordered.push(control);
    };
    for (const id of [...selected].sort()) visit(id);
    return ordered;
  }

  async run<Input>(profile: SecurityProfile, input: Input): Promise<SecurityProfileResult> {
    const controls = this.resolve(profile);
    const findings: SecurityControlFinding[] = [];
    for (const control of controls) {
      const result = await control.evaluate(input);
      findings.push(...result.map((finding) => profile.strict && finding.severity === 'warning' ? { ...finding, severity: 'error' as const } : finding));
    }
    return {
      ok: findings.every((finding) => finding.severity !== 'error'),
      profile: profile.name,
      controls: controls.map((control) => control.id),
      findings,
    };
  }
}

export function securityControl<Input>(control: SecurityControl<Input>) {
  return control;
}

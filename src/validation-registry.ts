export type ValidationContext = 'install' | 'update' | 'deploy' | 'rollback' | 'runtime' | 'security' | 'certification';
export type ValidationSeverity = 'info' | 'warning' | 'error';

export interface ValidationFinding {
  module: string;
  code: string;
  severity: ValidationSeverity;
  message: string;
  detail?: string;
}

export interface ValidationModule<Input = unknown> {
  id: string;
  version: string;
  description: string;
  contexts: ValidationContext[];
  tags?: string[];
  dependsOn?: string[];
  validate(input: Input): Promise<ValidationFinding[]> | ValidationFinding[];
}

export interface ValidationSuite {
  name: string;
  contexts?: ValidationContext[];
  modules?: string[];
  tags?: string[];
}

export interface ValidationRunResult {
  ok: boolean;
  suite: string;
  modules: string[];
  findings: ValidationFinding[];
}

export class ValidationRegistry {
  readonly #modules = new Map<string, ValidationModule<any>>();

  register(module: ValidationModule<any>) {
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(module.id)) throw new Error(`invalid validation module id: ${module.id}`);
    if (this.#modules.has(module.id)) throw new Error(`validation module already registered: ${module.id}`);
    this.#modules.set(module.id, Object.freeze({ ...module, contexts: [...module.contexts], tags: [...(module.tags ?? [])], dependsOn: [...(module.dependsOn ?? [])] }));
    return this;
  }

  get(id: string) {
    return this.#modules.get(id);
  }

  list() {
    return [...this.#modules.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  resolve(suite: ValidationSuite) {
    const selected = new Set<string>(suite.modules ?? []);
    const contexts = new Set(suite.contexts ?? []);
    const tags = new Set(suite.tags ?? []);
    for (const module of this.#modules.values()) {
      if (contexts.size && module.contexts.some((context) => contexts.has(context))) selected.add(module.id);
      if (tags.size && (module.tags ?? []).some((tag) => tags.has(tag))) selected.add(module.id);
    }

    const ordered: ValidationModule<any>[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) throw new Error(`validation dependency cycle detected at ${id}`);
      const module = this.#modules.get(id);
      if (!module) throw new Error(`unknown validation module: ${id}`);
      visiting.add(id);
      for (const dependency of module.dependsOn ?? []) visit(dependency);
      visiting.delete(id);
      visited.add(id);
      ordered.push(module);
    };
    for (const id of [...selected].sort()) visit(id);
    return ordered;
  }

  async run<Input>(suite: ValidationSuite, input: Input): Promise<ValidationRunResult> {
    const modules = this.resolve(suite);
    const findings: ValidationFinding[] = [];
    for (const module of modules) findings.push(...await module.validate(input));
    return {
      ok: findings.every((finding) => finding.severity !== 'error'),
      suite: suite.name,
      modules: modules.map((module) => module.id),
      findings,
    };
  }
}

export function validationModule<Input>(module: ValidationModule<Input>) {
  return module;
}

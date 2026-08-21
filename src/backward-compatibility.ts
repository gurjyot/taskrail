export interface CompatibilitySnapshot {
  schema: 1;
  version: string;
  publicExports: string[];
  commands: string[];
  manifestFields?: string[];
}

export interface CompatibilityChange {
  kind: 'removed-export' | 'removed-command' | 'removed-manifest-field';
  value: string;
}

function removed(previous: string[] = [], next: string[] = []) {
  const current = new Set(next);
  return [...new Set(previous)].filter((item) => !current.has(item)).sort();
}

export function assessBackwardCompatibility(previous: CompatibilitySnapshot, next: CompatibilitySnapshot) {
  const changes: CompatibilityChange[] = [
    ...removed(previous.publicExports, next.publicExports).map((value) => ({ kind: 'removed-export' as const, value })),
    ...removed(previous.commands, next.commands).map((value) => ({ kind: 'removed-command' as const, value })),
    ...removed(previous.manifestFields, next.manifestFields).map((value) => ({ kind: 'removed-manifest-field' as const, value })),
  ];
  return {
    compatible: changes.length === 0,
    changes,
    requiresMajorVersion: changes.length > 0,
  };
}

export type SharedArtifactKind = 'component' | 'capability' | 'adapter';
export type ChangeLevel = 'patch' | 'minor' | 'major';

export interface CompatibilityContract {
  schema: 1;
  kind: SharedArtifactKind;
  name: string;
  version: string;
  taskrail: string;
  dependsOn?: Record<string, string>;
  changeLevel?: ChangeLevel;
  migrationRequired?: boolean;
  migrationGuide?: string;
}

export interface CompatibilityConsumer {
  name: string;
  taskrailVersion: string;
  dependencies: Record<string, string>;
}

export interface CompatibilityAssessment {
  ok: boolean;
  breaking: boolean;
  affected: string[];
  errors: string[];
}

function numericVersion(value: string) {
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

export function satisfiesSimpleRange(version: string, range: string) {
  const parsed = numericVersion(version);
  if (!parsed) return false;
  const [major, minor, patch] = parsed;
  const text = range.trim();
  if (text === '*' || text === '') return true;
  const exact = numericVersion(text);
  if (exact) return major === exact[0] && minor === exact[1] && patch === exact[2];
  const caret = text.match(/^\^(\d+)\.(\d+)\.(\d+)$/);
  if (caret) return major === Number(caret[1]) && [minor, patch].join('.') >= [Number(caret[2]), Number(caret[3])].join('.');
  const majorX = text.match(/^(\d+)\.x$/i);
  if (majorX) return major === Number(majorX[1]);
  const twoX = text.match(/^(\d+)\.(\d+)\.x$/i);
  if (twoX) return major === Number(twoX[1]) && minor === Number(twoX[2]);
  return false;
}

export function assessSharedArtifactUpdate(
  current: CompatibilityContract,
  next: CompatibilityContract,
  consumers: CompatibilityConsumer[],
): CompatibilityAssessment {
  const errors: string[] = [];
  if (current.schema !== 1 || next.schema !== 1) errors.push('unsupported compatibility schema');
  if (current.kind !== next.kind || current.name !== next.name) errors.push('artifact identity changed');
  const breaking = next.changeLevel === 'major' || Boolean(next.migrationRequired);
  if (breaking && next.migrationRequired && !next.migrationGuide) errors.push('breaking update requires migration guidance');
  const affected = consumers
    .filter((consumer) => {
      const range = consumer.dependencies[next.name];
      return Boolean(range) && !satisfiesSimpleRange(next.version, range);
    })
    .map((consumer) => consumer.name)
    .sort();
  if (breaking && affected.length === 0 && consumers.some((consumer) => next.name in consumer.dependencies)) {
    // A breaking declaration is still significant even when consumers use permissive ranges.
  }
  return { ok: errors.length === 0 && affected.length === 0, breaking, affected, errors };
}

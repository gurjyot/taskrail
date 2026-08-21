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

type VersionTuple = [number, number, number];

function numericVersion(value: string): VersionTuple | null {
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareVersion(left: VersionTuple, right: VersionTuple) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function satisfiesSimpleRange(version: string, range: string) {
  const parsed = numericVersion(version);
  if (!parsed) return false;
  const text = range.trim();
  if (text === '*' || text === '') return true;
  const caret = text.match(/^\^(\d+)\.(\d+)\.(\d+)$/);
  if (caret) {
    const floor: VersionTuple = [Number(caret[1]), Number(caret[2]), Number(caret[3])];
    return parsed[0] === floor[0] && compareVersion(parsed, floor) >= 0;
  }
  const majorX = text.match(/^(\d+)\.x$/i);
  if (majorX) return parsed[0] === Number(majorX[1]);
  const twoX = text.match(/^(\d+)\.(\d+)\.x$/i);
  if (twoX) return parsed[0] === Number(twoX[1]) && parsed[1] === Number(twoX[2]);
  const exact = numericVersion(text);
  return exact ? compareVersion(parsed, exact) === 0 : false;
}

export function assessSharedArtifactUpdate(
  current: CompatibilityContract,
  next: CompatibilityContract,
  consumers: CompatibilityConsumer[],
): CompatibilityAssessment {
  const errors: string[] = [];
  if (current.schema !== 1 || next.schema !== 1) errors.push('unsupported compatibility schema');
  if (current.kind !== next.kind || current.name !== next.name) errors.push('artifact identity changed');
  if (!numericVersion(current.version) || !numericVersion(next.version)) errors.push('invalid artifact version');
  const breaking = next.changeLevel === 'major' || Boolean(next.migrationRequired);
  if (breaking && next.migrationRequired && !next.migrationGuide) errors.push('breaking update requires migration guidance');
  const affected = consumers
    .filter((consumer) => {
      const range = consumer.dependencies[next.name];
      return Boolean(range) && !satisfiesSimpleRange(next.version, range);
    })
    .map((consumer) => consumer.name)
    .sort();
  return { ok: errors.length === 0 && affected.length === 0, breaking, affected, errors };
}

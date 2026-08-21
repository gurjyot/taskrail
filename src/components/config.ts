export type EnvSource = Record<string, string | undefined>;

export function optional(name: string, source: EnvSource = process.env): string | undefined {
  const value = source[name];
  return value === undefined || value === '' ? undefined : value;
}

export function required(name: string, source: EnvSource = process.env): string {
  const value = optional(name, source);
  if (value === undefined) throw new Error(`missing required configuration: ${name}`);
  return value;
}

export function number(name: string, source: EnvSource = process.env, fallback?: number): number {
  const raw = optional(name, source);
  if (raw === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing required configuration: ${name}`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`invalid numeric configuration: ${name}`);
  return value;
}

export function boolean(name: string, source: EnvSource = process.env, fallback?: boolean): boolean {
  const raw = optional(name, source);
  if (raw === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing required configuration: ${name}`);
  }
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`invalid boolean configuration: ${name}`);
}

export function json<T>(name: string, source: EnvSource = process.env, fallback?: T): T {
  const raw = optional(name, source);
  if (raw === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing required configuration: ${name}`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`invalid JSON configuration: ${name}`);
  }
}

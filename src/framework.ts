import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { FrameworkCapabilityDefinition, FrameworkManifest, FrameworkProfileDefinition, RawFrameworkManifest } from './types.js';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mergeArrays(left: unknown, right: unknown) {
  if (Array.isArray(left) && Array.isArray(right)) return [...right];
  return right;
}

function deepMerge<T extends Record<string, any>>(base: T, patch: Partial<T>): T {
  const output: Record<string, any> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      output[key] = mergeArrays(output[key], value);
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value) && output[key] && typeof output[key] === 'object' && !Array.isArray(output[key])) {
      output[key] = deepMerge(output[key], value as Record<string, any>);
      continue;
    }
    output[key] = value;
  }
  return output as T;
}

function interpolate(value: unknown, automation: string): unknown {
  if (typeof value === 'string') return value.replaceAll('${automation}', automation);
  if (Array.isArray(value)) return value.map((item) => interpolate(item, automation));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolate(item, automation)]));
  return value;
}

const runtimePaths = ['node_modules', 'logs', 'state', 'tmp', 'cache'];

export const frameworkCapabilities: Record<string, FrameworkCapabilityDefinition> = {
  'node-runtime@1': { id: 'node-runtime@1', apply: () => ({ runtime: 'node', runtimeVersion: '>=22.0.0', runtimePaths }) },
  'shell-runtime@1': { id: 'shell-runtime@1', apply: () => ({ runtime: 'shell', runtimePaths: ['logs', 'state', 'tmp', 'cache'] }) },
  'php-runtime@1': { id: 'php-runtime@1', apply: () => ({ runtime: 'php', runtimePaths: ['logs', 'state', 'tmp', 'cache'] }) },
  'systemd@1': {
    id: 'systemd@1',
    apply: (manifest) => ({ serviceManager: manifest.serviceManager ?? { type: 'systemd', units: [{ name: `${manifest.name}.service`, kind: 'service', oneshotOkay: true }] } }),
  },
  'immutable-deploy@1': { id: 'immutable-deploy@1', apply: () => ({ backup: { retain: 3 }, deployStrategy: { type: 'replace-in-place' } }) },
  'postgres-migrations@1': { id: 'postgres-migrations@1', apply: () => ({ database: { required: true } }) },
  'health@1': { id: 'health@1', apply: () => ({ requiredChecks: ['validation', 'test', 'health'] }) },
  'drift@1': { id: 'drift@1', apply: (manifest) => ({ runtimePaths: manifest.runtimePaths ?? runtimePaths, generatedPaths: ['.taskrail', '*.candidate', '*.backup-*'] }) },
  'change-detection@1': { id: 'change-detection@1', apply: () => ({}) },
  'release-retention@1': { id: 'release-retention@1', apply: () => ({ generatedPaths: ['.taskrail', '*.candidate', '*.backup-*'] }) },
  'agent-execution@1': {
    id: 'agent-execution@1',
    apply: (manifest) => ({
      statePath: manifest.statePath ?? '/opt/smg-automations/state/${automation}',
      execution: {
        timeoutMs: manifest.execution?.timeoutMs ?? 300_000,
        maxConcurrency: manifest.execution?.maxConcurrency ?? 4,
        staleAfterMs: manifest.execution?.staleAfterMs ?? 900_000,
        retry: {
          maxAttempts: manifest.execution?.retry?.maxAttempts ?? 3,
          baseDelayMs: manifest.execution?.retry?.baseDelayMs ?? 500,
          maxDelayMs: manifest.execution?.retry?.maxDelayMs ?? 10_000,
          jitter: manifest.execution?.retry?.jitter ?? true,
        },
      },
      resources: {
        memoryMaxMb: manifest.resources?.memoryMaxMb ?? 512,
        cpuQuotaPercent: manifest.resources?.cpuQuotaPercent ?? 100,
        tasksMax: manifest.resources?.tasksMax ?? 64,
        nice: manifest.resources?.nice ?? 5,
      },
    }),
  },
};

const operational = ['systemd@1', 'immutable-deploy@1', 'health@1', 'drift@1', 'change-detection@1', 'release-retention@1', 'agent-execution@1'];
const portableOperational = ['immutable-deploy@1', 'health@1', 'drift@1', 'change-detection@1', 'release-retention@1', 'agent-execution@1'];
const nodeCommon = ['node-runtime@1', ...operational];
const shellCommon = ['shell-runtime@1', ...operational];
const phpCommon = ['php-runtime@1', ...operational];
const portableNodeCommon = ['node-runtime@1', ...portableOperational];

function authoringDefaults(runtime: 'node' | 'shell' | 'php'): Partial<FrameworkManifest> {
  if (runtime === 'shell') {
    return {
      validationCommand: 'bash -n src/main.sh',
      testCommand: 'bash tests/self-test.sh',
      healthCheck: { type: 'command', command: 'bash -n src/main.sh' },
    };
  }
  if (runtime === 'php') {
    return {
      validationCommand: 'php -l src/main.php',
      testCommand: 'php tests/self-test.php',
      healthCheck: { type: 'command', command: 'php -l src/main.php' },
    };
  }
  return {
    validationCommand: 'node --check src/main.js',
    testCommand: 'node --test tests/*.test.js',
    healthCheck: { type: 'command', command: 'node --check src/main.js' },
  };
}

function timerDefaults(runtime: 'node' | 'shell' | 'php'): Partial<FrameworkManifest> {
  return deepMerge({
    managed: true,
    sourceDir: '.',
    deployDir: '/opt/smg-automations/automations/${automation}',
    execution: { staleAfterMs: 93_600_000 },
    serviceManager: {
      type: 'systemd',
      units: [
        { name: '${automation}.service', kind: 'service', oneshotOkay: true },
        { name: '${automation}.timer', kind: 'timer' },
      ],
    },
    releaseOwnedPaths: ['automation.json', 'main.js', 'src', 'tests', 'README.md', 'CHANGELOG.md', 'package.json', 'package-lock.json', 'capabilities', 'adapters', 'tools'],
  } as Partial<FrameworkManifest>, authoringDefaults(runtime));
}

function nodeServiceDefaults(extra: Partial<FrameworkManifest> = {}): Partial<FrameworkManifest> {
  return deepMerge(deepMerge({
    managed: true,
    sourceDir: '.',
    deployDir: '/opt/smg-automations/automations/${automation}',
    execution: { staleAfterMs: 900_000 },
    serviceManager: { type: 'systemd', units: [{ name: '${automation}.service', kind: 'service' }] },
    releaseOwnedPaths: ['automation.json', 'main.js', 'src', 'tests', 'README.md', 'CHANGELOG.md', 'package.json', 'package-lock.json', 'scripts', 'lib'],
  } as Partial<FrameworkManifest>, authoringDefaults('node')), extra);
}

export const frameworkProfiles: Record<string, FrameworkProfileDefinition> = {
  'portable-node@1': {
    id: 'portable-node@1',
    frameworkCapabilities: portableNodeCommon,
    defaults: deepMerge({
      managed: true,
      sourceDir: '.',
      deployDir: '../.taskrail/${automation}/live',
      statePath: '../.taskrail/${automation}/state',
      isolation: { level: 'standard' },
      releaseOwnedPaths: ['automation.json', 'main.js', 'src', 'tests', 'README.md', 'CHANGELOG.md', 'package.json', 'package-lock.json', 'scripts', 'lib', 'capabilities', 'adapters', 'tools'],
    } as Partial<FrameworkManifest>, authoringDefaults('node')),
  },
  'smg-node-timer@1': { id: 'smg-node-timer@1', frameworkCapabilities: nodeCommon, defaults: timerDefaults('node') },
  'smg-shell-timer@1': { id: 'smg-shell-timer@1', frameworkCapabilities: shellCommon, defaults: timerDefaults('shell') },
  'smg-php-timer@1': { id: 'smg-php-timer@1', frameworkCapabilities: phpCommon, defaults: timerDefaults('php') },
  'smg-node-service@1': {
    id: 'smg-node-service@1',
    frameworkCapabilities: nodeCommon,
    defaults: nodeServiceDefaults(),
  },
  'smg-node-postgres-service@1': {
    id: 'smg-node-postgres-service@1',
    frameworkCapabilities: [...nodeCommon, 'postgres-migrations@1'],
    defaults: nodeServiceDefaults({
      releaseOwnedPaths: ['automation.json', 'main.js', 'src', 'tests', 'README.md', 'CHANGELOG.md', 'package.json', 'package-lock.json', 'scripts', 'lib', 'migrations'],
    }),
  },
};

function hasFile(cwd: string, ...parts: string[]) {
  return existsSync(path.join(cwd, ...parts));
}

function detectProjectUnitHints(manifest: RawFrameworkManifest, cwd: string) {
  const serviceNames = [`${manifest.name}.service`, path.join('service', `${manifest.name}.service`)];
  const timerNames = [`${manifest.name}.timer`, path.join('timer', `${manifest.name}.timer`)];
  return { service: serviceNames.some((file) => hasFile(cwd, file)), timer: timerNames.some((file) => hasFile(cwd, file)) };
}

function detectSystemdUnitHints(manifest: RawFrameworkManifest) {
  const service = spawnSync('systemctl', ['cat', `${manifest.name}.service`], { encoding: 'utf8', timeout: 30_000, maxBuffer: 256 * 1024 });
  const timer = spawnSync('systemctl', ['cat', `${manifest.name}.timer`], { encoding: 'utf8', timeout: 30_000, maxBuffer: 256 * 1024 });
  return { service: service.status === 0, timer: timer.status === 0 };
}

function assertFrameworkReferences(manifest: RawFrameworkManifest) {
  if (manifest.profile && !frameworkProfiles[manifest.profile]) throw new Error(`unknown TaskRail profile: ${manifest.profile}`);
  for (const id of manifest.frameworkCapabilities ?? []) {
    if (!frameworkCapabilities[id]) throw new Error(`unknown TaskRail framework capability: ${id}`);
  }
}

export function resolveFrameworkManifest(manifest: RawFrameworkManifest): FrameworkManifest {
  assertFrameworkReferences(manifest);
  const profile = manifest.profile ? frameworkProfiles[manifest.profile] : undefined;
  const automation = manifest.name;
  let resolved = profile ? clone(interpolate(profile.defaults, automation) as FrameworkManifest) : {} as FrameworkManifest;
  const frameworkCaps = [...new Set([...(profile?.frameworkCapabilities ?? []), ...(manifest.frameworkCapabilities ?? [])])];
  for (const id of frameworkCaps) {
    const capability = frameworkCapabilities[id];
    if (!capability) throw new Error(`unknown TaskRail framework capability: ${id}`);
    resolved = deepMerge(resolved, interpolate(capability.apply(resolved), automation) as Partial<FrameworkManifest>);
  }
  resolved = deepMerge(resolved, clone(manifest) as FrameworkManifest);
  if (profile) resolved.frameworkCapabilities = frameworkCaps;
  return resolved;
}

function resolveFrameworkDefaults(manifest: RawFrameworkManifest) {
  assertFrameworkReferences(manifest);
  const profile = manifest.profile ? frameworkProfiles[manifest.profile] : undefined;
  const automation = manifest.name;
  let resolved = profile ? clone(interpolate(profile.defaults, automation) as FrameworkManifest) : {} as FrameworkManifest;
  const frameworkCaps = [...new Set([...(profile?.frameworkCapabilities ?? []), ...(manifest.frameworkCapabilities ?? [])])];
  for (const id of frameworkCaps) {
    const capability = frameworkCapabilities[id];
    if (!capability) throw new Error(`unknown TaskRail framework capability: ${id}`);
    resolved = deepMerge(resolved, interpolate(capability.apply(resolved), automation) as Partial<FrameworkManifest>);
  }
  if (profile) resolved.frameworkCapabilities = frameworkCaps;
  return resolved;
}

export function compactManifest(manifest: FrameworkManifest): RawFrameworkManifest {
  const raw = clone(manifest);
  if (!raw.profile || !frameworkProfiles[raw.profile]) return raw;
  const defaults = resolveFrameworkDefaults(raw);
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'frameworkCapabilities' && Array.isArray(value) && value.length === 0) continue;
    const defaultMap = defaults as unknown as Record<string, unknown>;
    if (JSON.stringify(value) === JSON.stringify(defaultMap[key])) continue;
    output[key] = value;
  }
  output.name = raw.name;
  output.profile = raw.profile;
  if (raw.frameworkCapabilities?.length) output.frameworkCapabilities = raw.frameworkCapabilities;
  if (raw.taskrailCompatibility) output.taskrailCompatibility = raw.taskrailCompatibility;
  return output as RawFrameworkManifest;
}

export function inferProfile(manifest: RawFrameworkManifest, cwd = process.cwd()): string | null {
  if (manifest.profile) return manifest.profile;
  if (manifest.deployDir && path.isAbsolute(manifest.deployDir) && existsSync(manifest.deployDir)) {
    try { if (!statSync(manifest.deployDir).isDirectory()) return null; } catch {}
  }
  const units = manifest.serviceManager?.units ?? [];
  const timer = units.some((unit) => unit.kind === 'timer');
  if (timer && manifest.runtime === 'node') return 'smg-node-timer@1';
  if (timer && manifest.runtime === 'shell') return 'smg-shell-timer@1';
  if (timer && manifest.runtime === 'php') return 'smg-php-timer@1';
  if (manifest.runtime === 'node' && manifest.database?.required) return 'smg-node-postgres-service@1';
  if (manifest.runtime === 'node' && units.length) return 'smg-node-service@1';
  const localHints = detectProjectUnitHints(manifest, cwd);
  if (localHints.timer && localHints.service && manifest.runtime === 'node') return 'smg-node-timer@1';
  if (localHints.timer && localHints.service && manifest.runtime === 'shell') return 'smg-shell-timer@1';
  if (localHints.timer && localHints.service && manifest.runtime === 'php') return 'smg-php-timer@1';
  if (manifest.runtime === 'node' && manifest.database?.required && localHints.service) return 'smg-node-postgres-service@1';
  if (manifest.runtime === 'node' && localHints.service) return 'smg-node-service@1';
  const systemdHints = detectSystemdUnitHints(manifest);
  if (systemdHints.timer && systemdHints.service && manifest.runtime === 'node') return 'smg-node-timer@1';
  if (systemdHints.timer && systemdHints.service && manifest.runtime === 'shell') return 'smg-shell-timer@1';
  if (systemdHints.timer && systemdHints.service && manifest.runtime === 'php') return 'smg-php-timer@1';
  if (manifest.runtime === 'node' && manifest.database?.required && systemdHints.service) return 'smg-node-postgres-service@1';
  if (manifest.runtime === 'node' && systemdHints.service) return 'smg-node-service@1';
  return null;
}

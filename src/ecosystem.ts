import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateAutomationPublication, validateHubCapabilityPublication } from './ecosystem-contract.js';
import { TASKRAIL_VERSION } from './version.js';
import type { FrameworkManifest } from './types.js';

export const TASKRAIL_ECOSYSTEM_CONFIG_SCHEMA = 1 as const;
export type EcosystemRepositoryKind = 'capabilities' | 'automations';

export interface EcosystemCommandCheck { command: string; args?: string[] }
export interface EcosystemRepositoryConfig {
  name: string;
  kind: EcosystemRepositoryKind;
  path: string;
  required?: boolean;
  enforceCurrentMajor?: boolean;
  checks?: EcosystemCommandCheck[];
}
export interface EcosystemConfig { schema: typeof TASKRAIL_ECOSYSTEM_CONFIG_SCHEMA; repositories: EcosystemRepositoryConfig[] }
export interface EcosystemRepositoryResult {
  name: string; kind: EcosystemRepositoryKind; path: string; present: boolean; publications: number;
  commands: Array<{ command: string; ok: boolean; status: number | null; detail: string }>;
  errors: string[]; warnings: string[]; ok: boolean;
}
export interface EcosystemVerifyResult {
  ok: boolean; taskrailVersion: string; repositories: EcosystemRepositoryResult[]; errors: string[]; warnings: string[];
}

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', '.taskrail', '.cache', 'coverage']);
function currentMajor(version = TASKRAIL_VERSION) { return version.split('.')[0]; }
function declaredMajor(value: string | undefined) { return String(value || '').trim().match(/^(?:>=\s*)?(\d+)/)?.[1] || null; }
async function exists(target: string) { return stat(target).then(() => true, () => false); }

async function findNamedFiles(root: string, filename: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) { if (!IGNORED_DIRS.has(entry.name)) await walk(path.join(dir, entry.name)); }
      else if (entry.isFile() && entry.name === filename) out.push(path.join(dir, entry.name));
    }
  }
  await walk(root);
  return out.sort();
}

function boundedDetail(value: string, max = 300) { return value.replace(/\s+/g, ' ').trim().slice(0, max); }
function runConfiguredCheck(check: EcosystemCommandCheck, cwd: string) {
  const result = spawnSync(check.command, check.args ?? [], { cwd, encoding: 'utf8', env: process.env, timeout: 10 * 60 * 1000, maxBuffer: 2 * 1024 * 1024 });
  return {
    command: [check.command, ...(check.args ?? [])].join(' '),
    ok: result.status === 0 && !result.error,
    status: result.status,
    detail: boundedDetail(result.stderr || result.stdout || result.error?.message || ''),
  };
}

async function verifyCapabilityRepo(repo: EcosystemRepositoryConfig, absolutePath: string, taskrailVersion: string, result: EcosystemRepositoryResult) {
  const files = await findNamedFiles(absolutePath, 'capability.json');
  result.publications = files.length;
  if (!files.length) result.errors.push('no capability.json publications found');
  for (const file of files) {
    const relative = path.relative(absolutePath, file);
    try {
      const raw = JSON.parse(await readFile(file, 'utf8')) as { taskrailCompatibility?: string };
      const checked = validateHubCapabilityPublication(raw, taskrailVersion);
      result.errors.push(...checked.errors.map((error) => `${relative}: ${error}`));
      result.warnings.push(...checked.warnings.map((warning) => `${relative}: ${warning}`));
      if (repo.enforceCurrentMajor && declaredMajor(raw.taskrailCompatibility) !== currentMajor(taskrailVersion)) result.errors.push(`${relative}: first-party publication must target TaskRail ${currentMajor(taskrailVersion)}.x`);
    } catch (error) { result.errors.push(`${relative}: ${error instanceof Error ? error.message : String(error)}`); }
  }
}

async function verifyAutomationRepo(repo: EcosystemRepositoryConfig, absolutePath: string, taskrailVersion: string, result: EcosystemRepositoryResult) {
  const files = await findNamedFiles(absolutePath, 'automation.json');
  result.publications = files.length;
  if (!files.length) result.errors.push('no automation.json publications found');
  for (const file of files) {
    const relative = path.relative(absolutePath, file);
    try {
      const raw = JSON.parse(await readFile(file, 'utf8')) as FrameworkManifest;
      const checked = validateAutomationPublication(raw, taskrailVersion);
      result.errors.push(...checked.errors.map((error) => `${relative}: ${error}`));
      result.warnings.push(...checked.warnings.map((warning) => `${relative}: ${warning}`));
      if (repo.enforceCurrentMajor && declaredMajor(raw.taskrailCompatibility) !== currentMajor(taskrailVersion)) result.errors.push(`${relative}: first-party publication must target TaskRail ${currentMajor(taskrailVersion)}.x`);
    } catch (error) { result.errors.push(`${relative}: ${error instanceof Error ? error.message : String(error)}`); }
  }
}

export async function loadEcosystemConfig(configPath: string): Promise<EcosystemConfig> {
  const parsed = JSON.parse(await readFile(configPath, 'utf8')) as Partial<EcosystemConfig>;
  if (parsed.schema !== TASKRAIL_ECOSYSTEM_CONFIG_SCHEMA) throw new Error(`unsupported ecosystem config schema: ${String(parsed.schema)}`);
  if (!Array.isArray(parsed.repositories) || !parsed.repositories.length) throw new Error('ecosystem config requires repositories');
  return parsed as EcosystemConfig;
}

export async function verifyEcosystem(config: EcosystemConfig, options: { cwd?: string; taskrailVersion?: string; strict?: boolean } = {}): Promise<EcosystemVerifyResult> {
  const cwd = options.cwd ?? process.cwd();
  const taskrailVersion = options.taskrailVersion ?? TASKRAIL_VERSION;
  const repositories: EcosystemRepositoryResult[] = [];
  for (const repo of config.repositories) {
    const absolutePath = path.isAbsolute(repo.path) ? path.normalize(repo.path) : path.resolve(cwd, repo.path);
    const present = await exists(absolutePath);
    const result: EcosystemRepositoryResult = { name: repo.name, kind: repo.kind, path: absolutePath, present, publications: 0, commands: [], errors: [], warnings: [], ok: false };
    if (!present) {
      const message = `repository path missing: ${absolutePath}`;
      if (repo.required !== false || options.strict) result.errors.push(message); else result.warnings.push(message);
    } else {
      if (repo.kind === 'capabilities') await verifyCapabilityRepo(repo, absolutePath, taskrailVersion, result);
      else if (repo.kind === 'automations') await verifyAutomationRepo(repo, absolutePath, taskrailVersion, result);
      for (const check of repo.checks ?? []) {
        const command = runConfiguredCheck(check, absolutePath);
        result.commands.push(command);
        if (!command.ok) result.errors.push(`command failed: ${command.command}${command.detail ? ` — ${command.detail}` : ''}`);
      }
    }
    result.ok = result.errors.length === 0;
    repositories.push(result);
  }
  const errors = repositories.flatMap((repo) => repo.errors.map((error) => `${repo.name}: ${error}`));
  const warnings = repositories.flatMap((repo) => repo.warnings.map((warning) => `${repo.name}: ${warning}`));
  return { ok: errors.length === 0, taskrailVersion, repositories, errors, warnings };
}

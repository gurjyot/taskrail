import path from 'node:path';
import type { AutomationPlugin, ChangeRisk, ChangeReviewInput, FrameworkManifest, GateVerdict } from './types.js';
import { writeEvidence } from './evidence.js';
import { runGate } from './gate.js';
import { runBoundedCommand } from './bounded-command.js';

export interface VerifyChangeResult {
  changedFiles: string[];
  protectedPaths: string[];
  risk: ChangeRisk;
  gate: GateVerdict;
  deployAllowed: boolean;
  evidencePath: string;
  gitAvailable: boolean;
  gitError?: string;
}

export interface InspectChangeOptions {
  gateVerdict?: GateVerdict;
}

async function git(args: string[], cwd: string) {
  const quoted = args.map((value) => JSON.stringify(value)).join(' ');
  const result = await runBoundedCommand({
    command: `git ${quoted}`,
    cwd,
    timeoutMs: 30_000,
    maxOutputBytes: 256 * 1024,
  });
  return { ok: result.ok, output: result.stdout.replace(/\r?\n$/, ''), error: result.ok ? undefined : result.message };
}

function scoreRisk(files: string[], protectedPaths: string[]): ChangeRisk {
  if (!files.length) return 'low';
  if (protectedPaths.length) return 'high';
  if (files.some((file) => file.startsWith('src/') || file.startsWith('test/'))) return files.length > 3 ? 'medium' : 'low';
  return 'medium';
}

function normalizeProtectedPath(base: string, file: string) {
  return path.isAbsolute(file) ? path.normalize(file) : path.normalize(path.resolve(base, file));
}

function isGeneratedTaskrailPath(file: string) {
  return file === '.taskrail' || file.startsWith('.taskrail/');
}

function matchProtected(files: string[], protectedPaths: string[], cwd: string) {
  const normalizedProtected = protectedPaths.map((file) => path.normalize(file));
  return files.filter((file) => {
    const abs = normalizeProtectedPath(cwd, file);
    const rel = path.normalize(file);
    return normalizedProtected.some((prefix) => {
      const normalizedPrefix = path.normalize(prefix);
      return abs === normalizedPrefix || abs.startsWith(`${normalizedPrefix}${path.sep}`) || rel === normalizedPrefix || rel.startsWith(`${normalizedPrefix}${path.sep}`);
    });
  });
}

export async function inspectChange(
  manifest: FrameworkManifest,
  cwd = process.cwd(),
  plugins: AutomationPlugin[] = [],
  options: InspectChangeOptions = {},
): Promise<VerifyChangeResult> {
  let changedFiles: string[] = [];
  let gitAvailable = true;
  let gitError: string | undefined;

  const status = await git(['status', '--porcelain'], cwd);
  const untrackedResult = await git(['ls-files', '--others', '--exclude-standard'], cwd);
  if (!status.ok || !untrackedResult.ok) {
    gitAvailable = false;
    gitError = status.error || untrackedResult.error || 'git inspection failed';
  } else {
    const tracked = status.output ? status.output.split('\n').map((line) => line.replace(/^[ MADRCU?!]{1,2}\s+/, '').trim()).filter(Boolean) : [];
    const untracked = untrackedResult.output.split('\n').map((line) => line.trim()).filter(Boolean);
    changedFiles = Array.from(new Set([...tracked, ...untracked].map((file) => file.replace(/^"|"$/g, '')))).filter((file) => !isGeneratedTaskrailPath(file)).sort();
  }

  const protectedPaths = matchProtected(changedFiles, manifest.protectedPaths ?? [], cwd);
  const risk = scoreRisk(changedFiles, protectedPaths);
  const gateResult = options.gateVerdict ? undefined : await runGate(manifest, cwd, plugins);
  const gateVerdict = options.gateVerdict ?? gateResult!.verdict;
  const deployAllowed = gitAvailable && gateVerdict === 'PASS' && risk !== 'blocked' && protectedPaths.length === 0;
  const evidencePath = await writeEvidence(cwd, {
    kind: 'verify-change',
    project: manifest.name,
    changedFiles,
    protectedPaths,
    risk,
    gate: gateResult,
    gitAvailable,
    gitError,
    deployAllowed,
  });
  return { changedFiles, protectedPaths, risk, gate: gateVerdict, deployAllowed, evidencePath, gitAvailable, gitError };
}

export function reviewInputFromChange(change: VerifyChangeResult): ChangeReviewInput {
  return {
    changedFiles: change.changedFiles,
    protectedPaths: change.protectedPaths,
    risk: change.risk,
    gate: change.gate,
    deployAllowed: change.deployAllowed,
  };
}

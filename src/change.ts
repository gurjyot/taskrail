import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { AutomationPlugin, ChangeRisk, ChangeReviewInput, FrameworkManifest, GateVerdict } from './types.js';
import { writeEvidence } from './evidence.js';
import { runGate } from './gate.js';

export interface VerifyChangeResult {
  changedFiles: string[];
  protectedPaths: string[];
  risk: ChangeRisk;
  gate: GateVerdict;
  deployAllowed: boolean;
  evidencePath: string;
}

function git(args: string[], cwd: string) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).replace(/\r?\n$/, '');
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

export async function inspectChange(manifest: FrameworkManifest, cwd = process.cwd(), plugins: AutomationPlugin[] = []): Promise<VerifyChangeResult> {
  let changedFiles: string[] = [];
  try {
    const status = git(['status', '--porcelain'], cwd);
    const tracked = status ? status.split('\n').map((line) => line.replace(/^[ MADRCU?!]{1,2}\s+/, '').trim()).filter(Boolean) : [];
    const untracked = git(['ls-files', '--others', '--exclude-standard'], cwd).split('\n').map((line) => line.trim()).filter(Boolean);
    changedFiles = Array.from(new Set([...tracked, ...untracked].map((file) => file.replace(/^"|"$/g, '')))).filter((file) => !isGeneratedTaskrailPath(file)).sort();
  } catch {
    changedFiles = [];
  }
  const protectedPaths = matchProtected(changedFiles, manifest.protectedPaths ?? [], cwd);
  const risk = scoreRisk(changedFiles, protectedPaths);
  const gate = await runGate(manifest, cwd, plugins);
  const deployAllowed = gate.verdict === 'PASS' && risk !== 'blocked' && protectedPaths.length === 0;
  const evidencePath = await writeEvidence(cwd, {
    kind: 'verify-change',
    project: manifest.name,
    changedFiles,
    protectedPaths,
    risk,
    gate,
    deployAllowed,
  });
  return { changedFiles, protectedPaths, risk, gate: gate.verdict, deployAllowed, evidencePath };
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

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
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function scoreRisk(files: string[], protectedPaths: string[]): ChangeRisk {
  if (!files.length) return 'low';
  if (protectedPaths.length) return 'high';
  if (files.some((file) => file.startsWith('src/') || file.startsWith('test/'))) return files.length > 3 ? 'medium' : 'low';
  return 'medium';
}

function matchProtected(files: string[], protectedPaths: string[]) {
  return files.filter((file) => protectedPaths.some((prefix) => file === prefix || file.startsWith(prefix.replace(/\/$/, '') + '/') || file.startsWith(prefix)));
}

function isGeneratedTaskrailPath(file: string) {
  return file === '.taskrail' || file.startsWith('.taskrail/');
}

export async function inspectChange(manifest: FrameworkManifest, cwd = process.cwd(), plugins: AutomationPlugin[] = []): Promise<VerifyChangeResult> {
  let changedFiles: string[] = [];
  try {
    const status = git(['status', '--porcelain'], cwd);
    const tracked = status ? status.split('\n').map((line) => line.slice(3).trim()).filter(Boolean) : [];
    const untracked = git(['ls-files', '--others', '--exclude-standard'], cwd).split('\n').filter(Boolean);
    changedFiles = Array.from(new Set([...tracked, ...untracked].map((file) => file.replace(/^\"|\"$/g, '')))).filter((file) => !isGeneratedTaskrailPath(file)).sort();
  } catch {
    changedFiles = [];
  }
  const protectedPaths = matchProtected(changedFiles, manifest.protectedPaths ?? []);
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

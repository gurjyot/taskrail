import { spawnSync } from 'node:child_process';
import type { GitState } from './types.js';

function runGit(args: string[], cwd: string) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function isIgnoredGeneratedPath(file: string) {
  return file === '.taskrail' || file.startsWith('.taskrail/') || file.includes('/.taskrail/');
}

export function inspectGitState(cwd = process.cwd()): GitState {
  const root = runGit(['rev-parse', '--show-toplevel'], cwd);
  if (root.status !== 0) {
    return { available: false, error: 'not a git repository' };
  }
  const repoRoot = root.stdout.trim();
  const sha = runGit(['rev-parse', 'HEAD'], cwd);
  const status = runGit(['status', '--porcelain'], cwd);
  const changedFiles = status.status === 0
    ? status.stdout.split(/\r?\n/).map((line) => line.replace(/^[ MADRCU?!]{1,2}\s+/, '').trim()).filter(Boolean)
      .filter((file) => !isIgnoredGeneratedPath(file))
    : [];
  return {
    available: true,
    repoRoot,
    sha: sha.status === 0 ? sha.stdout.trim() : undefined,
    clean: changedFiles.length === 0,
    changedFiles,
    error: sha.status === 0 ? undefined : sha.stderr.trim() || 'git rev-parse failed',
  };
}

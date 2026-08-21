import path from 'node:path';
import { findAutomation } from './capabilities.js';
import { loadManifest } from './config.js';
import { resolveFrameworkManifest } from './framework.js';
import { inspectGitState } from './git.js';
import { transactionalDeploy } from './transactional-deploy.js';

export async function runTransactionalDeployCli(args = process.argv.slice(2)) {
  const target = args[1];
  const json = args.includes('--json');
  const migrationCompatible = args.includes('--migration-compatible');
  if (!target) {
    console.error('usage: taskrail update <automation> [--migration-compatible] [--json]');
    process.exitCode = 1;
    return;
  }

  const base = process.cwd();
  const manifestPath = await findAutomation(target, base);
  if (!manifestPath) {
    console.error(`automation not found: ${target}`);
    process.exitCode = 1;
    return;
  }
  const cwd = path.dirname(manifestPath);
  const manifest = resolveFrameworkManifest(await loadManifest(manifestPath));
  const git = inspectGitState(cwd);
  const result = await transactionalDeploy(manifest, undefined, {
    projectRoot: cwd,
    sourceRevision: git.sha,
    migrationCompatible: migrationCompatible || undefined,
  });

  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log([
      `STATUS: ${result.ok ? 'PASS' : result.blocked ? 'BLOCKED' : 'FAIL'}`,
      `AUTOMATION: ${manifest.name}`,
      `TRANSACTION: ${result.checkpoint?.transactionId || 'none'}`,
      `PHASE: ${result.checkpoint?.phase || 'none'}`,
      `RELEASE: ${result.outcome?.releaseId || 'unchanged'}`,
      `DETAIL: ${result.reason || 'update verified and committed'}`,
      `NEXT: ${result.ok ? 'done' : result.checkpoint?.phase === 'recovery-required' ? 'inspect recovery state before any new activation' : 'fix the blocked stage and retry'}`,
    ].join('\n'));
  }
  if (!result.ok) process.exitCode = 1;
}

import path from 'node:path';
import { findAutomation } from './capabilities.js';
import { loadManifest } from './config.js';
import { resolveFrameworkManifest } from './framework.js';
import { recoverInterruptedAutomation } from './recovery-resume.js';

export async function runRecoveryResumeCli(args = process.argv.slice(2)) {
  const target = args[1];
  const json = args.includes('--json');
  const migrationCompatible = args.includes('--migration-compatible');
  if (!target) {
    console.error('usage: taskrail recover <automation> [--migration-compatible] [--json]');
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
  const result = await recoverInterruptedAutomation(manifest, cwd, undefined, migrationCompatible || !manifest.migrations);
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log([
    `STATUS: ${result.ok ? 'PASS' : 'FAIL'}`,
    `AUTOMATION: ${manifest.name}`,
    `ACTION: ${result.action}`,
    `PHASE: ${result.checkpoint?.phase || 'none'}`,
    `DETAIL: ${result.reason || 'recovery state is clean'}`,
  ].join('\n'));
  if (!result.ok) process.exitCode = 1;
}

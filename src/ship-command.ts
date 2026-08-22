import path from 'node:path';
import { findAutomation } from './capabilities.js';
import { loadManifest } from './config.js';
import { resolveFrameworkManifest } from './framework.js';
import { detectEnvironment } from './env.js';
import { inspectGitState } from './git.js';
import { loadPlugins, safeDeploy } from './deployment.js';

function compact(lines: string[]) {
  console.log(lines.join('\n'));
}

export async function runShipCli(args = process.argv.slice(3)) {
  const first = args[0];
  const target = first && !first.startsWith('--') ? first : undefined;
  const baseCwd = process.cwd();
  const manifestPath = target
    ? await findAutomation(target, baseCwd)
    : path.join(baseCwd, 'automation.json');

  if (!manifestPath) {
    console.error(`automation not found: ${target || ''}`);
    process.exitCode = 1;
    return;
  }

  const raw = await loadManifest(manifestPath);
  const manifest = resolveFrameworkManifest(raw);
  const cwd = path.dirname(manifestPath);
  const plugins = await loadPlugins(manifest).catch(() => []);
  const plugin = plugins[0];
  const result = await safeDeploy(manifest, plugin, {
    sourceRevision: inspectGitState(cwd).sha,
    projectRoot: cwd,
  });

  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    compact([
      `STATUS: ${result.deployed ? 'PASS' : 'FAIL'}`,
      `ENV: ${detectEnvironment(manifest, cwd).name}`,
      `SHA: ${result.sha || 'unknown'}`,
      `RELEASE: ${result.releaseId || 'unknown'}`,
      `NEXT: ${result.deployed ? 'done' : 'taskrail explain deploy'}`,
    ]);
  }
  if (!result.deployed) process.exitCode = 1;
}

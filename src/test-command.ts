import path from 'node:path';
import { findAutomation } from './capabilities.js';
import { loadManifest } from './config.js';
import { resolveFrameworkManifest } from './framework.js';
import { preflight } from './preflight.js';
import { detectEnvironment } from './env.js';
import { runBoundedCommand } from './bounded-command.js';

function compact(lines: string[]) {
  console.log(lines.join('\n'));
}

export async function runDeclaredTestCli(args = process.argv.slice(3)) {
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
  const preflightResult = await preflight(manifest, cwd);
  if (!preflightResult.ok) {
    compact([
      'STATUS: FAIL',
      `ENV: ${detectEnvironment(manifest, cwd).name}`,
      `PREFLIGHT: ${preflightResult.checks.filter((item) => !item.ok).map((item) => item.name).join(', ') || 'failed'}`,
      'NEXT: taskrail explain test',
    ]);
    process.exitCode = 1;
    return;
  }

  const result = await runBoundedCommand({
    command: manifest.testCommand,
    cwd: path.resolve(cwd, manifest.sourceDir),
    timeoutMs: 300_000,
    maxOutputBytes: 256 * 1024,
  });

  if (args.includes('--json')) {
    console.log(JSON.stringify({ ok: result.ok, environment: detectEnvironment(manifest, cwd).name, result }, null, 2));
  } else {
    compact([
      `STATUS: ${result.ok ? 'PASS' : 'FAIL'}`,
      `ENV: ${detectEnvironment(manifest, cwd).name}`,
      `TEST: ${result.message}`,
      `NEXT: ${result.ok ? 'taskrail plan' : 'taskrail explain test'}`,
    ]);
    if (!result.ok) {
      if (result.stdout) process.stderr.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
  }
  if (!result.ok) process.exitCode = 1;
}

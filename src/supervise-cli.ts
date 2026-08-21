#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { discoverAutomationManifests } from './capabilities.js';
import { resolveFrameworkManifest } from './framework.js';
import { inspectTargets, unhealthyTargets } from './supervisor.js';
import { effectiveExecutionPolicy } from './execution.js';
import type { FrameworkManifest } from './types.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('taskrail-supervise [--json] [--concurrency=N]');
    return;
  }
  const json = args.includes('--json');
  const concurrencyArg = args.find((arg) => arg.startsWith('--concurrency='));
  const concurrency = concurrencyArg ? Number(concurrencyArg.split('=')[1]) : 16;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 256) throw new Error('concurrency must be an integer between 1 and 256');

  const manifests = await discoverAutomationManifests(process.cwd());
  const targets = [];
  for (const manifestPath of manifests) {
    const raw = JSON.parse(await readFile(manifestPath, 'utf8')) as FrameworkManifest;
    if (!raw.managed) continue;
    const manifest = resolveFrameworkManifest(raw);
    if (!manifest.statePath) continue;
    const stateDir = path.isAbsolute(manifest.statePath) ? manifest.statePath : path.resolve(path.dirname(manifestPath), manifest.statePath);
    targets.push({ name: manifest.name, stateDir, staleAfterMs: effectiveExecutionPolicy(manifest.execution).staleAfterMs });
  }

  const results = await inspectTargets(targets, concurrency);
  const unhealthy = unhealthyTargets(results);
  if (json) console.log(JSON.stringify({ ok: unhealthy.length === 0, total: results.length, unhealthy: unhealthy.length, results }, null, 2));
  else {
    console.log(`STATUS: ${unhealthy.length === 0 ? 'PASS' : 'FAIL'}`);
    console.log(`AUTOMATIONS: ${results.length}`);
    console.log(`UNHEALTHY: ${unhealthy.length}`);
    for (const result of unhealthy) console.log(`${result.name}: ${result.status}${result.details ? ` - ${result.details}` : ''}`);
  }
  if (unhealthy.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

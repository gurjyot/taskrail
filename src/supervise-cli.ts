#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { discoverAutomationManifests } from './capabilities.js';
import { resolveFrameworkManifest } from './framework.js';
import { inspectTargets, unhealthyTargets, type SupervisionTarget } from './supervisor.js';
import { effectiveExecutionPolicy } from './execution.js';
import type { FrameworkManifest } from './types.js';

function serviceName(unit: string) {
  return unit.replace(/\.service$/, '');
}

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
  const seenAutomations = new Set<string>();
  const byName = new Map<string, SupervisionTarget>();
  for (const manifestPath of manifests) {
    const raw = JSON.parse(await readFile(manifestPath, 'utf8')) as FrameworkManifest;
    if (!raw.managed || seenAutomations.has(raw.name)) continue;
    seenAutomations.add(raw.name);
    const manifest = resolveFrameworkManifest(raw);
    const fallbackFreshness = effectiveExecutionPolicy(manifest.execution).staleAfterMs;
    const services = (manifest.serviceManager?.units ?? []).filter((unit) => unit.kind === 'service');
    if (services.length) {
      for (const unit of services) {
        const name = serviceName(unit.name);
        if (byName.has(name)) continue;
        const stateDir = name === manifest.name && manifest.statePath
          ? (path.isAbsolute(manifest.statePath) ? manifest.statePath : path.resolve(path.dirname(manifestPath), manifest.statePath))
          : path.resolve(`/opt/smg-automations/state/${name}`);
        byName.set(name, { name, stateDir, staleAfterMs: unit.staleAfterMs ?? fallbackFreshness });
      }
    } else if (manifest.statePath && !byName.has(manifest.name)) {
      const stateDir = path.isAbsolute(manifest.statePath) ? manifest.statePath : path.resolve(path.dirname(manifestPath), manifest.statePath);
      byName.set(manifest.name, { name: manifest.name, stateDir, staleAfterMs: fallbackFreshness });
    }
  }

  const targets = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
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

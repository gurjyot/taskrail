#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { discoverAutomationManifests, findAutomation } from './capabilities.js';
import { resolveFrameworkManifest } from './framework.js';
import { installTaskRailDropIn, managedServiceUnits, renderTaskRailDropIn } from './systemd.js';
import type { FrameworkManifest } from './types.js';

async function readManifest(file: string) {
  return resolveFrameworkManifest(JSON.parse(await readFile(file, 'utf8')) as FrameworkManifest);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('taskrail-systemd-sync [automation] [--all] [--apply] [--json]');
    return;
  }
  const apply = args.includes('--apply');
  const json = args.includes('--json');
  const all = args.includes('--all');
  const target = args.find((arg) => !arg.startsWith('--'));
  if (!all && !target) throw new Error('provide an automation or --all');

  const files = all
    ? await discoverAutomationManifests(process.cwd())
    : [await findAutomation(target!, process.cwd())].filter(Boolean) as string[];
  if (!files.length) throw new Error('no managed automation manifests found');

  const results: Array<{ automation: string; unit: string; applied: boolean; path?: string; dropIn: string }> = [];
  for (const file of files) {
    const manifest = await readManifest(file);
    if (!manifest.managed || manifest.serviceManager?.type !== 'systemd') continue;
    for (const unit of managedServiceUnits(manifest)) {
      const dropIn = renderTaskRailDropIn(manifest);
      const installed = apply ? await installTaskRailDropIn(unit, manifest) : undefined;
      results.push({ automation: manifest.name, unit, applied: apply, path: installed, dropIn });
    }
  }
  if (apply) {
    const reload = spawnSync('systemctl', ['daemon-reload'], { encoding: 'utf8' });
    if (reload.status !== 0) throw new Error(reload.stderr?.trim() || 'systemctl daemon-reload failed');
  }
  if (json) console.log(JSON.stringify({ applied: apply, services: results.length, results }, null, 2));
  else {
    console.log(`STATUS: PASS`);
    console.log(`MODE: ${apply ? 'applied' : 'dry-run'}`);
    console.log(`SERVICES: ${results.length}`);
    for (const result of results) console.log(`${result.automation}: ${result.unit}${result.path ? ` -> ${result.path}` : ''}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

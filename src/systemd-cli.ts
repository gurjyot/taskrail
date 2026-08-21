#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { discoverAutomationManifests, findAutomation } from './capabilities.js';
import { resolveFrameworkManifest } from './framework.js';
import { installTaskRailDropIn, managedServiceUnits, managedSystemdUnits, renderTaskRailDropIn } from './systemd.js';
import type { FrameworkManifest } from './types.js';

async function readManifest(file: string) {
  return resolveFrameworkManifest(JSON.parse(await readFile(file, 'utf8')) as FrameworkManifest);
}

function systemctl(args: string[]) {
  return spawnSync('systemctl', args, { encoding: 'utf8' });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('taskrail-systemd-sync [automation] [--all] [--apply] [--ensure-enabled] [--json]');
    return;
  }
  const apply = args.includes('--apply');
  const ensureEnabled = args.includes('--ensure-enabled');
  const json = args.includes('--json');
  const all = args.includes('--all');
  const target = args.find((arg) => !arg.startsWith('--'));
  if (!all && !target) throw new Error('provide an automation or --all');
  if (ensureEnabled && !apply) throw new Error('--ensure-enabled requires --apply');

  const files = all
    ? await discoverAutomationManifests(process.cwd())
    : [await findAutomation(target!, process.cwd())].filter(Boolean) as string[];
  if (!files.length) throw new Error('no managed automation manifests found');

  const seenAutomations = new Set<string>();
  const seenUnits = new Set<string>();
  const results: Array<{ automation: string; unit: string; kind: 'service' | 'timer'; applied: boolean; enabled: boolean | null; enabledByTaskRail: boolean; path?: string; dropIn?: string }> = [];
  for (const file of files) {
    const manifest = await readManifest(file);
    if (!manifest.managed || manifest.serviceManager?.type !== 'systemd' || seenAutomations.has(manifest.name)) continue;
    seenAutomations.add(manifest.name);
    const serviceUnits = new Set(managedServiceUnits(manifest));
    for (const unit of managedSystemdUnits(manifest)) {
      if (seenUnits.has(unit.name)) continue;
      seenUnits.add(unit.name);
      const dropIn = serviceUnits.has(unit.name) ? renderTaskRailDropIn(manifest) : undefined;
      const installed = apply && serviceUnits.has(unit.name) ? await installTaskRailDropIn(unit.name, manifest) : undefined;
      const enabledCheck = systemctl(['is-enabled', unit.name]);
      let enabled = enabledCheck.status === 0;
      let enabledByTaskRail = false;
      if (apply && ensureEnabled && !enabled) {
        const enable = systemctl(['enable', unit.name]);
        if (enable.status !== 0) throw new Error(enable.stderr?.trim() || `systemctl enable ${unit.name} failed`);
        enabled = true;
        enabledByTaskRail = true;
      }
      results.push({ automation: manifest.name, unit: unit.name, kind: unit.kind, applied: apply, enabled, enabledByTaskRail, path: installed, dropIn });
    }
  }
  if (apply) {
    const reload = systemctl(['daemon-reload']);
    if (reload.status !== 0) throw new Error(reload.stderr?.trim() || 'systemctl daemon-reload failed');
  }
  const disabled = results.filter((result) => result.enabled === false).map((result) => result.unit);
  if (json) console.log(JSON.stringify({ applied: apply, ensureEnabled, units: results.length, rebootReady: disabled.length === 0, disabled, results }, null, 2));
  else {
    console.log(`STATUS: ${disabled.length ? 'WARN' : 'PASS'}`);
    console.log(`MODE: ${apply ? 'applied' : 'dry-run'}`);
    console.log(`UNITS: ${results.length}`);
    console.log(`REBOOT_READY: ${disabled.length ? 'NO' : 'YES'}`);
    for (const result of results) console.log(`${result.automation}: ${result.unit} (${result.kind}) enabled=${String(result.enabled)}${result.enabledByTaskRail ? ' [enabled]' : ''}${result.path ? ` -> ${result.path}` : ''}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

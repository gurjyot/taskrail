#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { discoverAutomationManifests, findAutomation } from './capabilities.js';
import { resolveFrameworkManifest } from './framework.js';
import { installTaskRailDropIn, managedServiceUnits, managedSystemdUnits, renderTaskRailDropIn, verifySystemdRuntimeContext } from './systemd.js';
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
    console.log('taskrail-systemd-sync [automation] [--all] [--apply] [--ensure-enabled] [--verify-runtime] [--json]');
    return;
  }
  const apply = args.includes('--apply');
  const ensureEnabled = args.includes('--ensure-enabled');
  const verifyRuntime = args.includes('--verify-runtime');
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
  const results: Array<{ automation: string; unit: string; kind: 'service' | 'timer'; applied: boolean; enabled: boolean | null; active: boolean | null; enabledByTaskRail: boolean; path?: string; dropIn?: string }> = [];
  const runtimeChecks: Array<ReturnType<typeof verifySystemdRuntimeContext>[number] & { automation: string }> = [];
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
      const active = unit.kind === 'timer' ? systemctl(['is-active', unit.name]).status === 0 : null;
      results.push({ automation: manifest.name, unit: unit.name, kind: unit.kind, applied: apply, enabled, active, enabledByTaskRail, path: installed, dropIn });
    }
    if (verifyRuntime) runtimeChecks.push(...verifySystemdRuntimeContext(manifest).map((check) => ({ automation: manifest.name, ...check })));
  }
  if (apply) {
    const reload = systemctl(['daemon-reload']);
    if (reload.status !== 0) throw new Error(reload.stderr?.trim() || 'systemctl daemon-reload failed');
  }
  const disabled = results.filter((result) => result.enabled === false).map((result) => result.unit);
  const runtimeFailures = runtimeChecks.filter((check) => !check.passed);
  const schedulerFailures = verifyRuntime
    ? results.filter((result) => result.kind === 'timer' && (!result.enabled || result.active !== true))
    : [];
  const runtimeReady = runtimeFailures.length === 0 && schedulerFailures.length === 0;
  if (json) console.log(JSON.stringify({ applied: apply, ensureEnabled, verifyRuntime, units: results.length, rebootReady: disabled.length === 0, runtimeReady, disabled, runtimeFailures, schedulerFailures, runtimeChecks, results }, null, 2));
  else {
    console.log(`STATUS: ${disabled.length || runtimeFailures.length || schedulerFailures.length ? 'WARN' : 'PASS'}`);
    console.log(`MODE: ${apply ? 'applied' : 'dry-run'}`);
    console.log(`UNITS: ${results.length}`);
    console.log(`REBOOT_READY: ${disabled.length ? 'NO' : 'YES'}`);
    if (verifyRuntime) console.log(`RUNTIME_READY: ${runtimeReady ? 'YES' : 'NO'}`);
    for (const result of results) console.log(`${result.automation}: ${result.unit} (${result.kind}) enabled=${String(result.enabled)}${result.kind === 'timer' ? ` active=${String(result.active)}` : ''}${result.enabledByTaskRail ? ' [enabled]' : ''}${result.path ? ` -> ${result.path}` : ''}`);
    for (const check of runtimeChecks) console.log(`${check.automation}: ${check.unit} runtime=${check.passed ? 'PASS' : 'FAIL'} user=${check.user} workdir=${check.workingDirectory}${check.unreadableSharedFiles.length ? ` unreadable=${check.unreadableSharedFiles.join(',')}` : ''}`);
    for (const failure of schedulerFailures) console.log(`${failure.automation}: ${failure.unit} scheduler=FAIL enabled=${String(failure.enabled)} active=${String(failure.active)}`);
  }
  if (!runtimeReady) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

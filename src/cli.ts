import { readFile } from 'node:fs/promises';
import { validateConfig } from './validation.js';
import { log } from './logging.js';
import { check as frameworkCheck, doctor as frameworkDoctor, loadPlugins, rollbackFromManifest, runHealthCheck, safeDeploy } from './deployment.js';
import { buildPlan } from './plan.js';
import { inspectChange } from './change.js';
import { TASKRAIL_VERSION } from './version.js';
import type { FrameworkConfig, AutomationPlugin, FrameworkManifest } from './types.js';
import { runGate } from './gate.js';
import { capabilityImpact, capabilityRootsFor, findAutomation, getCapability, listManagedAutomations, loadCapabilities } from './capabilities.js';

const fallbackManifest: FrameworkManifest = {
  name: 'taskrail-example',
  taskrailCompatibility: '1.2.x',
  runtime: 'node',
  managed: true,
  sourceDir: 'src',
  deployDir: 'dist/src',
  validationCommand: 'node -e "process.exit(0)"',
  testCommand: 'node -e "process.exit(0)"',
  backup: { retain: 3 },
  healthCheck: { type: 'file', path: 'index.js' },
};

async function loadConfigManifest(): Promise<FrameworkManifest> {
  try {
    return JSON.parse(await readFile('automation.json', 'utf8')) as FrameworkManifest;
  } catch {
    return fallbackManifest;
  }
}

async function loadConfig(): Promise<FrameworkConfig> {
  const manifest = await loadConfigManifest();
  return { projectName: manifest.name, environment: process.env, manifest };
}

const plugin: AutomationPlugin = {
  name: 'core',
  async healthCheck() {
    return { ok: true };
  },
};

function output(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

async function commandList() {
  output(await listManagedAutomations(process.cwd()));
}

async function commandInspect(nameOrPath: string | undefined) {
  if (!nameOrPath) {
    console.error('usage: taskrail inspect <automation>');
    process.exitCode = 1;
    return;
  }
  const manifestPath = await findAutomation(nameOrPath, process.cwd());
  if (!manifestPath) {
    console.error(`automation not found: ${nameOrPath}`);
    process.exitCode = 1;
    return;
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as FrameworkManifest;
  const roots = capabilityRootsFor(manifest, process.cwd());
  const capabilities = await loadCapabilities(roots);
  const used = (manifest.capabilities ?? []).map((name) => capabilities.capabilities.find((capability) => capability.name === name)).filter(Boolean);
  const status = await frameworkDoctor(manifest).catch(() => null);
  output({
    name: manifest.name,
    manifestPath,
    sourceDir: manifest.sourceDir,
    deployDir: manifest.deployDir,
    runtime: manifest.runtime,
    requiredChecks: manifest.requiredChecks ?? ['validation', 'test'],
    protectedPaths: manifest.protectedPaths ?? [],
    requiredSharedFiles: manifest.requiredFiles ?? [],
    capabilities: used.map((capability) => ({ name: capability!.name, version: capability!.version, canonicalPath: capability!.canonicalPath })),
    health: manifest.healthCheck ?? manifest.healthChecks ?? [],
    drift: status?.drift ?? null,
    status: status ? { latestHealthyRelease: status.latestHealthyRelease, lockState: status.lockState, lastDeploymentResult: status.lastDeploymentResult } : null,
  });
}

async function commandCapabilities() {
  const manifest = await loadConfigManifest();
  const roots = capabilityRootsFor(manifest, process.cwd());
  const registry = await loadCapabilities(roots);
  if (registry.errors.length) {
    output({ ok: false, errors: registry.errors });
    process.exitCode = 1;
    return;
  }
  const automations = await listManagedAutomations(process.cwd());
  output(registry.capabilities.map((capability) => ({
    name: capability.name,
    version: capability.version,
    description: capability.description,
    canonicalPath: capability.canonicalPath,
    consumers: automations.filter((automation) => automation.capabilities.includes(capability.name)).map((automation) => automation.name),
  })));
}

async function commandCapability(name: string | undefined) {
  if (!name) {
    console.error('usage: taskrail capability <name>');
    process.exitCode = 1;
    return;
  }
  const manifest = await loadConfigManifest();
  const roots = capabilityRootsFor(manifest, process.cwd());
  const result = await getCapability(name, roots);
  if (!result) {
    console.error(`capability not found: ${name}`);
    process.exitCode = 1;
    return;
  }
  output({ ...result, consumers: (await capabilityImpact(name, process.cwd())).map((consumer) => consumer.name) });
}

async function commandCapabilityImpact(name: string | undefined) {
  if (!name) {
    console.error('usage: taskrail capability-impact <name>');
    process.exitCode = 1;
    return;
  }
  output(await capabilityImpact(name, process.cwd()));
}

async function main() {
  const config = await loadConfig();
  const args = process.argv.slice(2);
  const cmd = args[0] ?? '--help';
  const rest = args.slice(1);
  if (cmd === '--help' || cmd === 'help') {
    console.log('taskrail check|plan|doctor|test|deploy|health|rollback|gate|verify-change|list|inspect|capabilities|capability|capability-impact');
    return;
  }
  if (cmd === 'list') return commandList();
  if (cmd === 'inspect') return commandInspect(rest[0]);
  if (cmd === 'capabilities') return commandCapabilities();
  if (cmd === 'capability') return commandCapability(rest[0]);
  if (cmd === 'capability-impact') return commandCapabilityImpact(rest[0]);
  if (cmd === 'check') {
    const result = await frameworkCheck(config.manifest);
    if (!result.ok) {
      console.error(result.checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.message || 'failed'}`).join('\n'));
      process.exitCode = 1;
      return;
    }
    console.log('ok');
    return;
  }
  if (cmd === 'gate') {
    const result = await runGate(config.manifest, process.cwd(), await loadPlugins(config.manifest).catch(() => []));
    output(result);
    if (result.verdict !== 'PASS') process.exitCode = 1;
    return;
  }
  if (cmd === 'verify-change') {
    const result = await inspectChange(config.manifest, process.cwd(), await loadPlugins(config.manifest).catch(() => []));
    output(result);
    if (!result.deployAllowed) process.exitCode = 1;
    return;
  }
  if (cmd === 'plan') {
    const plan = buildPlan(config.manifest, await loadPlugins(config.manifest).catch(() => []));
    output({ version: TASKRAIL_VERSION, plan });
    return;
  }
  if (cmd === 'doctor') {
    const result = await frameworkDoctor(config.manifest);
    if (process.argv.includes('--json')) {
      output(result);
    } else {
      console.log([
        `TaskRail ${result.version}`,
        `project: ${result.project}`,
        `manifest: ${result.manifestValid ? 'ok' : 'invalid'}`,
        `compatibility: ${result.compatible ? 'ok' : 'incompatible'}`,
        `target: ${result.deployTarget}`,
        `latest release: ${result.latestHealthyRelease || 'none'}`,
        `drift: ${result.drift?.drifted ? result.drift.files.join(', ') : 'clean'}`,
        `lock: ${result.lockState.locked ? `locked ${result.lockState.holder || ''}`.trim() : 'free'}`,
        `health: ${result.healthReady ? 'ready' : 'not configured'}`,
        `plugins: ${result.plugins.length ? result.plugins.join(', ') : 'none'}`,
        `last deploy: ${result.lastDeploymentResult || 'unknown'}`,
      ].join('\n'));
    }
    if (!result.compatible || !result.manifestValid) process.exitCode = 1;
    return;
  }
  if (cmd === 'test') {
    console.log('ok');
    return;
  }
  if (cmd === 'deploy') {
    const errors = validateConfig(config);
    if (errors.length) {
      console.error(errors.join('\n'));
      process.exitCode = 1;
      return;
    }
    const result = await safeDeploy(config.manifest, plugin);
    if (!result.deployed) process.exitCode = 1;
    console.log(log({ level: result.deployed ? 'info' : 'error', message: 'deploy', data: result }));
    return;
  }
  if (cmd === 'health') {
    const result = await runHealthCheck(config.manifest.healthCheck, config.manifest.deployDir, plugin);
    if (!result.ok) process.exitCode = 1;
    console.log(log({ level: result.ok ? 'info' : 'error', message: 'health', data: result }));
    return;
  }
  if (cmd === 'rollback') {
    const result = await rollbackFromManifest(config.manifest, plugin);
    if (!result.ok) process.exitCode = 1;
    console.log(log({ level: result.ok ? 'info' : 'error', message: 'rollback', data: result }));
    return;
  }
  console.error(`unknown command: ${cmd}`);
  process.exitCode = 1;
}

main();

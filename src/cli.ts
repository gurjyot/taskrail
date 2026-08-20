import { validateConfig } from './validation.js';
import { log } from './logging.js';
import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { check as frameworkCheck, doctor as frameworkDoctor, gate as frameworkGate, loadPlugins, rollbackFromState, runHealthCheck, safeDeploy } from './deployment.js';
import { buildPlan } from './plan.js';
import { inspectChange } from './change.js';
import { TASKRAIL_VERSION } from './version.js';
import type { FrameworkConfig, AutomationPlugin, FrameworkManifest } from './types.js';

const fallbackManifest: FrameworkManifest = {
  name: 'taskrail-example',
  taskrailCompatibility: '1.0.x',
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
    const candidate = JSON.parse(await readFile('automation.json', 'utf8')) as FrameworkManifest;
    return candidate;
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

async function main() {
  const config = await loadConfig();
  const cmd = process.argv[2] ?? '--help';
  if (cmd === '--help' || cmd === 'help') {
    console.log('taskrail check|plan|doctor|test|deploy|health|rollback|gate|verify-change');
    return;
  }
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
    const result = await frameworkGate(config.manifest, process.cwd(), await loadPlugins(config.manifest).catch(() => []));
    console.log(JSON.stringify(result, null, 2));
    if (result.verdict !== 'PASS') process.exitCode = 1;
    return;
  }
  if (cmd === 'verify-change') {
    const result = await inspectChange(config.manifest, process.cwd(), await loadPlugins(config.manifest).catch(() => []));
    console.log(JSON.stringify(result, null, 2));
    if (!result.deployAllowed) process.exitCode = 1;
    return;
  }
  if (cmd === 'plan') {
    const plan = buildPlan(config.manifest, await loadPlugins(config.manifest).catch(() => []));
    console.log(JSON.stringify({ version: TASKRAIL_VERSION, plan }, null, 2));
    return;
  }
  if (cmd === 'doctor') {
    const result = await frameworkDoctor(config.manifest);
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(result, null, 2));
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
    const stateFile = new URL('./taskrail-example.deploy-state.json', import.meta.url).pathname;
    const result = await rollbackFromState(stateFile, config.manifest.healthCheck, plugin);
    if (!result.ok) process.exitCode = 1;
    console.log(log({ level: result.ok ? 'info' : 'error', message: 'rollback', data: result }));
    return;
  }
  if (cmd === 'plugins') {
    const plugins = await loadPlugins(config.manifest as FrameworkManifest);
    console.log(plugins.map((p) => p.name).join('\n'));
    return;
  }
  console.error(`unknown command: ${cmd}`);
  process.exitCode = 1;
}

main();

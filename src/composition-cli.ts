import { stat } from 'node:fs/promises';
import path from 'node:path';
import { listComponents, getComponent } from './component-registry.js';
import { loadCapabilities } from './capabilities.js';
import { findSimilarCapabilities } from './capability-governance.js';
import { checkCapability } from './capability-check.js';
import { scaffoldCapability } from './capability-scaffold.js';
import { scaffoldAutomation } from './automation-scaffold.js';
import { buildUsageGraph, usageImpact } from './usage-graph.js';
import { planSharedUpdate } from './update-plan.js';
import { auditFleetIsolation } from './isolation-audit.js';
import { evaluateConformance } from './conformance.js';

function output(value: unknown) { console.log(JSON.stringify(value, null, 2)); }

function unique(values: string[]) { return [...new Set(values.filter(Boolean))]; }

function capabilityRoots(cwd = process.cwd()) {
  return unique([
    ...(process.env.TASKRAIL_CAPABILITY_ROOTS?.split(path.delimiter) ?? []),
    path.join(cwd, 'capabilities'),
    path.join(cwd, 'framework-managed', 'capabilities'),
  ].map((item) => path.isAbsolute(item) ? path.normalize(item) : path.resolve(cwd, item)));
}

async function defaultCapabilityRoot(cwd = process.cwd()) {
  const managed = path.join(cwd, 'framework-managed', 'capabilities');
  if (await stat(path.dirname(managed)).then(() => true, () => false)) return managed;
  return path.join(cwd, 'capabilities');
}

function flagValues(args: string[], flag: string) {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1] && !args[index + 1].startsWith('--')) values.push(args[++index]);
  }
  return values;
}

function flagValue(args: string[], flag: string) { return flagValues(args, flag)[0]; }
function hasFlag(args: string[], flag: string) { return args.includes(flag); }

function usage() {
  console.log([
    'TaskRail composition commands:',
    '  taskrail components',
    '  taskrail component <name>',
    '  taskrail capability-find <query>',
    '  taskrail capability-check <name> [--strict]',
    '  taskrail usage',
    '  taskrail usage <component|capability|profile> <name>',
    '  taskrail update-plan <component|capability> <name> [--from <version>] [--to <version>] [--breaking]',
    '  taskrail isolation-audit',
    '  taskrail conformance',
    '  taskrail init automation <name> --profile <profile> [--root <dir>]',
    '  taskrail init capability <name> --description <text> --purpose <text> --domain <name> --operation <op> [--operation <op> ...]',
  ].join('\n'));
}

async function loadedCapabilities() {
  const registry = await loadCapabilities(capabilityRoots());
  if (registry.errors.length) {
    output({ ok: false, errors: registry.errors });
    process.exitCode = 1;
    return null;
  }
  return registry.capabilities;
}

export async function runCompositionCli(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  if (command === 'components') return output(listComponents());
  if (command === 'component') {
    const component = getComponent(rest[0]);
    if (!component) {
      console.error(`component not found: ${rest[0] || ''}`);
      process.exitCode = 1;
      return;
    }
    return output(component);
  }
  if (command === 'usage') {
    const graph = await buildUsageGraph(process.cwd());
    const kind = rest[0] as 'component' | 'capability' | 'profile' | undefined;
    const name = rest[1];
    if (!kind) {
      return output({
        summary: {
          automations: graph.automations.length,
          capabilities: graph.capabilities.length,
          components: graph.components.length,
          profiles: graph.profiles.length,
          errors: graph.errors.length,
        },
        ...graph,
      });
    }
    if (!['component', 'capability', 'profile'].includes(kind) || !name) {
      console.error('usage: taskrail usage <component|capability|profile> <name>');
      process.exitCode = 1;
      return;
    }
    const impact = usageImpact(graph, kind, name);
    output({ ...impact, errors: graph.errors });
    if (!impact.exists || graph.errors.length) process.exitCode = 1;
    return;
  }
  if (command === 'update-plan') {
    const kind = rest[0] as 'component' | 'capability' | undefined;
    const name = rest[1];
    if (!kind || !['component', 'capability'].includes(kind) || !name) {
      console.error('usage: taskrail update-plan <component|capability> <name> [--from <version>] [--to <version>] [--breaking]');
      process.exitCode = 1;
      return;
    }
    const graph = await buildUsageGraph(process.cwd());
    const plan = planSharedUpdate(graph, {
      targetKind: kind,
      targetName: name,
      fromVersion: flagValue(rest, '--from'),
      toVersion: flagValue(rest, '--to'),
      breaking: hasFlag(rest, '--breaking'),
    });
    output({ ...plan, graphErrors: graph.errors });
    if (plan.action === 'blocked') process.exitCode = 1;
    return;
  }
  if (command === 'isolation-audit') {
    const audit = await auditFleetIsolation(process.cwd());
    output(audit);
    if (!audit.ok) process.exitCode = 1;
    return;
  }
  if (command === 'conformance') {
    const report = await evaluateConformance(process.cwd());
    output(report);
    if (!report.ok) process.exitCode = 1;
    return;
  }
  if (command === 'capability-find') {
    const query = rest.filter((item) => !item.startsWith('--')).join(' ').trim();
    if (!query) {
      console.error('usage: taskrail capability-find <query>');
      process.exitCode = 1;
      return;
    }
    const capabilities = await loadedCapabilities();
    if (!capabilities) return;
    return output(await findSimilarCapabilities(query, capabilities, Number(flagValue(rest, '--limit') || 5)));
  }
  if (command === 'capability-check') {
    const name = rest[0];
    if (!name) {
      console.error('usage: taskrail capability-check <name> [--strict]');
      process.exitCode = 1;
      return;
    }
    const capabilities = await loadedCapabilities();
    if (!capabilities) return;
    const capability = capabilities.find((item) => item.name === name);
    if (!capability) {
      console.error(`capability not found: ${name}`);
      process.exitCode = 1;
      return;
    }
    const result = await checkCapability(capability, capabilities, hasFlag(rest, '--strict'));
    output(result);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === 'init' && rest[0] === 'automation') {
    const name = rest[1];
    const profile = flagValue(rest, '--profile');
    if (!name || !profile) {
      console.error('usage: taskrail init automation <name> --profile <profile> [--root <dir>]');
      process.exitCode = 1;
      return;
    }
    return output(await scaffoldAutomation({ name, profile, root: flagValue(rest, '--root') }));
  }
  if (command === 'init' && rest[0] === 'capability') {
    const name = rest[1];
    if (!name) {
      console.error('usage: taskrail init capability <name> --description <text> --purpose <text> --domain <name> --operation <op>');
      process.exitCode = 1;
      return;
    }
    const existing = await loadedCapabilities();
    if (!existing) return;
    const result = await scaffoldCapability({
      root: flagValue(rest, '--root') || await defaultCapabilityRoot(),
      name,
      version: flagValue(rest, '--version') || '1.0.0',
      description: flagValue(rest, '--description') || '',
      purpose: flagValue(rest, '--purpose') || '',
      domain: flagValue(rest, '--domain') || '',
      operations: flagValues(rest, '--operation'),
      keywords: flagValues(rest, '--keyword'),
      components: flagValues(rest, '--component'),
      sideEffects: flagValue(rest, '--side-effects') as any,
      idempotency: flagValue(rest, '--idempotency') as any,
      input: flagValue(rest, '--input'),
      output: flagValue(rest, '--output'),
      overlapRationale: flagValue(rest, '--overlap-rationale'),
    }, existing);
    output(result);
    if (!result.created) process.exitCode = 2;
    return;
  }
  usage();
  process.exitCode = 1;
}

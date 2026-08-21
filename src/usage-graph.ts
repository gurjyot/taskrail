import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FrameworkManifest } from './types.js';
import { discoverAutomationManifests, capabilityRootsFor, loadCapabilities } from './capabilities.js';
import { capabilityMetadata } from './capability-governance.js';
import { listComponents } from './component-registry.js';

export interface AutomationUsageNode {
  name: string;
  manifestPath: string;
  profile?: string;
  taskrailCompatibility?: string;
  components: string[];
  capabilities: string[];
}

export interface CapabilityUsageNode {
  name: string;
  version: string;
  components: string[];
  automationConsumers: string[];
}

export interface ComponentUsageNode {
  name: string;
  version: string;
  directAutomationConsumers: string[];
  capabilityConsumers: string[];
  automationConsumers: string[];
}

export interface ProfileUsageNode {
  name: string;
  automationConsumers: string[];
}

export interface UsageGraph {
  automations: AutomationUsageNode[];
  capabilities: CapabilityUsageNode[];
  components: ComponentUsageNode[];
  profiles: ProfileUsageNode[];
  errors: string[];
}

export interface UsageImpact {
  kind: 'component' | 'capability' | 'profile';
  name: string;
  exists: boolean;
  directConsumers: string[];
  transitiveAutomationConsumers: string[];
  count: number;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort();
}

async function readManifest(file: string): Promise<FrameworkManifest | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as FrameworkManifest;
  } catch {
    return null;
  }
}

export async function buildUsageGraph(cwd = process.cwd()): Promise<UsageGraph> {
  const manifestPaths = await discoverAutomationManifests(cwd);
  const automations: AutomationUsageNode[] = [];
  const manifests = new Map<string, FrameworkManifest>();
  const roots = new Set<string>();
  const seenNames = new Set<string>();
  const errors: string[] = [];

  for (const manifestPath of manifestPaths) {
    const manifest = await readManifest(manifestPath);
    if (!manifest?.managed || seenNames.has(manifest.name)) continue;
    seenNames.add(manifest.name);
    manifests.set(manifestPath, manifest);
    const projectRoot = path.dirname(manifestPath);
    for (const root of capabilityRootsFor(manifest, projectRoot)) roots.add(root);
    automations.push({
      name: manifest.name,
      manifestPath,
      profile: manifest.profile,
      taskrailCompatibility: manifest.taskrailCompatibility,
      components: unique(manifest.components ?? []),
      capabilities: unique(manifest.capabilities ?? []),
    });
  }

  for (const fallback of [path.join(cwd, 'capabilities'), path.join(cwd, 'framework-managed', 'capabilities')]) roots.add(path.resolve(fallback));
  const loaded = await loadCapabilities([...roots]);
  for (const error of loaded.errors) errors.push(`${error.message}${error.path ? `: ${error.path}` : ''}`);

  const capabilityNodes: CapabilityUsageNode[] = [];
  for (const capability of loaded.capabilities) {
    const metadata = await capabilityMetadata(capability);
    capabilityNodes.push({
      name: capability.name,
      version: capability.version,
      components: unique(metadata.components ?? []),
      automationConsumers: unique(automations.filter((item) => item.capabilities.includes(capability.name)).map((item) => item.name)),
    });
  }

  const knownComponentNames = new Set(listComponents().map((component) => component.name));
  for (const automation of automations) {
    for (const component of automation.components) if (!knownComponentNames.has(component)) errors.push(`automation ${automation.name} declares unknown component: ${component}`);
  }
  for (const capability of capabilityNodes) {
    for (const component of capability.components) if (!knownComponentNames.has(component)) errors.push(`capability ${capability.name} declares unknown component: ${component}`);
  }

  const componentNodes: ComponentUsageNode[] = listComponents().map((component) => {
    const directAutomationConsumers = unique(automations.filter((item) => item.components.includes(component.name)).map((item) => item.name));
    const capabilityConsumers = unique(capabilityNodes.filter((item) => item.components.includes(component.name)).map((item) => item.name));
    const viaCapabilities = capabilityNodes
      .filter((item) => item.components.includes(component.name))
      .flatMap((item) => item.automationConsumers);
    return {
      name: component.name,
      version: component.version,
      directAutomationConsumers,
      capabilityConsumers,
      automationConsumers: unique([...directAutomationConsumers, ...viaCapabilities]),
    };
  });

  const profileNames = unique(automations.map((item) => item.profile ?? ''));
  const profiles = profileNames.map((name) => ({
    name,
    automationConsumers: unique(automations.filter((item) => item.profile === name).map((item) => item.name)),
  }));

  return {
    automations: automations.sort((a, b) => a.name.localeCompare(b.name)),
    capabilities: capabilityNodes.sort((a, b) => a.name.localeCompare(b.name)),
    components: componentNodes.sort((a, b) => a.name.localeCompare(b.name)),
    profiles: profiles.sort((a, b) => a.name.localeCompare(b.name)),
    errors: unique(errors),
  };
}

export function usageImpact(graph: UsageGraph, kind: UsageImpact['kind'], name: string): UsageImpact {
  if (kind === 'component') {
    const item = graph.components.find((node) => node.name === name);
    return {
      kind,
      name,
      exists: Boolean(item),
      directConsumers: item ? unique([...item.directAutomationConsumers, ...item.capabilityConsumers]) : [],
      transitiveAutomationConsumers: item?.automationConsumers ?? [],
      count: item?.automationConsumers.length ?? 0,
    };
  }
  if (kind === 'capability') {
    const item = graph.capabilities.find((node) => node.name === name);
    return {
      kind,
      name,
      exists: Boolean(item),
      directConsumers: item?.automationConsumers ?? [],
      transitiveAutomationConsumers: item?.automationConsumers ?? [],
      count: item?.automationConsumers.length ?? 0,
    };
  }
  const item = graph.profiles.find((node) => node.name === name);
  return {
    kind,
    name,
    exists: Boolean(item),
    directConsumers: item?.automationConsumers ?? [],
    transitiveAutomationConsumers: item?.automationConsumers ?? [],
    count: item?.automationConsumers.length ?? 0,
  };
}

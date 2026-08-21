import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { CapabilityContract } from './types.js';
import { assessCapabilityCandidate, type CapabilityMetadata } from './capability-governance.js';
import { getComponent } from './component-registry.js';

export interface CapabilityCheckItem {
  name: string;
  ok: boolean;
  message?: string;
}

export interface CapabilityCheckResult {
  ok: boolean;
  checks: CapabilityCheckItem[];
  metadata?: CapabilityMetadata;
}

function validStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim().length > 0);
}

export async function checkCapability(capability: CapabilityContract, all: CapabilityContract[], strict = false): Promise<CapabilityCheckResult> {
  const checks: CapabilityCheckItem[] = [];
  const push = (name: string, ok: boolean, message?: string) => checks.push({ name, ok, message });
  let raw: any;
  try {
    raw = JSON.parse(await readFile(capability.path, 'utf8'));
  } catch (error) {
    push('manifest', false, error instanceof Error ? error.message : 'invalid manifest');
    return { ok: false, checks };
  }

  const metadata: CapabilityMetadata = {
    name: capability.name,
    version: capability.version,
    description: capability.description,
    purpose: typeof raw.purpose === 'string' ? raw.purpose : undefined,
    domain: typeof raw.domain === 'string' ? raw.domain : undefined,
    operations: validStringArray(raw.operations) ? raw.operations : undefined,
    keywords: validStringArray(raw.keywords) ? raw.keywords : undefined,
    sideEffects: raw.sideEffects,
    idempotency: raw.idempotency,
    components: validStringArray(raw.components) ? raw.components : undefined,
    status: raw.status || 'active',
    supersededBy: typeof raw.supersededBy === 'string' ? raw.supersededBy : undefined,
  };

  push('implementation', await stat(capability.canonicalPath).then(() => true, () => false), capability.canonicalPath);
  const docPath = path.join(capability.root, 'CAPABILITY.md');
  const docExists = await access(docPath).then(() => true, () => false);
  push('documentation', strict ? docExists : true, docExists ? docPath : 'legacy capability: CAPABILITY.md recommended');

  const governanceFields = Boolean(metadata.purpose && metadata.domain && metadata.operations?.length);
  push('governance-metadata', strict ? governanceFields : true, governanceFields ? 'complete' : 'legacy capability metadata');

  const allowedSideEffects = new Set(['none', 'read', 'write', 'mixed']);
  const allowedIdempotency = new Set(['not-applicable', 'caller', 'supported', 'required']);
  push('side-effects', !metadata.sideEffects || allowedSideEffects.has(metadata.sideEffects), metadata.sideEffects || 'unspecified');
  push('idempotency', !metadata.idempotency || allowedIdempotency.has(metadata.idempotency), metadata.idempotency || 'unspecified');

  const unknownComponents = (metadata.components ?? []).filter((name) => !getComponent(name));
  push('components', unknownComponents.length === 0, unknownComponents.length ? `unknown: ${unknownComponents.join(', ')}` : 'ok');

  if (metadata.status === 'superseded') push('superseded-by', Boolean(metadata.supersededBy), metadata.supersededBy || 'missing supersededBy');
  else push('superseded-by', true, 'not superseded');

  const others = all.filter((item) => item.path !== capability.path);
  const conflicts = governanceFields ? await assessCapabilityCandidate(metadata, others) : [];
  const hard = conflicts.filter((item) => item.severity === 'hard');
  push('duplicate-governance', hard.length === 0, hard.length ? hard.map((item) => `${item.name}: ${item.reason.join(', ')}`).join('; ') : 'none');

  return { ok: checks.every((item) => item.ok), checks, metadata };
}

import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CapabilityContract } from './types.js';
import { assessCapabilityCandidate, type CapabilityMetadata } from './capability-governance.js';

export interface CapabilityScaffoldInput extends CapabilityMetadata {
  root: string;
  overlapRationale?: string;
}

export interface CapabilityScaffoldResult {
  created: boolean;
  path?: string;
  conflicts: Awaited<ReturnType<typeof assessCapabilityCandidate>>;
}

function validName(name: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

function assertCandidate(input: CapabilityScaffoldInput) {
  if (!validName(input.name)) throw new Error('capability name must be kebab-case');
  if (!input.description?.trim()) throw new Error('capability description is required');
  if (!input.purpose?.trim()) throw new Error('capability purpose is required');
  if (!input.domain?.trim()) throw new Error('capability domain is required');
  if (!input.operations?.length || input.operations.some((item) => !item.trim())) throw new Error('at least one capability operation is required');
}

function capabilityDoc(input: CapabilityScaffoldInput) {
  return `# ${input.name}\n\n## Purpose\n\n${input.purpose}\n\n## When to use\n\nUse this capability for ${input.description.replace(/\.$/, '')}.\n\n## When not to use\n\nDo not use it for unrelated ${input.domain} business decisions or automation-specific orchestration.\n\n## Operations\n\n${input.operations!.map((item) => `- \`${item}\``).join('\n')}\n\n## Inputs / outputs\n\n- Input: ${input.input || 'Define the minimal typed input contract.'}\n- Output: ${input.output || 'Define the minimal typed output contract.'}\n\n## Side effects\n\n${input.sideEffects || 'Declare before production use.'}\n\n## Idempotency\n\n${input.idempotency || 'Declare before production use.'}\n\n## Components\n\n${input.components?.length ? input.components.map((item) => `- \`${item}\``).join('\n') : '- Add only TaskRail components actually used.'}\n`;
}

function testSkeleton(name: string) {
  return `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport * as capability from '../index.js';\n\ntest('${name} loads and exposes its run contract', () => {\n  assert.equal(typeof capability.run, 'function');\n});\n`;
}

export async function scaffoldCapability(input: CapabilityScaffoldInput, existing: CapabilityContract[]): Promise<CapabilityScaffoldResult> {
  assertCandidate(input);
  const conflicts = await assessCapabilityCandidate(input, existing);
  const hard = conflicts.filter((item) => item.severity === 'hard');
  const soft = conflicts.filter((item) => item.severity === 'soft');
  if (hard.length) return { created: false, conflicts };
  if (soft.length && !input.overlapRationale?.trim()) return { created: false, conflicts };

  const target = path.resolve(input.root, input.name);
  if (await stat(target).then(() => true, () => false)) throw new Error(`capability path already exists: ${target}`);
  await mkdir(path.join(target, 'test'), { recursive: true });

  const manifest = {
    name: input.name,
    version: input.version || '1.0.0',
    description: input.description,
    purpose: input.purpose,
    domain: input.domain,
    operations: input.operations,
    keywords: input.keywords ?? [],
    sideEffects: input.sideEffects ?? 'none',
    idempotency: input.idempotency ?? 'not-applicable',
    components: input.components ?? [],
    status: 'active',
    runtime: 'node',
    canonicalPath: 'index.js',
    input: input.input,
    output: input.output,
  };

  await writeFile(path.join(target, 'capability.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  await writeFile(path.join(target, 'CAPABILITY.md'), capabilityDoc(input), { flag: 'wx' });
  await writeFile(path.join(target, 'index.js'), `export async function run(input) {\n  throw new Error('implement ${input.name}');\n}\n`, { flag: 'wx' });
  await writeFile(path.join(target, 'test', 'capability.test.js'), testSkeleton(input.name), { flag: 'wx' });
  if (input.overlapRationale?.trim()) await writeFile(path.join(target, 'OVERLAP-RATIONALE.md'), `${input.overlapRationale.trim()}\n`, { flag: 'wx' });
  return { created: true, path: target, conflicts };
}

import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { frameworkProfiles } from './framework.js';

export interface AutomationScaffoldInput {
  name: string;
  profile: string;
  root?: string;
}

function validName(name: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

function runtimeForProfile(profile: string): 'node' | 'shell' | 'php' {
  if (profile.includes('shell')) return 'shell';
  if (profile.includes('php')) return 'php';
  return 'node';
}

function filesFor(runtime: 'node' | 'shell' | 'php') {
  if (runtime === 'shell') return {
    entry: 'src/index.sh',
    entryContent: '#!/usr/bin/env bash\nset -euo pipefail\n\necho "automation not implemented"\n',
    test: 'tests/self-test.sh',
    testContent: '#!/usr/bin/env bash\nset -euo pipefail\nbash -n src/index.sh\n',
    validationCommand: 'bash -n src/index.sh',
    testCommand: 'bash tests/self-test.sh',
    healthCheck: { type: 'command', command: 'bash -n src/index.sh' } as const,
  };
  if (runtime === 'php') return {
    entry: 'src/index.php',
    entryContent: '<?php\ndeclare(strict_types=1);\n\necho "automation not implemented\\n";\n',
    test: 'tests/self-test.php',
    testContent: '<?php\ndeclare(strict_types=1);\n\n$code = 0;\npassthru("php -l src/index.php", $code);\nexit($code);\n',
    validationCommand: 'php -l src/index.php',
    testCommand: 'php tests/self-test.php',
    healthCheck: { type: 'command', command: 'php -l src/index.php' } as const,
  };
  return {
    entry: 'src/index.js',
    entryContent: 'export async function run() {\n  return { ok: true };\n}\n\nif (import.meta.url === `file://${process.argv[1]}`) {\n  run().then(console.log);\n}\n',
    test: 'tests/self-test.test.js',
    testContent: "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { run } from '../src/index.js';\n\ntest('automation self-test', async () => {\n  assert.deepEqual(await run(), { ok: true });\n});\n",
    validationCommand: 'node --check src/index.js',
    testCommand: 'node --test tests/*.test.js',
    healthCheck: { type: 'command', command: 'node --check src/index.js' } as const,
  };
}

export async function scaffoldAutomation(input: AutomationScaffoldInput) {
  if (!validName(input.name)) throw new Error('automation name must be kebab-case');
  if (!frameworkProfiles[input.profile]) throw new Error(`unknown TaskRail profile: ${input.profile}`);
  const root = path.resolve(input.root || process.cwd());
  const target = path.join(root, input.name);
  if (await stat(target).then(() => true, () => false)) throw new Error(`automation path already exists: ${target}`);

  const runtime = runtimeForProfile(input.profile);
  const files = filesFor(runtime);
  await mkdir(path.join(target, 'src'), { recursive: true });
  await mkdir(path.join(target, 'tests'), { recursive: true });

  const manifest = {
    name: input.name,
    taskrailCompatibility: '2.0.x',
    profile: input.profile,
    runtime,
    managed: true,
    sourceDir: '.',
    validationCommand: files.validationCommand,
    testCommand: files.testCommand,
    requiredChecks: ['validation', 'test', 'health'],
    healthCheck: files.healthCheck,
    capabilities: [],
  };

  const agents = `# ${input.name}\n\nBefore substantial implementation:\n1. Run \`taskrail components\`.\n2. Run \`taskrail capability-find "<needed behavior>"\`.\n3. Record REUSE, EXTEND, CREATE, or LOCAL before coding.\n4. Prefer TaskRail components for generic infrastructure and capabilities for reusable integrations.\n5. Do not create TaskRail components here.\n6. Use \`doctor -> check -> test -> plan -> ship -> health\`.\n`;

  await writeFile(path.join(target, 'automation.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  await writeFile(path.join(target, 'AGENTS.md'), agents, { flag: 'wx' });
  await writeFile(path.join(target, 'README.md'), `# ${input.name}\n\nTaskRail-managed automation.\n`, { flag: 'wx' });
  await writeFile(path.join(target, files.entry), files.entryContent, { flag: 'wx', mode: runtime === 'shell' ? 0o755 : 0o644 });
  await writeFile(path.join(target, files.test), files.testContent, { flag: 'wx', mode: runtime === 'shell' ? 0o755 : 0o644 });
  return { path: target, profile: input.profile, runtime };
}

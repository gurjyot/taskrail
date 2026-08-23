import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveFrameworkManifest } from './framework.js';

export interface AutomationScaffoldInput {
  name: string;
  profile: string;
  root?: string;
}

type ScaffoldRuntime = 'node' | 'shell' | 'php';

function validName(name: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

function filesFor(runtime: ScaffoldRuntime) {
  if (runtime === 'shell') return {
    entry: 'src/main.sh',
    entryContent: '#!/usr/bin/env bash\nset -euo pipefail\n\necho "automation not implemented"\n',
    test: 'tests/self-test.sh',
    testContent: '#!/usr/bin/env bash\nset -euo pipefail\nbash -n src/main.sh\n',
  };
  if (runtime === 'php') return {
    entry: 'src/main.php',
    entryContent: '<?php\ndeclare(strict_types=1);\n\necho "automation not implemented\\n";\n',
    test: 'tests/self-test.php',
    testContent: '<?php\ndeclare(strict_types=1);\n\n$code = 0;\npassthru("php -l src/main.php", $code);\nexit($code);\n',
  };
  return {
    entry: 'src/main.js',
    entryContent: 'export async function run() {\n  return { ok: true };\n}\n\nif (import.meta.url === `file://${process.argv[1]}`) {\n  run().then(console.log);\n}\n',
    test: 'tests/self-test.test.js',
    testContent: "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { run } from '../src/main.js';\n\ntest('automation self-test', async () => {\n  assert.deepEqual(await run(), { ok: true });\n});\n",
  };
}

export async function scaffoldAutomation(input: AutomationScaffoldInput) {
  if (!validName(input.name)) throw new Error('automation name must be kebab-case');

  const resolved = resolveFrameworkManifest({ name: input.name, profile: input.profile });
  if (resolved.runtime !== 'node' && resolved.runtime !== 'shell' && resolved.runtime !== 'php') {
    throw new Error(`profile runtime is not scaffoldable: ${resolved.runtime}`);
  }

  const root = path.resolve(input.root ?? process.cwd());
  const target = path.join(root, input.name);
  if (await stat(target).then(() => true, () => false)) throw new Error(`automation path already exists: ${target}`);

  const runtime: ScaffoldRuntime = resolved.runtime;
  const files = filesFor(runtime);
  await Promise.all([
    mkdir(path.join(target, 'src'), { recursive: true }),
    mkdir(path.join(target, 'tests'), { recursive: true }),
  ]);

  const manifest = {
    name: input.name,
    profile: input.profile,
    capabilities: [],
  };

  const agents = `# ${input.name}\n\nPrimary rule: keep this automation thin. Write business logic here; let TaskRail own repeated infrastructure.\n\nBefore substantial implementation:\n1. Run \`taskrail capability-find "<needed behavior>"\`.\n2. Reuse an existing capability when possible.\n3. Add only business-specific manifest fields that TaskRail cannot infer.\n4. Use \`taskrail test\` and \`taskrail check\` during development.\n5. Use \`doctor -> check -> test -> plan -> ship -> health\` for production changes.\n`;
  const fileMode = runtime === 'shell' ? 0o755 : 0o644;

  await Promise.all([
    writeFile(path.join(target, 'automation.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' }),
    writeFile(path.join(target, 'AGENTS.md'), agents, { flag: 'wx' }),
    writeFile(path.join(target, 'README.md'), `# ${input.name}\n\nTaskRail-managed automation. Keep business logic here; TaskRail supplies the standard runtime and production guardrails for profile \`${input.profile}\`.\n`, { flag: 'wx' }),
    writeFile(path.join(target, files.entry), files.entryContent, { flag: 'wx', mode: fileMode }),
    writeFile(path.join(target, files.test), files.testContent, { flag: 'wx', mode: fileMode }),
  ]);

  return { path: target, profile: input.profile, runtime };
}

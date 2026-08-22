import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const gates = [];

function run(name, args) {
  try {
    execFileSync(npm, args, { cwd: root, stdio: 'inherit', env: process.env, timeout: 10 * 60 * 1000, maxBuffer: 256 * 1024 });
    gates.push({ name, ok: true });
  } catch (error) {
    gates.push({ name, ok: false, detail: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) });
  }
}

run('core-ci', ['test']);
run('public-api-security', ['run', 'check']);
run('performance', ['run', 'performance:check']);
run('release-readiness', ['run', 'release:readiness']);
run('install-release-build', ['run', 'build:install-release']);
run('fault-injection-contract', ['run', 'fault:contract']);

const failed = gates.filter((gate) => !gate.ok).map((gate) => gate.name);
const report = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  certified: failed.length === 0,
  verdict: failed.length === 0 ? 'TASKRAIL CERTIFIED - PASS' : 'TASKRAIL CERTIFICATION - FAIL',
  failed,
  gates,
};

await mkdir(path.join(root, '.taskrail'), { recursive: true, mode: 0o700 });
await writeFile(path.join(root, '.taskrail', 'certification.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
if (!report.certified) process.exitCode = 1;

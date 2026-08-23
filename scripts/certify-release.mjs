import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const gates = [];

function tail(value, limit = 4000) {
  const text = String(value || '').trim();
  return text.length <= limit ? text : text.slice(-limit);
}

function run(name, args) {
  try {
    const stdout = execFileSync(npm, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      timeout: 10 * 60 * 1000,
      maxBuffer: 2 * 1024 * 1024,
    });
    if (stdout) process.stdout.write(stdout);
    gates.push({ name, ok: true });
  } catch (error) {
    const stdout = error && typeof error === 'object' && 'stdout' in error ? tail(error.stdout) : '';
    const stderr = error && typeof error === 'object' && 'stderr' in error ? tail(error.stderr) : '';
    if (stdout) process.stdout.write(`${stdout}\n`);
    if (stderr) process.stderr.write(`${stderr}\n`);
    const message = error instanceof Error ? error.message : String(error);
    gates.push({
      name,
      ok: false,
      detail: tail([message, stdout && `stdout:\n${stdout}`, stderr && `stderr:\n${stderr}`].filter(Boolean).join('\n'), 6000),
    });
  }
}

run('update-surfaces', ['run', 'surfaces:check']);
run('core-ci', ['test']);
run('public-api-security', ['run', 'check']);
run('mcp-packed-compatibility', ['run', 'mcp:check']);
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

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

function failureBlocks(value) {
  const lines = String(value || '').split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^not ok\b/.test(lines[i])) continue;
    const start = Math.max(0, i - 1);
    let end = Math.min(lines.length, i + 18);
    for (let j = i + 1; j < Math.min(lines.length, i + 40); j += 1) {
      if (/^(ok|not ok)\b/.test(lines[j])) { end = j; break; }
    }
    blocks.push(lines.slice(start, end).join('\n').trim());
  }
  return blocks.join('\n\n');
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
    const rawStdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout || '') : '';
    const rawStderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr || '') : '';
    const highlights = failureBlocks(rawStdout);
    const stdout = highlights || tail(rawStdout);
    const stderr = tail(rawStderr);
    if (rawStdout) process.stdout.write(rawStdout);
    if (rawStderr) process.stderr.write(rawStderr);
    const message = error instanceof Error ? error.message : String(error);
    gates.push({
      name,
      ok: false,
      detail: tail([message, stdout && `stdout:\n${stdout}`, stderr && `stderr:\n${stderr}`].filter(Boolean).join('\n'), 8000),
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

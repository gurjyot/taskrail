import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { assessPerformanceBudget } from '../dist/src/performance-budget.js';
import { validateConfig } from '../dist/src/validation.js';

const root = process.cwd();
const cli = path.join(root, 'dist', 'src', 'taskrail-cli.js');

const startupStart = performance.now();
const startup = spawnSync(process.execPath, [cli, '--help'], {
  cwd: root,
  encoding: 'utf8',
  timeout: 5_000,
  maxBuffer: 256 * 1024,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const startupMs = performance.now() - startupStart;
if (startup.status !== 0 || startup.error) {
  console.error(startup.error?.message || startup.stderr || `TaskRail CLI startup exited ${startup.status}`);
  process.exit(1);
}

const config = {
  projectName: 'performance-probe',
  manifest: {
    name: 'performance-probe',
    managed: true,
    runtime: 'node',
    sourceDir: '.',
    deployDir: './live',
    validationCommand: 'node --check index.js',
    testCommand: 'node --test',
    runtimeVersion: '>=22.0.0',
    requiredChecks: ['validation', 'test'],
    runtimePaths: ['node_modules', 'logs', 'state', 'tmp', 'cache'],
  },
};

const validationStart = performance.now();
let validationErrors = [];
for (let index = 0; index < 100; index += 1) validationErrors = validateConfig(config);
const validationMs = (performance.now() - validationStart) / 100;
if (validationErrors.length) {
  console.error(`performance probe manifest invalid: ${validationErrors.join(', ')}`);
  process.exit(1);
}

const memoryMb = process.memoryUsage().rss / (1024 * 1024);
const measurement = { startupMs, validationMs, memoryMb };
const assessment = assessPerformanceBudget(measurement);
console.log(JSON.stringify({ measurement, budget: assessment }, null, 2));
if (!assessment.ok) process.exitCode = 1;

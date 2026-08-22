import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assessPerformanceBudget } from '../dist/src/performance-budget.js';
import { validateConfig } from '../dist/src/validation.js';

const root = process.cwd();
const cli = path.join(root, 'dist', 'src', 'taskrail-cli.js');
const startupSamples = Number.parseInt(process.env.TASKRAIL_PERF_STARTUP_SAMPLES || '20', 10);
const validationSamples = Number.parseInt(process.env.TASKRAIL_PERF_VALIDATION_SAMPLES || '200', 10);

if (!Number.isInteger(startupSamples) || startupSamples < 5 || startupSamples > 100) {
  throw new Error('TASKRAIL_PERF_STARTUP_SAMPLES must be an integer between 5 and 100');
}
if (!Number.isInteger(validationSamples) || validationSamples < 20 || validationSamples > 10_000) {
  throw new Error('TASKRAIL_PERF_VALIDATION_SAMPLES must be an integer between 20 and 10000');
}

function percentile(values, percent) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1));
  return sorted[index];
}

function round(value, digits = 3) {
  return Number(value.toFixed(digits));
}

const startupMs = [];
for (let index = 0; index < startupSamples; index += 1) {
  const startedAt = performance.now();
  const startup = spawnSync(process.execPath, [cli, '--help'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 256 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const elapsed = performance.now() - startedAt;
  if (startup.status !== 0 || startup.error) {
    console.error(startup.error?.message || startup.stderr || `TaskRail CLI startup exited ${startup.status}`);
    process.exit(1);
  }
  startupMs.push(elapsed);
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
for (let index = 0; index < validationSamples; index += 1) validationErrors = validateConfig(config);
const validationMs = (performance.now() - validationStart) / validationSamples;
if (validationErrors.length) {
  console.error(`performance probe manifest invalid: ${validationErrors.join(', ')}`);
  process.exit(1);
}

const memoryMb = process.memoryUsage().rss / (1024 * 1024);
const startup = {
  samples: startupSamples,
  minMs: round(Math.min(...startupMs)),
  medianMs: round(percentile(startupMs, 50)),
  p95Ms: round(percentile(startupMs, 95)),
  maxMs: round(Math.max(...startupMs)),
};

// Use p95 rather than a lucky single sample for the release budget.
const measurement = {
  startupMs: startup.p95Ms,
  validationMs: round(validationMs, 6),
  memoryMb: round(memoryMb),
};
const assessment = assessPerformanceBudget(measurement);

const report = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  environment: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cpus: os.cpus().length,
    ci: Boolean(process.env.CI),
    githubSha: process.env.GITHUB_SHA || null,
    githubRunId: process.env.GITHUB_RUN_ID || null,
  },
  startup,
  validation: {
    samples: validationSamples,
    averageMs: measurement.validationMs,
  },
  memory: {
    rssMb: measurement.memoryMb,
  },
  budgetMeasurement: measurement,
  budget: assessment,
};

writeFileSync(path.join(root, 'performance-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    '## TaskRail performance',
    '',
    '| Metric | Result |',
    '| --- | ---: |',
    `| CLI startup median | ${startup.medianMs} ms |`,
    `| CLI startup p95 | ${startup.p95Ms} ms |`,
    `| CLI startup max | ${startup.maxMs} ms |`,
    `| Manifest validation average | ${measurement.validationMs} ms |`,
    `| RSS | ${measurement.memoryMb} MiB |`,
    `| Release budget | ${assessment.ok ? 'PASS' : 'FAIL'} |`,
    '',
    `Samples: ${startupSamples} startup processes, ${validationSamples} validations.`,
    '',
  ].join('\n'));
}

if (!assessment.ok) process.exitCode = 1;

import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assessPerformanceBudget } from '../dist/src/performance-budget.js';
import { validateConfig } from '../dist/src/validation.js';

const root = process.cwd();
const cli = path.join(root, 'dist', 'src', 'taskrail-cli.js');
const baseline = JSON.parse(readFileSync(path.join(root, 'scripts', 'performance-baseline.json'), 'utf8'));
const startupSamples = Number.parseInt(process.env.TASKRAIL_PERF_STARTUP_SAMPLES || '20', 10);
const validationSamples = Number.parseInt(process.env.TASKRAIL_PERF_VALIDATION_SAMPLES || '200', 10);
const memorySamples = Number.parseInt(process.env.TASKRAIL_PERF_MEMORY_SAMPLES || '5', 10);

if (!Number.isInteger(startupSamples) || startupSamples < 5 || startupSamples > 100) {
  throw new Error('TASKRAIL_PERF_STARTUP_SAMPLES must be an integer between 5 and 100');
}
if (!Number.isInteger(validationSamples) || validationSamples < 20 || validationSamples > 10_000) {
  throw new Error('TASKRAIL_PERF_VALIDATION_SAMPLES must be an integer between 20 and 10000');
}
if (!Number.isInteger(memorySamples) || memorySamples < 3 || memorySamples > 20) {
  throw new Error('TASKRAIL_PERF_MEMORY_SAMPLES must be an integer between 3 and 20');
}
if (baseline.schema !== 1 || !Number.isFinite(baseline.startupP95Ms) || !Number.isFinite(baseline.maxStartupRegressionFactor)) {
  throw new Error('invalid scripts/performance-baseline.json');
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

const memoryProbeSource = `
process.argv = [process.execPath, ${JSON.stringify(cli)}, '--help'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
await new Promise((resolve) => setImmediate(resolve));
process.stderr.write('__TASKRAIL_MAX_RSS_KB__=' + process.resourceUsage().maxRSS + '\\n');
`;
const memoryMbSamples = [];
for (let index = 0; index < memorySamples; index += 1) {
  const probe = spawnSync(process.execPath, ['--input-type=module', '--eval', memoryProbeSource], {
    cwd: root,
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 256 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (probe.status !== 0 || probe.error) {
    console.error(probe.error?.message || probe.stderr || `TaskRail memory probe exited ${probe.status}`);
    process.exit(1);
  }
  const match = String(probe.stderr).match(/__TASKRAIL_MAX_RSS_KB__=(\d+(?:\.\d+)?)/);
  if (!match) {
    console.error('TaskRail memory probe did not report max RSS');
    process.exit(1);
  }
  memoryMbSamples.push(Number(match[1]) / 1024);
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

const startup = {
  samples: startupSamples,
  minMs: round(Math.min(...startupMs)),
  medianMs: round(percentile(startupMs, 50)),
  p95Ms: round(percentile(startupMs, 95)),
  maxMs: round(Math.max(...startupMs)),
};
const memory = {
  samples: memorySamples,
  minMb: round(Math.min(...memoryMbSamples)),
  medianMb: round(percentile(memoryMbSamples, 50)),
  peakMb: round(Math.max(...memoryMbSamples)),
  measurement: 'child-process maxRSS',
};

// Use p95 rather than a lucky single sample for the release budget.
const measurement = {
  startupMs: startup.p95Ms,
  validationMs: round(validationMs, 6),
  memoryMb: memory.peakMb,
};
const assessment = assessPerformanceBudget(measurement);
const regressionLimitMs = baseline.startupP95Ms * baseline.maxStartupRegressionFactor;
const startupRegression = {
  baselineP95Ms: baseline.startupP95Ms,
  currentP95Ms: startup.p95Ms,
  ratio: round(startup.p95Ms / baseline.startupP95Ms, 3),
  maxRegressionFactor: baseline.maxStartupRegressionFactor,
  limitMs: round(regressionLimitMs),
  ok: startup.p95Ms <= regressionLimitMs,
};
const ok = assessment.ok && startupRegression.ok;

const report = {
  schema: 2,
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
  startupRegression,
  validation: {
    samples: validationSamples,
    averageMs: measurement.validationMs,
  },
  memory,
  budgetMeasurement: measurement,
  budget: assessment,
  ok,
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
    `| Startup regression vs ${baseline.startupP95Ms} ms baseline | ${startupRegression.ratio}x (${startupRegression.ok ? 'PASS' : 'FAIL'}) |`,
    `| CLI peak RSS | ${memory.peakMb} MiB |`,
    `| Manifest validation average | ${measurement.validationMs} ms |`,
    `| Absolute release budget | ${assessment.ok ? 'PASS' : 'FAIL'} |`,
    `| Overall | ${ok ? 'PASS' : 'FAIL'} |`,
    '',
    `Samples: ${startupSamples} startup processes, ${memorySamples} child memory probes, ${validationSamples} validations.`,
    '',
  ].join('\n'));
}

if (!ok) process.exitCode = 1;

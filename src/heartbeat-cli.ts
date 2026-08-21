#!/usr/bin/env node
import path from 'node:path';
import { createExecutionContext, writeHeartbeat } from './execution.js';

type RequestedStatus = 'starting' | 'running' | 'ok' | 'failed' | 'systemd';

function normalizeAutomation(value: string) {
  return value.replace(/\.(service|timer)$/, '');
}

function systemdStatus(): { status: 'ok' | 'failed'; details: string } {
  const result = process.env.SERVICE_RESULT || 'unknown';
  const exitCode = process.env.EXIT_CODE || '';
  const exitStatus = process.env.EXIT_STATUS || '';
  const ok = result === 'success';
  return { status: ok ? 'ok' : 'failed', details: [result, exitCode, exitStatus].filter(Boolean).join(':') };
}

async function main() {
  const [incomingAutomation, requested, ...args] = process.argv.slice(2);
  if (!incomingAutomation || !requested || args.includes('--help') || incomingAutomation === '--help') {
    console.log('taskrail-heartbeat <automation|unit.service> <starting|running|ok|failed|systemd> [--state=/path] [--execution=id] [--details=text]');
    return;
  }
  if (!['starting', 'running', 'ok', 'failed', 'systemd'].includes(requested)) throw new Error('invalid heartbeat status');
  const automation = normalizeAutomation(incomingAutomation);
  const stateArg = args.find((arg) => arg.startsWith('--state='));
  const executionArg = args.find((arg) => arg.startsWith('--execution='));
  const detailsArg = args.find((arg) => arg.startsWith('--details='));
  const stateDir = path.resolve(stateArg ? stateArg.slice('--state='.length) : `/opt/smg-automations/state/${automation}`);
  const context = createExecutionContext(automation, stateDir);
  const executionId = executionArg?.slice('--execution='.length) || process.env.TASKRAIL_EXECUTION_ID || process.env.INVOCATION_ID || context.executionId;
  const resolved = requested === 'systemd' ? systemdStatus() : { status: requested as Exclude<RequestedStatus, 'systemd'>, details: detailsArg?.slice('--details='.length) };
  await writeHeartbeat(stateDir, {
    automation,
    executionId,
    status: resolved.status,
    updatedAt: new Date().toISOString(),
    details: resolved.details,
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

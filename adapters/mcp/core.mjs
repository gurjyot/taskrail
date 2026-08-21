import { createHash, randomUUID } from 'node:crypto';
import { appendFile, chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export const MCP_PROTOCOL_TARGET = '2026-07-28';
export const MAX_TOOL_OUTPUT_BYTES = 1024 * 1024;
export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

export const readTools = Object.freeze([
  {
    name: 'taskrail_components',
    description: 'List TaskRail-owned reusable components.',
    cli: () => ['components'],
  },
  {
    name: 'taskrail_capability_find',
    description: 'Search existing governed capabilities before considering a new capability.',
    cli: ({ query }) => ['capability-find', requireText(query, 'query', 500)],
  },
  {
    name: 'taskrail_usage',
    description: 'Inspect the component, capability, and profile usage graph and blast radius.',
    cli: () => ['usage'],
  },
  {
    name: 'taskrail_conformance',
    description: 'Run TaskRail engineering, isolation, reliability, and performance conformance checks.',
    cli: () => ['conformance'],
  },
  {
    name: 'taskrail_security_audit',
    description: 'Run the strict TaskRail source security audit in the selected workspace.',
    cli: () => ['security', 'audit', '--strict'],
  },
  {
    name: 'taskrail_agent_contract',
    description: 'Describe TaskRail agent actions and mutation authorization policy.',
    cli: () => ['agent', 'describe'],
  },
]);

const toolsByName = new Map(readTools.map((tool) => [tool.name, tool]));

function requireText(value, name, max) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  const text = value.trim();
  if (text.length > max) throw new Error(`${name} exceeds ${max} characters`);
  if (/[\u0000\r\n]/.test(text)) throw new Error(`${name} contains unsupported control characters`);
  return text;
}

function taskrailCliPath() {
  const rootEntry = fileURLToPath(import.meta.resolve('taskrail'));
  return path.join(path.dirname(rootEntry), 'taskrail-cli.js');
}

function auditPath(cwd) {
  return path.resolve(process.env.TASKRAIL_MCP_AUDIT_FILE || path.join(cwd, '.taskrail', 'mcp-audit.jsonl'));
}

async function writeAudit(cwd, record) {
  const file = auditPath(cwd);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await chmod(path.dirname(file), 0o700).catch(() => undefined);
  await appendFile(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  if (process.platform !== 'win32') await chmod(file, 0o600).catch(() => undefined);
}

function requestHash(args) {
  return createHash('sha256').update(JSON.stringify(args ?? {})).digest('hex').slice(0, 24);
}

function safeFailure(message) {
  return String(message || 'TaskRail command failed')
    .replace(/(?:bearer\s+|token\s*[:=]\s*|password\s*[:=]\s*)[^\s,;]+/gi, '[REDACTED]')
    .slice(0, 2000);
}

export function toolCatalog() {
  return readTools.map(({ name, description }) => ({ name, description }));
}

export async function runReadTool(name, args = {}, options = {}) {
  const tool = toolsByName.get(name);
  if (!tool) throw new Error(`unknown or unauthorized TaskRail MCP tool: ${name}`);
  const cwd = path.resolve(options.cwd || process.env.TASKRAIL_WORKSPACE || process.cwd());
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TOOL_TIMEOUT_MS);
  const invocationId = randomUUID();
  const startedAt = new Date().toISOString();
  const cliArgs = tool.cli(args);
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let overflow = false;

  const outcome = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [taskrailCliPath(), ...cliArgs], {
      cwd,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    const collect = (target, chunk) => {
      const next = target + String(chunk);
      if (Buffer.byteLength(next) > MAX_TOOL_OUTPUT_BYTES) {
        overflow = true;
        child.kill();
        return target;
      }
      return next;
    };
    child.stdout.on('data', (chunk) => { stdout = collect(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = collect(stderr, chunk); });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  }).catch((error) => {
    stderr = error instanceof Error ? error.message : String(error);
    return 1;
  });

  const ok = outcome === 0 && !timedOut && !overflow;
  await writeAudit(cwd, {
    schema: 1,
    invocationId,
    at: startedAt,
    tool: name,
    risk: 'read',
    requestHash: requestHash(args),
    ok,
    exitCode: outcome,
    timedOut,
    outputLimited: overflow,
  });

  if (!ok) {
    if (timedOut) throw new Error(`TaskRail MCP tool timed out after ${timeoutMs}ms`);
    if (overflow) throw new Error('TaskRail MCP tool exceeded the output safety limit');
    throw new Error(safeFailure(stderr || `TaskRail command exited ${outcome}`));
  }
  return stdout.trim() || '{}';
}

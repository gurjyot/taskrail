import { spawn } from 'node:child_process';

export interface BoundedCommandOptions {
  command: string;
  cwd: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
}

export interface BoundedCommandResult {
  ok: boolean;
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  message: string;
}

function parseCommand(command: string) {
  const parts: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of command.matchAll(re)) parts.push(match[1] ?? match[2] ?? match[3]);
  return parts;
}

function executableForPlatform(rawBin: string) {
  if (rawBin === 'node') return process.execPath;
  if (process.platform !== 'win32') return rawBin;
  if (/\.(?:exe|cmd|bat)$/i.test(rawBin) || rawBin.includes('/') || rawBin.includes('\\')) return rawBin;
  return new Set(['npm', 'npx', 'pnpm', 'yarn', 'corepack']).has(rawBin.toLowerCase()) ? `${rawBin}.cmd` : rawBin;
}

function appendBounded(current: Buffer, chunk: Buffer, limit: number) {
  if (current.length >= limit) return { value: current, truncated: true };
  const remaining = limit - current.length;
  if (chunk.length <= remaining) return { value: Buffer.concat([current, chunk]), truncated: false };
  return { value: Buffer.concat([current, chunk.subarray(0, remaining)]), truncated: true };
}

export async function runBoundedCommand(options: BoundedCommandOptions): Promise<BoundedCommandResult> {
  const timeoutMs = options.timeoutMs ?? 300_000;
  const maxOutputBytes = options.maxOutputBytes ?? 256 * 1024;
  const [rawBin, ...args] = parseCommand(options.command);
  if (!rawBin) {
    return { ok: false, command: options.command, cwd: options.cwd, exitCode: 1, stdout: '', stderr: '', timedOut: false, truncated: false, message: 'empty command' };
  }

  return await new Promise((resolve) => {
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const child = spawn(executableForPlatform(rawBin), args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      const killTimer = setTimeout(() => child.kill('SIGKILL'), 2_000);
      killTimer.unref?.();
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on('data', (chunk: Buffer) => {
      const next = appendBounded(stdout, Buffer.from(chunk), maxOutputBytes);
      stdout = next.value;
      truncated ||= next.truncated;
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const next = appendBounded(stderr, Buffer.from(chunk), maxOutputBytes);
      stderr = next.value;
      truncated ||= next.truncated;
    });

    const finish = (exitCode: number | null, error?: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const suffix = truncated ? '\n[TRUNCATED]' : '';
      const out = stdout.toString('utf8') + (truncated && stdout.length >= maxOutputBytes ? suffix : '');
      const err = stderr.toString('utf8') + (truncated && stderr.length >= maxOutputBytes ? suffix : '');
      const message = error
        ? error.code === 'ENOENT' ? `missing executable: ${rawBin}` : error.message
        : timedOut ? `timed out after ${timeoutMs}ms`
          : exitCode === 0 ? 'ok' : `exit ${exitCode ?? 1}`;
      resolve({
        ok: !error && !timedOut && exitCode === 0,
        command: options.command,
        cwd: options.cwd,
        exitCode,
        stdout: out,
        stderr: err,
        timedOut,
        truncated,
        message,
      });
    };

    child.on('error', (error: NodeJS.ErrnoException) => finish(1, error));
    child.on('exit', (code) => finish(code ?? 1));
  });
}

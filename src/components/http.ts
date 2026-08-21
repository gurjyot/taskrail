import { withRetry, withTimeout, type RetryOptions } from '../execution.js';

export interface HttpOptions {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  timeoutMs?: number;
  retry?: Partial<RetryOptions>;
  retryUnsafeMethods?: boolean;
  acceptStatuses?: number[];
  maxResponseBytes?: number;
}

export interface HttpResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export class HttpError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'HttpError';
  }
}

function retryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function methodAllowsAutomaticRetry(method: string, unsafe: boolean) {
  return unsafe || ['GET', 'HEAD', 'OPTIONS'].includes(method);
}

async function readBoundedBody(response: Response, maxBytes: number) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(`response exceeds ${maxBytes} bytes`, response.status);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) throw new HttpError(`response exceeds ${maxBytes} bytes`, response.status);
  return new TextDecoder().decode(buffer);
}

export async function request(url: string | URL, options: HttpOptions = {}): Promise<HttpResult> {
  const method = (options.method || 'GET').toUpperCase();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxResponseBytes = options.maxResponseBytes ?? 5 * 1024 * 1024;
  const acceptStatuses = new Set(options.acceptStatuses ?? []);
  const retryEnabled = options.retry !== undefined && methodAllowsAutomaticRetry(method, options.retryUnsafeMethods === true);
  const retry: RetryOptions = {
    maxAttempts: options.retry?.maxAttempts ?? 3,
    baseDelayMs: options.retry?.baseDelayMs ?? 250,
    maxDelayMs: options.retry?.maxDelayMs ?? 5_000,
    jitter: options.retry?.jitter ?? true,
    shouldRetry: options.retry?.shouldRetry,
  };

  const execute = async () => withTimeout(async (signal) => {
    const response = await fetch(url, { method, headers: options.headers, body: options.body, signal });
    const accepted = response.ok || acceptStatuses.has(response.status);
    if (!accepted) throw new HttpError(`HTTP ${response.status} ${response.statusText}`.trim(), response.status);
    const body = method === 'HEAD' ? '' : await readBoundedBody(response, maxResponseBytes);
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => { headers[key] = value; });
    return { status: response.status, headers, body };
  }, timeoutMs);

  if (!retryEnabled) return execute();
  return withRetry(execute, {
    ...retry,
    shouldRetry: (error, attempt) => {
      if (retry.shouldRetry && retry.shouldRetry(error, attempt) === false) return false;
      return error instanceof HttpError ? Boolean(error.status && retryableStatus(error.status)) : true;
    },
  });
}

export async function json<T>(url: string | URL, options: HttpOptions = {}): Promise<{ status: number; headers: Record<string, string>; data: T }> {
  const result = await request(url, options);
  try {
    return { status: result.status, headers: result.headers, data: JSON.parse(result.body) as T };
  } catch {
    throw new HttpError('response is not valid JSON', result.status);
  }
}

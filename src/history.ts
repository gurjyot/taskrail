import { mkdir, appendFile, open, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface AuditEvent {
  ts: string;
  type: string;
  project: string;
  taskrailVersion: string;
  releaseId?: string;
  sha?: string;
  data?: Record<string, unknown>;
}

const DEFAULT_MAX_HISTORY_BYTES = 1024 * 1024;
const DEFAULT_MAX_HISTORY_EVENTS = 2000;
const TAIL_READ_BYTES = 64 * 1024;

async function compactAuditHistory(historyFile: string, maxBytes = DEFAULT_MAX_HISTORY_BYTES, maxEvents = DEFAULT_MAX_HISTORY_EVENTS) {
  const size = await stat(historyFile).then((value) => value.size, () => 0);
  if (size <= maxBytes) return;
  const body = await readFile(historyFile, 'utf8');
  const lines = body.split('\n').filter(Boolean);
  const retained = lines.slice(-maxEvents);
  await writeFile(historyFile, retained.length ? `${retained.join('\n')}\n` : '');
}

export async function appendAudit(historyFile: string, event: AuditEvent) {
  await mkdir(path.dirname(historyFile), { recursive: true });
  await appendFile(historyFile, `${JSON.stringify(event)}\n`);
  await compactAuditHistory(historyFile);
}

export async function readLastAudit(historyFile: string): Promise<AuditEvent | null> {
  let handle;
  try {
    handle = await open(historyFile, 'r');
    const fileStat = await handle.stat();
    if (!fileStat.size) return null;
    const bytes = Math.min(fileStat.size, TAIL_READ_BYTES);
    const buffer = Buffer.alloc(bytes);
    await handle.read(buffer, 0, bytes, fileStat.size - bytes);
    const lines = buffer.toString('utf8').trim().split('\n').filter(Boolean);
    return lines.length ? JSON.parse(lines.at(-1) as string) as AuditEvent : null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

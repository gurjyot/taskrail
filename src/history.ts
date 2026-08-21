import { mkdir, appendFile, readFile, readdir } from 'node:fs/promises';
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

export async function appendAudit(historyFile: string, event: AuditEvent) {
  await mkdir(path.dirname(historyFile), { recursive: true });
  await appendFile(historyFile, `${JSON.stringify(event)}\n`);
}

export async function readLastAudit(historyFile: string): Promise<AuditEvent | null> {
  try {
    const lines = (await readFile(historyFile, 'utf8')).trim().split('\n').filter(Boolean);
    return lines.length ? JSON.parse(lines.at(-1) as string) as AuditEvent : null;
  } catch {
    return null;
  }
}

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GateResult } from './gate.js';
import type { ChangeRisk } from './types.js';

export interface EvidenceRecord {
  kind: 'verify-change' | 'gate' | 'deploy';
  project: string;
  changedFiles?: string[];
  protectedPaths?: string[];
  risk?: ChangeRisk;
  gate?: GateResult;
  deployAllowed?: boolean;
  verdict?: string;
  ts?: string;
}

export async function writeEvidence(cwd: string, record: EvidenceRecord) {
  const dir = path.join(cwd, '.taskrail', 'evidence');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'latest.json');
  await writeFile(file, JSON.stringify({ ts: new Date().toISOString(), ...record }, null, 2));
  return file;
}

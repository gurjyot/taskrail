import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type UpdateTargetKind = 'framework' | 'component' | 'capability' | 'automation';
export type UpdateChangeClass = 'patch' | 'minor' | 'breaking';
export type UpdatePhase =
  | 'discovered'
  | 'impact-checked'
  | 'checkpointed'
  | 'staged'
  | 'validated'
  | 'simulated'
  | 'rollback-ready'
  | 'activated'
  | 'verified'
  | 'committed'
  | 'aborted'
  | 'rollback-required'
  | 'rollback-validated'
  | 'restored'
  | 'recovery-required';

export interface UpdateCheckpoint {
  transactionId: string;
  targetKind: UpdateTargetKind;
  targetName: string;
  changeClass: UpdateChangeClass;
  fromVersion?: string;
  toVersion?: string;
  currentRelease?: string;
  currentReleasePath?: string;
  lastKnownGoodRelease?: string;
  lastKnownGoodReleasePath?: string;
  affectedAutomations: string[];
  dependencySnapshotHash?: string;
  phase: UpdatePhase;
  createdAt: string;
  updatedAt: string;
  history: Array<{ phase: UpdatePhase; at: string; details?: string }>;
  recovery?: {
    previousReleaseVerified?: boolean;
    configurationVerified?: boolean;
    migrationCompatible?: boolean;
    details?: string;
  };
}

const allowedTransitions: Record<UpdatePhase, readonly UpdatePhase[]> = {
  'discovered': ['impact-checked', 'aborted', 'recovery-required'],
  'impact-checked': ['checkpointed', 'aborted', 'recovery-required'],
  'checkpointed': ['staged', 'aborted', 'rollback-required', 'recovery-required'],
  'staged': ['validated', 'aborted', 'rollback-required', 'recovery-required'],
  'validated': ['simulated', 'aborted', 'rollback-required', 'recovery-required'],
  'simulated': ['rollback-ready', 'aborted', 'rollback-required', 'recovery-required'],
  'rollback-ready': ['activated', 'aborted', 'rollback-required', 'recovery-required'],
  'activated': ['verified', 'rollback-required', 'recovery-required'],
  'verified': ['committed', 'rollback-required', 'recovery-required'],
  'committed': [],
  'aborted': [],
  'rollback-required': ['rollback-validated', 'recovery-required'],
  'rollback-validated': ['restored', 'recovery-required'],
  'restored': ['committed', 'recovery-required'],
  'recovery-required': ['rollback-required'],
};

function sanitize(value: string) {
  const result = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!result) throw new Error('transaction target name is empty after sanitization');
  return result;
}

async function atomicWriteJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  try {
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function transactionFile(root: string, targetKind: UpdateTargetKind, targetName: string) {
  return path.join(path.resolve(root), '.taskrail', 'transactions', `${targetKind}-${sanitize(targetName)}.json`);
}

export async function readUpdateCheckpoint(root: string, targetKind: UpdateTargetKind, targetName: string): Promise<UpdateCheckpoint | null> {
  try {
    return JSON.parse(await readFile(transactionFile(root, targetKind, targetName), 'utf8')) as UpdateCheckpoint;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw new Error(`failed to read update checkpoint: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function createUpdateCheckpoint(root: string, input: Omit<UpdateCheckpoint, 'transactionId' | 'phase' | 'createdAt' | 'updatedAt' | 'history'>): Promise<UpdateCheckpoint> {
  const file = transactionFile(root, input.targetKind, input.targetName);
  const existing = await readUpdateCheckpoint(root, input.targetKind, input.targetName);
  if (existing && !['committed', 'aborted'].includes(existing.phase)) {
    throw new Error(`active update transaction already exists: ${existing.transactionId} (${existing.phase})`);
  }
  const now = new Date().toISOString();
  const checkpoint: UpdateCheckpoint = {
    ...input,
    affectedAutomations: [...new Set(input.affectedAutomations)].sort(),
    transactionId: randomUUID(),
    phase: 'discovered',
    createdAt: now,
    updatedAt: now,
    history: [{ phase: 'discovered', at: now }],
  };
  await atomicWriteJson(file, checkpoint);
  return checkpoint;
}

export function canTransitionUpdate(from: UpdatePhase, to: UpdatePhase) {
  return allowedTransitions[from].includes(to);
}

export function rollbackReadiness(checkpoint: UpdateCheckpoint) {
  const reasons: string[] = [];
  if (!checkpoint.lastKnownGoodRelease) reasons.push('last-known-good release is not recorded');
  if (!checkpoint.lastKnownGoodReleasePath) reasons.push('last-known-good release path is not recorded');
  if (!checkpoint.recovery?.previousReleaseVerified) reasons.push('previous release is not verified');
  if (!checkpoint.recovery?.configurationVerified) reasons.push('previous configuration is not verified');
  if (checkpoint.recovery?.migrationCompatible !== true) reasons.push('migration rollback compatibility is not verified');
  return { ok: reasons.length === 0, reasons };
}

export async function transitionUpdate(
  root: string,
  targetKind: UpdateTargetKind,
  targetName: string,
  to: UpdatePhase,
  details?: string,
  patch: Partial<Pick<UpdateCheckpoint, 'currentRelease' | 'currentReleasePath' | 'lastKnownGoodRelease' | 'lastKnownGoodReleasePath' | 'dependencySnapshotHash' | 'recovery'>> = {},
): Promise<UpdateCheckpoint> {
  const checkpoint = await readUpdateCheckpoint(root, targetKind, targetName);
  if (!checkpoint) throw new Error(`update transaction not found: ${targetKind}:${targetName}`);
  if (!canTransitionUpdate(checkpoint.phase, to)) throw new Error(`invalid update transition: ${checkpoint.phase} -> ${to}`);
  const now = new Date().toISOString();
  const next: UpdateCheckpoint = {
    ...checkpoint,
    ...patch,
    phase: to,
    updatedAt: now,
    history: [...checkpoint.history, { phase: to, at: now, details }],
  };
  if (to === 'rollback-ready') {
    const readiness = rollbackReadiness(next);
    if (!readiness.ok) throw new Error(`cannot mark rollback ready: ${readiness.reasons.join('; ')}`);
  }
  await atomicWriteJson(transactionFile(root, targetKind, targetName), next);
  return next;
}

export async function requireRollbackReady(root: string, targetKind: UpdateTargetKind, targetName: string) {
  const checkpoint = await readUpdateCheckpoint(root, targetKind, targetName);
  if (!checkpoint) throw new Error(`update transaction not found: ${targetKind}:${targetName}`);
  const readiness = rollbackReadiness(checkpoint);
  if (!readiness.ok) throw new Error(`rollback is not ready: ${readiness.reasons.join('; ')}`);
  return checkpoint;
}

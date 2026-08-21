import { readFile } from 'node:fs/promises';
import type { CapabilityContract } from './types.js';

export type CapabilityStatus = 'active' | 'deprecated' | 'superseded';
export type CapabilitySideEffects = 'none' | 'read' | 'write' | 'mixed';
export type CapabilityIdempotency = 'not-applicable' | 'caller' | 'supported' | 'required';

export interface CapabilityMetadata {
  name: string;
  version: string;
  description: string;
  purpose?: string;
  domain?: string;
  operations?: string[];
  keywords?: string[];
  sideEffects?: CapabilitySideEffects;
  idempotency?: CapabilityIdempotency;
  components?: string[];
  input?: string;
  output?: string;
  status?: CapabilityStatus;
  supersededBy?: string;
}

export interface CapabilitySearchResult {
  name: string;
  score: number;
  reason: string[];
  metadata: CapabilityMetadata;
}

export interface CapabilityConflict extends CapabilitySearchResult {
  severity: 'hard' | 'soft';
}

export interface RegistryConflict {
  left: string;
  right: string;
  reason: string[];
}

const stopWords = new Set(['a', 'an', 'and', 'api', 'for', 'from', 'in', 'of', 'on', 'or', 'service', 'the', 'to', 'with']);

function normalize(value: string | undefined) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokens(...values: Array<string | string[] | undefined>) {
  const result = new Set<string>();
  for (const value of values) {
    const parts = Array.isArray(value) ? value : [value || ''];
    for (const part of parts) {
      for (const token of normalize(part).split(/\s+/)) if (token && !stopWords.has(token)) result.add(token);
    }
  }
  return result;
}

function overlap(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const item of left) if (right.has(item)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

function exactListOverlap(left: string[] = [], right: string[] = []) {
  const a = new Set(left.map(normalize).filter(Boolean));
  const b = new Set(right.map(normalize).filter(Boolean));
  return overlap(a, b);
}

export async function capabilityMetadata(capability: CapabilityContract): Promise<CapabilityMetadata> {
  try {
    const raw = JSON.parse(await readFile(capability.path, 'utf8')) as Partial<CapabilityMetadata>;
    return {
      name: capability.name,
      version: capability.version,
      description: capability.description,
      purpose: raw.purpose,
      domain: raw.domain,
      operations: Array.isArray(raw.operations) ? raw.operations.filter((item): item is string => typeof item === 'string') : undefined,
      keywords: Array.isArray(raw.keywords) ? raw.keywords.filter((item): item is string => typeof item === 'string') : undefined,
      sideEffects: raw.sideEffects,
      idempotency: raw.idempotency,
      components: Array.isArray(raw.components) ? raw.components.filter((item): item is string => typeof item === 'string') : undefined,
      input: raw.input,
      output: raw.output,
      status: raw.status || 'active',
      supersededBy: raw.supersededBy,
    };
  } catch {
    return { name: capability.name, version: capability.version, description: capability.description, status: 'active' };
  }
}

function searchScore(query: string, metadata: CapabilityMetadata) {
  const q = tokens(query);
  const purpose = tokens(metadata.name, metadata.purpose, metadata.description);
  const operations = tokens(metadata.operations);
  const keywords = tokens(metadata.keywords, metadata.domain);
  const purposeScore = overlap(q, purpose);
  const operationScore = overlap(q, operations);
  const keywordScore = overlap(q, keywords);
  return Math.min(1, purposeScore * 0.55 + operationScore * 0.3 + keywordScore * 0.15);
}

function compareMetadata(candidate: CapabilityMetadata, existing: CapabilityMetadata): CapabilityConflict | null {
  const reasons: string[] = [];
  let severity: 'hard' | 'soft' | null = null;
  let score = 0;

  if (normalize(candidate.name) === normalize(existing.name)) {
    severity = 'hard';
    score = 1;
    reasons.push('same name');
  }
  if (candidate.purpose && existing.purpose && normalize(candidate.purpose) === normalize(existing.purpose)) {
    severity = 'hard';
    score = 1;
    reasons.push('same canonical purpose');
  }

  const sameDomain = Boolean(candidate.domain && existing.domain && normalize(candidate.domain) === normalize(existing.domain));
  const operationOverlap = exactListOverlap(candidate.operations, existing.operations);
  const descriptiveOverlap = overlap(
    tokens(candidate.name, candidate.purpose, candidate.description, candidate.keywords),
    tokens(existing.name, existing.purpose, existing.description, existing.keywords),
  );

  if (!severity && sameDomain && operationOverlap >= 0.8 && operationOverlap > 0) {
    severity = 'hard';
    score = Math.max(score, 0.9);
    reasons.push('same domain with substantially same operations');
  }

  const softScore = Math.min(1, (sameDomain ? 0.2 : 0) + operationOverlap * 0.45 + descriptiveOverlap * 0.35);
  if (!severity && softScore >= 0.45) {
    severity = 'soft';
    score = softScore;
    if (sameDomain) reasons.push('same domain');
    if (operationOverlap > 0) reasons.push('overlapping operations');
    if (descriptiveOverlap > 0) reasons.push('overlapping purpose/keywords');
  }

  return severity ? {
    name: existing.name,
    severity,
    score: Number(score.toFixed(3)),
    reason: reasons,
    metadata: existing,
  } : null;
}

export async function findSimilarCapabilities(query: string, capabilities: CapabilityContract[], limit = 5): Promise<CapabilitySearchResult[]> {
  const metadataList = await Promise.all(capabilities.map(capabilityMetadata));
  const results: CapabilitySearchResult[] = [];
  for (const metadata of metadataList) {
    const score = searchScore(query, metadata);
    if (score <= 0) continue;
    const reason: string[] = [];
    const q = tokens(query);
    if (overlap(q, tokens(metadata.name, metadata.purpose, metadata.description)) > 0) reason.push('purpose');
    if (overlap(q, tokens(metadata.operations)) > 0) reason.push('operations');
    if (overlap(q, tokens(metadata.keywords, metadata.domain)) > 0) reason.push('keywords/domain');
    results.push({ name: metadata.name, score: Number(score.toFixed(3)), reason, metadata });
  }
  return results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, Math.max(1, limit));
}

export async function assessCapabilityCandidate(candidate: CapabilityMetadata, capabilities: CapabilityContract[]): Promise<CapabilityConflict[]> {
  const metadataList = await Promise.all(capabilities.map(capabilityMetadata));
  return metadataList
    .map((existing) => compareMetadata(candidate, existing))
    .filter((item): item is CapabilityConflict => Boolean(item))
    .sort((a, b) => (a.severity === b.severity ? b.score - a.score : a.severity === 'hard' ? -1 : 1) || a.name.localeCompare(b.name));
}

export async function findHardRegistryConflicts(capabilities: CapabilityContract[]): Promise<RegistryConflict[]> {
  const metadataList = await Promise.all(capabilities.map(capabilityMetadata));
  const conflicts: RegistryConflict[] = [];
  for (let left = 0; left < metadataList.length; left += 1) {
    for (let right = left + 1; right < metadataList.length; right += 1) {
      const a = metadataList[left];
      const b = metadataList[right];
      if (a.status === 'superseded' || b.status === 'superseded') continue;
      const conflict = compareMetadata(a, b);
      if (conflict?.severity === 'hard') conflicts.push({ left: a.name, right: b.name, reason: conflict.reason });
    }
  }
  return conflicts.sort((a, b) => `${a.left}:${a.right}`.localeCompare(`${b.left}:${b.right}`));
}

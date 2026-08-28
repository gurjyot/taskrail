import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AutomationRunSummary, DraftSet, InterventionItem, PlatformPriority } from './human-intervention.js';
import { TASKRAIL_PLATFORM_API_VERSION, type PlatformAutomationSummary, type PlatformNotification, type PlatformRole, type PlatformSnapshot } from './platform-contract.js';

export type ControlCenterLogLevel = 'debug' | 'info' | 'warning' | 'error' | 'critical';

export interface ControlCenterLogEntry {
  id: string;
  occurredAt: string;
  level: ControlCenterLogLevel;
  source: string;
  message: string;
  automationId?: string;
  runId?: string;
  domain?: string;
}

export type MetaAdsRecommendationKind = 'watch' | 'pause' | 'move-budget' | 'test-creative' | 'investigate' | 'other';
export type MetaAdsRecommendationStatus = 'open' | 'accepted' | 'rejected' | 'superseded';

export interface MetaAdsRecommendation {
  id: string;
  createdAt: string;
  accountId: string;
  accountName: string;
  campaignName?: string;
  title: string;
  recommendation: MetaAdsRecommendationKind;
  rationale: string;
  evidence: string[];
  confidence?: number;
  priority: PlatformPriority;
  status: MetaAdsRecommendationStatus;
  approvalId?: string;
}

export interface ControlCenterAutomationSummary extends PlatformAutomationSummary {
  schedulerEnabled?: boolean;
  runNowAvailable?: boolean;
  lastRunAt?: string;
  lastRunStatus?: AutomationRunSummary['status'];
  nextRunAt?: string;
}

export interface ControlCenterReadModel {
  apiVersion: typeof TASKRAIL_PLATFORM_API_VERSION;
  generatedAt: string;
  role: PlatformRole;
  automations: ControlCenterAutomationSummary[];
  notifications: PlatformNotification[];
  interventions: InterventionItem[];
  draftSets: DraftSet[];
  runs: AutomationRunSummary[];
  logs: ControlCenterLogEntry[];
  metaAdsRecommendations: MetaAdsRecommendation[];
}

export interface ControlCenterReadModelInput {
  platform: PlatformSnapshot;
  role?: PlatformRole;
  automationDetails?: Readonly<Record<string, Partial<Pick<ControlCenterAutomationSummary, 'schedulerEnabled' | 'runNowAvailable' | 'lastRunAt' | 'lastRunStatus' | 'nextRunAt'>>>>;
  notifications?: readonly PlatformNotification[];
  interventions?: readonly InterventionItem[];
  draftSets?: readonly DraftSet[];
  runs?: readonly AutomationRunSummary[];
  logs?: readonly ControlCenterLogEntry[];
  metaAdsRecommendations?: readonly MetaAdsRecommendation[];
  generatedAt?: string;
  limits?: Partial<ControlCenterReadModelLimits>;
}

export interface ControlCenterReadModelLimits {
  notifications: number;
  interventions: number;
  draftSets: number;
  runs: number;
  logs: number;
  metaAdsRecommendations: number;
}

export const DEFAULT_CONTROL_CENTER_READ_MODEL_LIMITS: Readonly<ControlCenterReadModelLimits> = Object.freeze({
  notifications: 50,
  interventions: 50,
  draftSets: 50,
  runs: 50,
  logs: 50,
  metaAdsRecommendations: 50,
});

function clampLimit(value: number | undefined, fallback: number) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > 200) throw new Error('control center read-model limits must be integers from 1 to 200');
  return value;
}

function newestFirst<T>(items: readonly T[], getTime: (item: T) => string, limit: number) {
  return [...items].sort((a, b) => getTime(b).localeCompare(getTime(a))).slice(0, limit);
}

function validateRecommendation(item: MetaAdsRecommendation) {
  if (!item.id.trim()) throw new Error('Meta Ads recommendation id is required');
  if (!item.accountId.trim()) throw new Error(`Meta Ads recommendation account id is required: ${item.id}`);
  if (!item.accountName.trim()) throw new Error(`Meta Ads recommendation account name is required: ${item.id}`);
  if (!item.title.trim()) throw new Error(`Meta Ads recommendation title is required: ${item.id}`);
  if (!item.rationale.trim()) throw new Error(`Meta Ads recommendation rationale is required: ${item.id}`);
  if (!item.evidence.length || item.evidence.some((evidence) => !evidence.trim())) throw new Error(`Meta Ads recommendation evidence is required: ${item.id}`);
  if (item.confidence !== undefined && (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1)) throw new Error(`Meta Ads recommendation confidence must be between 0 and 1: ${item.id}`);
}

function validateLog(item: ControlCenterLogEntry) {
  if (!item.id.trim()) throw new Error('control center log id is required');
  if (!item.source.trim()) throw new Error(`control center log source is required: ${item.id}`);
  if (!item.message.trim()) throw new Error(`control center log message is required: ${item.id}`);
}

export function buildControlCenterReadModel(input: ControlCenterReadModelInput): ControlCenterReadModel {
  if (input.platform.apiVersion !== TASKRAIL_PLATFORM_API_VERSION) throw new Error(`unsupported platform API version: ${input.platform.apiVersion}`);
  const configured = input.limits ?? {};
  const limits: ControlCenterReadModelLimits = {
    notifications: clampLimit(configured.notifications, DEFAULT_CONTROL_CENTER_READ_MODEL_LIMITS.notifications),
    interventions: clampLimit(configured.interventions, DEFAULT_CONTROL_CENTER_READ_MODEL_LIMITS.interventions),
    draftSets: clampLimit(configured.draftSets, DEFAULT_CONTROL_CENTER_READ_MODEL_LIMITS.draftSets),
    runs: clampLimit(configured.runs, DEFAULT_CONTROL_CENTER_READ_MODEL_LIMITS.runs),
    logs: clampLimit(configured.logs, DEFAULT_CONTROL_CENTER_READ_MODEL_LIMITS.logs),
    metaAdsRecommendations: clampLimit(configured.metaAdsRecommendations, DEFAULT_CONTROL_CENTER_READ_MODEL_LIMITS.metaAdsRecommendations),
  };

  for (const log of input.logs ?? []) validateLog(log);
  for (const recommendation of input.metaAdsRecommendations ?? []) validateRecommendation(recommendation);

  const automationDetails = input.automationDetails ?? {};
  const automations = input.platform.automations.map((automation) => ({ ...automation, ...(automationDetails[automation.id] ?? {}) }));

  return {
    apiVersion: TASKRAIL_PLATFORM_API_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    role: input.role ?? 'viewer',
    automations,
    notifications: newestFirst(input.notifications ?? [], (item) => item.createdAt, limits.notifications),
    interventions: newestFirst(input.interventions ?? [], (item) => item.updatedAt, limits.interventions),
    draftSets: newestFirst(input.draftSets ?? [], (item) => item.createdAt, limits.draftSets),
    runs: newestFirst(input.runs ?? [], (item) => item.startedAt, limits.runs),
    logs: newestFirst(input.logs ?? [], (item) => item.occurredAt, limits.logs),
    metaAdsRecommendations: newestFirst(input.metaAdsRecommendations ?? [], (item) => item.createdAt, limits.metaAdsRecommendations),
  };
}

export async function publishControlCenterReadModel(filePath: string, model: ControlCenterReadModel) {
  if (!filePath.trim()) throw new Error('control center read-model output path is required');
  if (model.apiVersion !== TASKRAIL_PLATFORM_API_VERSION) throw new Error(`unsupported platform API version: ${model.apiVersion}`);
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const payload = `${JSON.stringify(model, null, 2)}\n`;
  await writeFile(temporaryPath, payload, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, filePath);
  return { filePath, bytes: Buffer.byteLength(payload), generatedAt: model.generatedAt };
}

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildControlCenterReadModel, publishControlCenterReadModel } from '../src/control-center-read-model.js';
import { TASKRAIL_PLATFORM_API_VERSION, type PlatformSnapshot } from '../src/platform-contract.js';

const platform: PlatformSnapshot = {
  apiVersion: TASKRAIL_PLATFORM_API_VERSION,
  generatedAt: '2026-08-29T00:00:00.000Z',
  counts: { automations: 1, components: 0, capabilities: 0, running: 1, stopped: 0, paused: 0, failed: 0 },
  automations: [{ id: 'meta-daily-report', category: 'marketing', state: 'running', health: 'healthy', tests: { total: 2, passed: 2, failed: 0, skipped: 0, failedIds: [] } }],
  components: [], capabilities: [],
};

test('buildControlCenterReadModel composes bounded V1 dashboard state', () => {
  const model = buildControlCenterReadModel({
    platform,
    role: 'operator',
    generatedAt: '2026-08-29T01:00:00.000Z',
    automationDetails: { 'meta-daily-report': { schedulerEnabled: true, runNowAvailable: true, lastRunAt: '2026-08-29T00:30:00.000Z', lastRunStatus: 'succeeded', nextRunAt: '2026-08-30T00:30:00.000Z' } },
    logs: Array.from({ length: 70 }, (_, index) => ({ id: `log-${index}`, occurredAt: `2026-08-29T00:${String(index % 60).padStart(2, '0')}:00.000Z`, level: 'info' as const, source: 'TaskRail', message: `entry ${index}` })),
    metaAdsRecommendations: [{ id: 'rec-1', createdAt: '2026-08-29T00:45:00.000Z', accountId: 'act-1', accountName: 'SMG', title: 'Watch CPA', recommendation: 'watch', rationale: 'CPA moved but evidence is not yet decisive.', evidence: ['7d CPA increased 8%', '14d ROAS remains stable'], confidence: 0.72, priority: 'normal', status: 'open' }],
  });

  assert.equal(model.apiVersion, '1');
  assert.equal(model.role, 'operator');
  assert.equal(model.automations[0]?.schedulerEnabled, true);
  assert.equal(model.automations[0]?.runNowAvailable, true);
  assert.equal(model.logs.length, 50);
  assert.equal(model.metaAdsRecommendations[0]?.confidence, 0.72);
});

test('buildControlCenterReadModel rejects evidence-free Meta recommendations', () => {
  assert.throws(() => buildControlCenterReadModel({
    platform,
    metaAdsRecommendations: [{ id: 'rec-1', createdAt: 'now', accountId: 'act-1', accountName: 'SMG', title: 'Pause', recommendation: 'pause', rationale: 'Bad performance', evidence: [], priority: 'high', status: 'open' }],
  }), /evidence is required/);
});

test('publishControlCenterReadModel writes a private atomic JSON read model', async () => {
  const root = await mkdtemp(join(tmpdir(), 'taskrail-control-center-'));
  try {
    const filePath = join(root, 'state', 'platform-snapshot.json');
    const model = buildControlCenterReadModel({ platform, generatedAt: '2026-08-29T01:00:00.000Z' });
    await publishControlCenterReadModel(filePath, model);
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    assert.equal(parsed.apiVersion, '1');
    assert.equal(parsed.generatedAt, model.generatedAt);
    const mode = (await stat(filePath)).mode & 0o777;
    assert.equal(mode, 0o600);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

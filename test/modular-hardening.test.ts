import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createAgentGrant, authorizeAgentGrant } from '../src/agent-grants.js';
import { assessSharedArtifactUpdate, satisfiesSimpleRange } from '../src/compatibility-contract.js';
import { certifyTaskRail } from '../src/certification.js';
import { createDiagnosticReport } from '../src/diagnostics.js';
import { diagnosticIssueKey, groupDiagnostics } from '../src/error-intelligence.js';
import { faultGatePassed, runFaultScenarios } from '../src/fault-injection.js';
import { provenancePayload, sha256, verifyProvenance } from '../src/provenance.js';
import { assessSecurityDeclaration, TASKRAIL_SECURITY_POLICY } from '../src/security-policy.js';

test('compatibility contracts identify exact consumers affected by a shared update', () => {
  assert.equal(satisfiesSimpleRange('2.4.1', '^2.3.0'), true);
  assert.equal(satisfiesSimpleRange('3.0.0', '^2.3.0'), false);
  const assessment = assessSharedArtifactUpdate(
    { schema: 1, kind: 'capability', name: 'meta-api', version: '2.4.1', taskrail: '2.x' },
    { schema: 1, kind: 'capability', name: 'meta-api', version: '3.0.0', taskrail: '3.x', changeLevel: 'major', migrationRequired: true, migrationGuide: 'MIGRATION.md' },
    [
      { name: 'ads-agent', taskrailVersion: '3.0.0', dependencies: { 'meta-api': '^2.0.0' } },
      { name: 'unrelated', taskrailVersion: '3.0.0', dependencies: {} },
    ],
  );
  assert.deepEqual(assessment.affected, ['ads-agent']);
  assert.equal(assessment.breaking, true);
  assert.equal(assessment.ok, false);
});

test('provenance verifies checksum, trusted source, and signature without a runtime dependency', () => {
  const artifact = Buffer.from('taskrail-release');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const statement = {
    schema: 1 as const,
    subject: 'taskrail',
    version: '3.0.0',
    sha256: sha256(artifact),
    source: 'https://github.com/gurjyot/taskrail',
    issuedAt: new Date().toISOString(),
    keyId: 'release-key-1',
    signature: '',
  };
  statement.signature = sign(null, Buffer.from(provenancePayload(statement)), privateKey).toString('base64');
  const result = verifyProvenance(statement, artifact, {
    allowedSources: [statement.source],
    requireSignature: true,
    trustedKeys: { 'release-key-1': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
  });
  assert.equal(result.ok, true);
  assert.equal(verifyProvenance(statement, Buffer.from('tampered'), { allowedSources: [statement.source] }).ok, false);
});

test('security policy versioning flags stale and incomplete automations', () => {
  const result = assessSecurityDeclaration({ policyId: 'taskrail-security', policyVersion: 0, controls: ['secret-redaction'] });
  assert.equal(result.ok, false);
  assert.equal(result.stale, true);
  assert.equal(result.missing.length > 0, true);
  const complete = assessSecurityDeclaration({ policyId: TASKRAIL_SECURITY_POLICY.id, policyVersion: TASKRAIL_SECURITY_POLICY.version, controls: [...TASKRAIL_SECURITY_POLICY.required] });
  assert.equal(complete.ok, true);
});

test('error intelligence groups only privacy-valid diagnostic reports by fingerprint', () => {
  const first = createDiagnosticReport({ code: 'INSTALL_NETWORK', severity: 'error', stage: 'installer', message: 'download failed', platform: 'linux-x64' });
  const second = { ...first, severity: 'critical' as const, createdAt: new Date(Date.parse(first.createdAt) + 1000).toISOString() };
  const groups = groupDiagnostics([first, second]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].occurrences, 2);
  assert.equal(groups[0].severity, 'critical');
  assert.equal(diagnosticIssueKey(groups[0]), `taskrail-diagnostic:${first.fingerprint}`);
});

test('fault injection is a release gate rather than runtime machinery', async () => {
  const results = await runFaultScenarios([
    { name: 'network-interruption', run: async () => undefined },
    { name: 'checksum-corruption', run: async () => undefined },
    { name: 'rollback-interruption', run: async () => undefined },
  ], 1000);
  assert.equal(faultGatePassed(results), true);
  const failed = await runFaultScenarios([{ name: 'disk-full', run: async () => { throw new Error('expected simulated failure was not recovered'); } }], 1000);
  assert.equal(faultGatePassed(failed), false);
});

test('certification aggregates independent gates and fails closed', () => {
  const pass = certifyTaskRail([
    { name: 'core-ci', ok: true },
    { name: 'installer-golden-path', ok: true },
    { name: 'security-policy', ok: true },
    { name: 'provenance', ok: true },
  ]);
  assert.equal(pass.certified, true);
  assert.equal(pass.verdict, 'PASS');
  const fail = certifyTaskRail([{ name: 'core-ci', ok: true }, { name: 'fault-injection', ok: false }]);
  assert.equal(fail.certified, false);
  assert.deepEqual(fail.failed, ['fault-injection']);
});

test('agent mutation grants are narrow, session-bound, expiring, and proof-bound', () => {
  const now = new Date('2026-08-22T00:00:00.000Z');
  const grant = createAgentGrant({
    grantId: 'g1',
    sessionId: 'session-a',
    actions: ['automation.scaffold'],
    nonce: 'one-time-proof',
    ttlMs: 60_000,
    now,
  });
  assert.equal(authorizeAgentGrant({ grant, action: 'automation.scaffold', sessionId: 'session-a', nonce: 'one-time-proof', now }).allowed, true);
  assert.equal(authorizeAgentGrant({ grant, action: 'automation.update', sessionId: 'session-a', nonce: 'one-time-proof', now }).allowed, false);
  assert.equal(authorizeAgentGrant({ grant, action: 'automation.scaffold', sessionId: 'session-b', nonce: 'one-time-proof', now }).allowed, false);
  assert.equal(authorizeAgentGrant({ grant, action: 'automation.scaffold', sessionId: 'session-a', nonce: 'wrong-proof', now }).allowed, false);
  assert.equal(authorizeAgentGrant({ grant, action: 'automation.scaffold', sessionId: 'session-a', nonce: 'one-time-proof', now: new Date(now.getTime() + 61_000) }).allowed, false);
});

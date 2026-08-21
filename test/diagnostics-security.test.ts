import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDiagnosticReport, sanitizeDiagnosticValue, validateDiagnosticReport, MAX_DIAGNOSTIC_BYTES } from '../src/diagnostics.js';
import { auditSourceSecurity, scanForSecrets, securityPrinciples } from '../src/security.js';

test('diagnostic reports redact secrets and never claim automatic submission', () => {
  const report = createDiagnosticReport({
    code: 'INSTALL_FAILED',
    severity: 'error',
    stage: 'platform-install',
    message: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456',
    details: {
      apiKey: 'super-secret-value',
      nested: { password: 'dont-share', reason: 'checksum mismatch' },
    },
  });
  assert.equal(report.privacy.networkSubmitted, false);
  assert.equal(report.privacy.secretsIncluded, false);
  assert.equal(report.privacy.automationIdentityIncluded, false);
  assert.equal(report.privacy.filesystemPathsIncluded, false);
  assert.doesNotMatch(JSON.stringify(report), /super-secret-value|dont-share|abcdefghijklmnopqrstuvwxyz123456/);
  assert.match(JSON.stringify(report), /REDACTED/);
  assert.equal(validateDiagnosticReport(report).ok, true);
});

test('diagnostics strip filesystem paths, addresses, email identities, and connection strings', () => {
  const report = createDiagnosticReport({
    code: 'DEPLOY_FAILED',
    severity: 'error',
    stage: 'activation',
    message: 'failed at /home/alice/private/customer-a/config.json from 10.20.30.40 for alice@example.com',
    details: {
      path: 'C:\\Users\\Alice\\Secrets\\config.json',
      connectionString: 'postgres://admin:password@db.internal/customer',
      reason: 'health check failed',
    },
  });
  const text = JSON.stringify(report);
  assert.doesNotMatch(text, /alice|customer-a|10\.20\.30\.40|example\.com|admin:password|db\.internal/i);
  assert.match(text, /PRIVATE|REDACTED/);
  assert.match(text, /health check failed/);
  assert.equal(validateDiagnosticReport(report).ok, true);
});

test('diagnostic intake rejects oversized or expanded schemas', () => {
  const report = createDiagnosticReport({ code: 'FAIL', severity: 'error', stage: 'test', message: 'bounded' });
  const expanded = { ...report, rawLog: 'do not accept this field' };
  const expandedResult = validateDiagnosticReport(expanded);
  assert.equal(expandedResult.ok, false);
  assert.equal(expandedResult.errors.some((item) => item.includes('unsupported fields')), true);

  const oversized = { ...report, message: 'x'.repeat(MAX_DIAGNOSTIC_BYTES * 2) };
  const oversizedResult = validateDiagnosticReport(oversized);
  assert.equal(oversizedResult.ok, false);
  assert.equal(oversizedResult.errors.some((item) => item.includes('byte limit')), true);
});

test('diagnostic intake independently rejects sensitive material', () => {
  const report: any = createDiagnosticReport({ code: 'FAIL', severity: 'error', stage: 'test', message: 'safe' });
  report.message = 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456';
  const result = validateDiagnosticReport(report);
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((item) => item.includes('sensitive material')), true);
});

test('diagnostic sanitizer bounds arrays, depth, and secret-shaped keys', () => {
  const sanitized = sanitizeDiagnosticValue({ token: 'abc', values: Array.from({ length: 100 }, (_, i) => i) }) as any;
  assert.equal(sanitized.token, '[REDACTED]');
  assert.equal(sanitized.values.length, 50);
});

test('security audit hard-fails secrets and structurally detects injection-prone code', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-security-'));
  try {
    const bad = path.join(root, 'bad.js');
    await writeFile(bad, "import { exec } from 'node:child_process';\nconst password = 'password=very-secret';\nexec('curl ' + input);\nconst q = `SELECT * FROM users WHERE id=${id}`;\n");
    const secrets = await scanForSecrets([bad]);
    assert.equal(secrets.length > 0, true);
    const report = await auditSourceSecurity([bad], true);
    assert.equal(report.ok, false);
    assert.equal(report.findings.some((item) => item.code === 'secret-material'), true);
    assert.equal(report.findings.some((item) => item.code === 'shell-exec'), true);
    assert.equal(report.findings.some((item) => item.code === 'sql-interpolation'), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('ordinary update messages and scanner source do not create false positives', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-security-safe-'));
  try {
    const safe = path.join(root, 'safe.js');
    await writeFile(safe, "const message = `update entered recovery-required state: ${reason}`;\nconst sql = 'SELECT * FROM users WHERE id = ?';\n");
    const report = await auditSourceSecurity([safe], true);
    assert.equal(report.ok, true);
    assert.equal(report.findings.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('security principles keep core network exposure deny-by-default', () => {
  const principles = securityPrinciples();
  assert.equal(principles.coreNetworkExposure, 'deny-by-default');
  assert.equal(principles.externalAccess, 'authorized-automation-only');
  assert.equal(principles.sql, 'parameterized-only');
});

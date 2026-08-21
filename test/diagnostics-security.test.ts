import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDiagnosticReport, sanitizeDiagnosticValue } from '../src/diagnostics.js';
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
  assert.doesNotMatch(JSON.stringify(report), /super-secret-value|dont-share|abcdefghijklmnopqrstuvwxyz123456/);
  assert.match(JSON.stringify(report), /REDACTED/);
});

test('diagnostic sanitizer bounds arrays, depth, and secret-shaped keys', () => {
  const sanitized = sanitizeDiagnosticValue({ token: 'abc', values: Array.from({ length: 100 }, (_, i) => i) }) as any;
  assert.equal(sanitized.token, '[REDACTED]');
  assert.equal(sanitized.values.length, 50);
});

test('security audit hard-fails secrets and can make injection-prone patterns strict failures', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskrail-security-'));
  try {
    const bad = path.join(root, 'bad.js');
    await writeFile(bad, "const password = 'password=very-secret';\nexec('curl ' + input);\nconst q = `SELECT * FROM users WHERE id=${id}`;\n");
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

test('security principles keep core network exposure deny-by-default', () => {
  const principles = securityPrinciples();
  assert.equal(principles.coreNetworkExposure, 'deny-by-default');
  assert.equal(principles.externalAccess, 'authorized-automation-only');
  assert.equal(principles.sql, 'parameterized-only');
});

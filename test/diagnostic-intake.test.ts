import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDiagnosticReport,
  createDiagnosticSubmissionEnvelope,
  validateDiagnosticSubmissionEnvelope,
} from '../src/public/agent.js';

test('diagnostic submission is explicit opt-in and pseudonymous', () => {
  const report = createDiagnosticReport({
    code: 'INSTALL_FAILED',
    severity: 'error',
    stage: 'install',
    message: 'download failed',
  });

  assert.throws(() => createDiagnosticSubmissionEnvelope([report], {
    installationId: 'local-install-id',
    explicitOptIn: false,
  }), /explicit opt-in/);

  const envelope = createDiagnosticSubmissionEnvelope([report], {
    installationId: 'local-install-id',
    explicitOptIn: true,
    submissionId: 'submission-123',
    createdAt: new Date(0),
  });

  assert.notEqual(envelope.installation, 'local-install-id');
  assert.match(envelope.installation, /^[a-f0-9]{24}$/);
  assert.equal(envelope.privacy.automaticSubmission, false);
  assert.equal(envelope.privacy.credentialsIncluded, false);
  assert.equal(envelope.privacy.businessPayloadIncluded, false);
  assert.equal(validateDiagnosticSubmissionEnvelope(envelope).ok, true);
});

test('diagnostic submission refuses privacy-invalid reports', () => {
  const report = createDiagnosticReport({
    code: 'TEST_FAILED',
    severity: 'error',
    stage: 'test',
    message: 'test failed',
  });
  const tampered = structuredClone(report);
  tampered.message = 'Authorization: Bearer secret-token-value';

  assert.throws(() => createDiagnosticSubmissionEnvelope([tampered], {
    installationId: 'local-install-id',
    explicitOptIn: true,
  }), /failed privacy validation/);
});

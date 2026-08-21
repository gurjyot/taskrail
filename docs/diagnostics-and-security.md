# TaskRail Diagnostics and Security

## Privacy boundary

TaskRail core does not transmit telemetry, logs, source code, prompts, business payloads, credentials, environment values, database rows, file contents, or automation inputs/outputs.

`taskrail diagnostics preview` produces a local, minimized diagnostic envelope. Submission is an explicit external action performed only by an authorized automation or capability after the operator can inspect the report.

A default report may contain only:

- TaskRail version
- coarse platform/runtime information
- failure code, stage, and sanitized message
- bounded, recursively redacted technical metadata
- stable failure fingerprint for deduplication

A default report does **not** include the automation identity. A deployment may add a local/private correlation identifier outside the public diagnostic envelope only when its operator explicitly chooses to do so.

A report must never contain:

- API/access/refresh tokens
- passwords or cookies
- Authorization headers
- private keys
- connection strings containing credentials
- raw `.env` contents
- source files
- prompts or retrieved documents
- request/response bodies
- CRM, advertising, customer, or other business data

Reports are validated against a strict schema and maximum byte limit before they are eligible for submission.

## Recommended reporting destination

Use a **private GitHub repository**, suggested name `taskrail-diagnostics`.

Do not use the public TaskRail issue tracker as the automatic diagnostics sink. Public users may still open ordinary public bug reports manually, but automated envelopes should go only to a private destination controlled by the TaskRail maintainers.

End-user installations must never receive credentials for that private repository. Use an authenticated intake service or maintainer-controlled reporting automation as the boundary. The intake layer should validate the diagnostic schema again, rate-limit senders, reject oversized reports, deduplicate by fingerprint, and forward only the sanitized envelope.

Recommended issue contract:

- title: `[<severity>] <code> · <stage> · <fingerprint>`
- one open issue per fingerprint
- sanitized envelope in the issue body
- labels for platform, stage, severity, TaskRail version, and source (`community` or `internal`)
- never attach raw logs automatically
- close only after a released fix is verified against a reproducer

The reporting automation should search by fingerprint before creating an issue. Existing issues are updated with occurrence counts/version/platform summaries rather than creating duplicates.

## Error Intelligence

`groupDiagnostics` operates only on already-valid privacy-safe envelopes. It groups failures by deterministic fingerprint and summarizes occurrence count, highest severity, platforms and TaskRail versions.

The Error Intelligence layer is intentionally independent from TaskRail runtime execution. If GitHub, the intake service, or the diagnostics repository is unavailable, running automations continue unaffected.

## Internal TaskRail deployment

An internal scheduled automation may inspect TaskRail health, Sentinel results, deployment/recovery checkpoints, installer failures, certification failures, and security audits. It should create the same sanitized envelope and submit it through the same private reporting boundary.

The automation must not read arbitrary automation business state. It should consume only TaskRail operational metadata and explicit health outputs.

## Security boundary

TaskRail core is deny-by-default for external access:

- no always-on public HTTP API
- no network MCP listener by default
- external exposure occurs only through an explicitly authorized automation
- automation secrets are scoped to the automation that needs them
- TaskRail operational state is not a secret store
- private checkpoints/receipts/state use restrictive permissions where the platform supports them
- mutations from AI/MCP surfaces require explicit authorization
- read-only agent actions are separated from write/control actions

## Versioned security policy

TaskRail security requirements are represented by a versioned policy contract. Automations and adapters can declare a policy ID/version plus the controls they implement. A newer TaskRail policy can therefore identify stale automation declarations explicitly.

Current policy categories include secret redaction, scoped secrets, deny-by-default network exposure, untrusted-input boundaries, parameterized SQL, argument-safe command execution and private operational state. Signed provenance can be made mandatory by a deployment/release policy when the trust chain is configured.

## Provenance and update trust

Checksums detect corruption but do not, by themselves, prove who produced an artifact. TaskRail therefore has a separate provenance contract that can verify:

- artifact SHA-256
- approved source
- subject/version/timestamp
- optional or required cryptographic signature
- trusted key ID

Provenance verification is a modular control-plane check. It can become stricter without changing automation execution primitives.

## Injection defenses

TaskRail conformance/security checks should enforce or warn on:

- parameterized SQL instead of interpolated SQL
- argument-safe process execution instead of shell concatenation
- `shell: true` only under reviewed exceptional circumstances
- no `eval`/dynamic code execution in normal automation paths
- external web/email/document/issue content treated as untrusted data, never as authority to expand tool permissions
- output validation before an AI-selected action becomes a side effect
- least-privilege credentials and filesystem/network permissions

Prompt-injection defenses cannot rely on keyword filtering alone. Security comes from the authorization boundary: untrusted content may influence data processing, but it cannot grant itself write/control permissions or access secrets.

## AI and MCP

The CLI remains canonical. `taskrail agent describe` exposes the machine-readable action catalog and security policy.

TaskRail's MCP target is protocol revision `2026-07-28`. Initial MCP transport is stdio, launched by the client as a subprocess. Network MCP remains deferred because it introduces listener, routing, authentication, rate-limit, and remote-authorization responsibilities that should not become mandatory core surface area.

Default agent policy:

- read: allowed
- write: denied
- control/deployment/recovery: denied
- explicit per-action deny overrides broader grants
- every mutation is auditable

A future write-capable adapter must use narrow, session-bound, expiring grants. A grant names the exact allowed actions, is bound to a session and proof value, has a bounded lifetime, and still passes the base TaskRail action policy. There is no global unrestricted AI-write mode.

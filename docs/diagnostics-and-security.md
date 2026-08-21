# TaskRail Diagnostics and Security

## Privacy boundary

TaskRail core does not transmit telemetry, logs, source code, prompts, business payloads, credentials, environment values, database rows, file contents, or automation inputs/outputs.

`taskrail diagnostics preview` produces a local, minimized diagnostic envelope. Submission is an explicit external action performed only by an authorized automation or capability after the operator can inspect the report.

A report may contain only:

- TaskRail version
- coarse platform/runtime information
- failure code, stage, and sanitized message
- optional automation identifier
- bounded, recursively redacted technical metadata
- stable failure fingerprint for deduplication

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

## Recommended reporting destination

Use a **private GitHub repository**, suggested name `taskrail-diagnostics`.

Do not use the public TaskRail issue tracker as the automatic diagnostics sink. Public users may still open ordinary public bug reports manually, but automated envelopes should go only to a private destination controlled by the TaskRail maintainers.

Recommended issue contract:

- title: `[<severity>] <code> · <stage> · <fingerprint>`
- one open issue per fingerprint
- sanitized envelope in the issue body
- labels for platform, stage, severity, TaskRail version, and source (`community` or `internal`)
- never attach raw logs automatically
- close only after a released fix is verified against a reproducer

The reporting automation should search by fingerprint before creating an issue. Existing issues are updated with occurrence counts/version/platform summaries rather than creating duplicates.

## Internal TaskRail deployment

An internal scheduled automation may inspect TaskRail health, Sentinel results, deployment/recovery checkpoints, installer failures, and security audits. It should create the same sanitized envelope and submit it to the private diagnostics repository.

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

TaskRail's MCP target is protocol revision `2026-07-28`. Initial MCP transport should be stdio, launched by the client as a subprocess. Network MCP is intentionally deferred to an optional package because it introduces OAuth, listener, routing, rate-limit, and remote-authorization responsibilities that should not become mandatory core surface area.

Default agent policy:

- read: allowed
- write: denied
- control/deployment/recovery: denied
- explicit per-action deny overrides broader grants
- every mutation is auditable

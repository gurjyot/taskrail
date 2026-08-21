# TaskRail Error Intelligence

TaskRail diagnostics are designed to answer **what broke** without exposing **what the user's automation does**.

## Privacy boundary

A diagnostic report may contain:

- TaskRail version
- Node runtime and OS/architecture
- stable error code and lifecycle stage
- severity
- a sanitized error summary
- bounded, sanitized technical details required to reproduce a framework failure

A diagnostic report must not contain:

- API keys, access/refresh tokens, passwords, cookies, authorization headers, private keys, connection strings, or environment values
- automation source code, prompts, business payloads, request/response bodies, database rows, filenames that reveal customer/business identity, or automation names
- usernames, home-directory paths, IP addresses, email addresses, hostnames containing credentials, or raw stack-local filesystem paths

`taskrail diagnostics preview` is local-only and shows the exact report before any sharing. Core TaskRail never silently uploads diagnostics.

## Collection architecture

Production collection should use a separate **private TaskRail diagnostics repository** as the maintainer system of record, but end-user installations must never receive credentials for that repository.

Recommended flow:

```text
TaskRail installation
      |
      | explicit opt-in / authorized reporting automation
      v
local sanitizer + schema validator
      |
      | privacy-safe diagnostic only
      v
TaskRail diagnostic intake service / GitHub App
      |
      | dedupe by fingerprint
      v
private diagnostics repository
      |
      +--> severity + affected-version triage
      +--> regression clustering
      +--> maintainer fix issue / PR
      +--> release verification
```

The intake service is deliberately outside TaskRail core. It should accept only the diagnostic schema, apply a second independent redaction pass, enforce a small request-size limit, rate-limit submissions, reject attachments/raw logs, and use its own narrowly scoped GitHub credential. A compromised user installation therefore cannot gain access to the private repository.

## VPS/internal reporting

Maintainer-controlled TaskRail installations may run an authorized reporting automation. That automation can inspect TaskRail health results and sanitized diagnostics, then create/update private GitHub issues using a secret scoped only to that automation. The credential must not be stored in TaskRail manifests, rollback snapshots, diagnostic reports, or source code.

## Dedupe and triage

Reports use a stable fingerprint based on error code, lifecycle stage, platform, and TaskRail version. The collector should aggregate counts rather than creating one issue per occurrence. Suggested issue metadata:

- fingerprint
- first/last seen timestamps
- affected TaskRail versions
- affected platform families
- occurrence count
- maximum severity
- sanitized representative message
- regression status

No installation identifier is required for default reporting.

## Fix loop

1. Collector receives and re-sanitizes a report.
2. Existing fingerprint is incremented or a private issue is created.
3. Sentinel scans unresolved critical/high-volume fingerprints on schedule.
4. A maintainer or coding agent reproduces the framework failure using synthetic data only.
5. The fix adds a regression test before release.
6. Normal CI, installer Golden Path, security checks, update/recovery tests, and release readiness must pass.
7. A normal TaskRail release distributes the fix. Error reporting never bypasses release gates.

## Non-negotiable rule

Raw user logs are not telemetry. If a failure cannot be diagnosed from the privacy-safe schema, TaskRail should ask the user for an explicitly reviewed additional diagnostic rather than automatically collecting more data.

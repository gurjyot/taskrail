# Changelog

## 3.0.0

- Added modular validation and security registries so reusable checks can be composed by lifecycle context without duplicating logic.
- Added transactional shared-update planning, durable recovery checkpoints, immutable last-known-good validation, scoped pause controls, and resumable interrupted recovery.
- Added private integrity-protected deployment/update state, rollback metadata repair, reboot readiness, bounded retention, and 1,000+ automation isolation/concurrency conformance.
- Added hardened Linux, macOS, and Windows bootstrap installers with version/checksum verification, native Golden Paths, and injected failure/recovery coverage.
- Added release provenance, signed-attestation release gates, scheduled Sentinel verification, certification aggregation, and fault-injection matrices.
- Added deny-by-default AI/untrusted-content boundaries, versioned security policy, privacy-safe diagnostics, Error Intelligence contracts, and opt-in pseudonymous diagnostic submission envelopes.
- Added the optional stdio-first MCP adapter outside the zero-runtime-dependency core package.
- Added `taskrail/platform` with transport-neutral dashboard/app contracts, role-gated command intents, realtime event observers, notification/test-state structures, and runaway-execution guardrails.
- TaskRail 3 explicitly accepts manifests from the released `2.0.x` line as a compatibility bridge; new scaffolds and templates target `3.0.x`.
- Kept TaskRail decentralized and lightweight: no mandatory daemon, database, queue, vector store, runtime model service, or dashboard dependency was introduced.

## 2.0.8

- Added a stable TaskRail component SDK with execution, state, idempotency, retry, timeout, bounded concurrency, HTTP, config, structured/redacted logging, and safe filesystem primitives.
- Added `taskrail/components` as the stable public component import while preserving existing deep paths for compatibility.
- Added component discovery plus profile-aware automation scaffolding through the TaskRail CLI.
- Added governed capability metadata, deterministic purpose/operation search, semantic duplicate detection, strict conformance checks, and fail-closed capability scaffolding.
- Added registry-level semantic conflict enforcement so governed duplicate capabilities cannot bypass the scaffold by being hand-created.
- Added dedicated automation, capability-authoring, and TaskRail-core skills plus repository-wide AI instructions enforcing component-first/capability-first design.
- Added market/architecture documentation and progressive-disclosure rules to keep agent context and token use low.
- Kept execution decentralized: no daemon, database, queue, vector store, runtime AI call, or shared cross-domain memory was added.

## 2.0.7

- Added isolated per-service execution state, durable idempotency claims, decision journaling, heartbeats, bounded retry/timeout/concurrency helpers, and stable execution IDs.
- Added read-only parallel supervision with per-service freshness SLAs so hourly, daily, weekly, and multi-service projects can be monitored correctly.
- Added declarative CPU, memory, task, and priority guardrails plus TaskRail-managed systemd drop-ins that instrument services without changing business commands.
- Added `taskrail-supervise`, `taskrail-heartbeat`, and `taskrail-systemd-sync` CLIs.
- Added agent-execution defaults to SMG profiles, first-class Shell/PHP timer profiles, a runnable automation blueprint, CI, and conformance tests including 1,000 isolated supervised workloads and high-contention idempotency.
- Kept execution decentralized: no TaskRail daemon, no global runtime lock, no shared cross-domain memory, and no new runtime dependency.

## 2.0.6

- Fixed canonical capability-root discovery across framework-managed source, staged candidates, releases, and live automation trees.
- Hardened `taskrail upgrade --write` so legacy manifests infer profiles safely, preserve overrides, drop redundant capability roots, refuse ambiguity, and remain idempotent.
- Added lightweight `change-detection@1` and `release-retention@1` behaviors for verified no-op redeploys and safe cleanup of proven TaskRail-owned stale candidates, backups, and releases.

## 2.0.5

- Added environment-aware lifecycle helpers and concise agent-facing commands: `env`, `paths`, `bootstrap`, `drift`, `reconcile`, `explain`, `repair`, `ship`, and `upgrade`.
- Added deploy receipts, explicit last-known-good release metadata, safer source/runtime discovery, and deterministic repair flows for stale locks and broken TaskRail symlinks.
- Added versioned framework capabilities, versioned profiles, effective manifest resolution, and safe declarative manifest upgrades so non-breaking framework improvements can flow to managed automations without business-logic edits.

## 2.0.4

- Documented sourceDir validation and test execution, deployDir health execution, and the pre-deploy health check tradeoff.
- Improved gate failure details to include the command, cwd, exit code, stdout, and stderr.
- Bumped the maintenance release to v2.0.4.

## 2.0.1

- Regenerated the package lockfile from `package.json`.
- Added YAML frontmatter to `skills/taskrail/SKILL.md`.
- Removed unused `LifecycleStep`.

# Changelog

## 3.0.7

- Fixed production preflight so a first deployment may target a new directory when its immediate parent already exists and is writable, while existing targets must still be writable directories.
- Added regression coverage for clean first-production deploy targets and kept production preflight fail-closed without recursively creating arbitrary parent paths.
- Synchronized the measured package footprint, MCP compatibility review, packaged skills, source version, lockfile, and platform manifest for the release.

## 3.0.6

- Added an automated update-surface gate covering MCP compatibility review, packaged skills, platform/install assets, public contracts, critical docs, and release surfaces.
- Added explicit MCP command classification so every top-level TaskRail CLI command must be reviewed as MCP-exposed or intentionally excluded; new or removed commands now fail compatibility checks until reviewed.
- Added the packed MCP consumer test to full release certification instead of relying only on the standalone MCP workflow.
- Added MCP compatibility review metadata tied to the exact TaskRail version and updated TaskRail core agent instructions to require these checks for framework edits.
- Synchronized MCP with every safe default read action, including TaskRail status and privacy-safe diagnostics preview, while keeping write/control operations deny-by-default.
- Added a public first-party ecosystem gate that validates the capability catalog and every reference automation against the exact TaskRail candidate on PRs, main pushes, and releases.
- Added automatic private ecosystem verification for new TaskRail main SHAs, with successful-SHA caching, retry-on-failure behavior, diagnostics evidence, and non-noisy Telegram reporting.
- Reviewed all packaged TaskRail skills for 3.0.6 and synchronized package, source, lockfile, and platform manifest versions.
- Expanded update-surface self-protection so the release, MCP, ecosystem, installer, security/reliability, documentation, and compatibility gates themselves cannot be silently removed.

## 3.0.5

- Fixed `safeDeploy` so deployment preflight always runs against the automation project root instead of a rewritten absolute-path manifest from the caller working directory.
- Added Ads-shaped regression coverage for sibling capabilities, dependency lockfiles, validation/test/health, and nested project-root deployment.
- Preflight deployment failures now include the exact failing check names/details in the failure report instead of only a generic `preflight failed` message.
- Reviewed all packaged TaskRail skills for 3.0.5 under the enforced skill-freshness release invariant.

## 3.0.4

- Refreshed all packaged TaskRail agent skills for the current canonical CLI, plugin, command-execution, package-surface, deployment, performance, and framework-restraint contracts.
- Added `reviewed_for_taskrail` version markers plus `npm run skills:check`, dynamically covering every packaged `skills/*/SKILL.md`.
- Made skill freshness part of `npm run check`, release certification, CI, and regression coverage so a future framework version cannot be certified while its skills remain stale.

## 3.0.3

- Fixed deployment preflight so relative dependency lockfiles resolve from the automation's resolved source directory during `taskrail ship`, matching standalone checks and nested workspace layouts.
- Removed bypassed duplicate `test` and `ship` implementations from the legacy CLI path and added regression coverage for the canonical command routes.
- Made the plugin contract explicit and fail-closed: managed automations support zero or one operational plugin rather than implying undefined multi-plugin aggregation.
- Removed the nonfunctional published `./src/*` export while retaining `./dist/*` as a documented legacy v3 compatibility surface for later major-version removal.
- Strengthened performance certification with a lightweight relative startup baseline and actual spawned-CLI maximum RSS measurement instead of benchmark-process RSS.
- Documented the bounded non-shell command contract and reinforced the freeze policy against speculative caches, indexes, daemons, or scale machinery without measured need.

## 3.0.2

- Fixed relative dependency lockfile resolution so `taskrail test` and preflight resolve lockfiles from the automation workspace instead of the caller's working directory.
- Improved `taskrail ship` failure output so deployment-stage errors and failure-report paths are surfaced instead of collapsing to unknown release/SHA output.
- Added regression coverage for workspace-relative lockfiles and kept the full cross-platform release matrix green.
- Reworked the README into a shorter human-first overview with CI/version/runtime-dependency badges and reproducible startup/install measurements.
- Hardened performance checks with multi-sample CLI startup statistics, p95 budget enforcement, machine-readable reports, GitHub job summaries, and retained CI artifacts.

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
- Added declarative CPU, memory, task, and priority guardrails plus TaskRail-managed systemd drop-ins that instrument services without changing business command.
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

# Changelog

## 3.1.0

- Made fast automation authoring the primary TaskRail goal: conventional automations can use thin manifests while profiles supply standard runtime, layout, validation, test, health, deployment, and systemd defaults.
- Simplified the ordinary development loop to business logic plus `taskrail test` and `taskrail check`, while keeping production `ship` fail-closed on deployment, runtime-context, timer, rollback, and health verification.
- Updated automation scaffolding to generate conventional `src/main.*` layouts and derive runtime from the selected profile contract rather than profile-name heuristics.
- Refactored profile resolution to remove duplicate merge paths and dead array-merge plumbing without changing the public resolved-manifest contract.
- Improved certification failure diagnostics and removed per-release version wiring from the certification-request workflow while preserving owner and package-version validation.
- Closed the post-release correctness audit: fleet metadata now resolves thin manifests, health arrays execute completely, plugins fail closed, runtime/timer checks live inside the deployment transaction, existing deployments with migrations require the transactional update path, systemd calls are bounded, orphan locks recover safely, drift compares bytes, fleet collisions are enforced by conformance/isolation, and certification builds only once.
- Added regression coverage for thin-manifest fleet visibility, complete health sets, binary drift, orphan locks, and timer operational readiness.
- Verified the simplified authoring model against full TaskRail certification and the first-party public ecosystem before release finalization.

## 3.0.8

- Added production systemd runtime-context verification so TaskRail checks the real service `User=`, `WorkingDirectory=` traversal, unit load state, and environment-scoped required shared-file readability.
- Made `taskrail ship` fail when a deployed systemd automation cannot actually run under its production service identity, preventing code-level health checks from masking `CHDIR`/permission failures.
- Added automatic rollback and restored-runtime verification when the post-activation systemd runtime-context gate fails.
- Added `taskrail-systemd-sync --verify-runtime` for explicit fleet/runtime audits and regression coverage for service-user working-directory and shared-file permission failures.
- Reviewed MCP, packaged skills, source version, lockfile, and platform manifest for the release.

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

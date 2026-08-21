# TaskRail 3 Reliability Architecture

TaskRail 3 is a reliability and scale architecture, not a monolithic runtime rewrite. The goal is to preserve TaskRail's small control-plane model while making framework updates, capability updates, automation updates, and large fleets provably recoverable.

## Non-negotiable invariants

1. One automation must never be able to stop, corrupt, or mutate another automation or TaskRail core.
2. No update activates in place. Build and validation happen in an isolated staged release.
3. The last known good release is immutable until a newer release has passed post-activation health checks.
4. Rollback is a tested deployment path, not an emergency script.
5. A failed update must leave the currently healthy release running whenever technically possible.
6. Shared component/capability changes require impact analysis before activation.
7. Non-breaking shared changes do not pause unrelated consumers.
8. Breaking shared changes may pause only affected consumers, after a verified recovery point exists.
9. Components remain TaskRail-owned and versioned with core. Capabilities remain separately versioned and governed.
10. Every release path must be deterministic, observable, resumable or safely abortable, and idempotent.
11. TaskRail must remain usable without a daemon, database, Redis, queue, vector store, or runtime AI service.
12. All platform-dependent behavior is behind explicit adapters/profiles; portable core behavior must pass Linux, macOS, and Windows Golden Path tests.

## Three-repository model

### taskrail
Small stable core, public SDK, components, lifecycle, policy, compatibility, update/recovery engine, validation, and AI skills.

### taskrail-hub
Governed reusable capabilities. Capabilities declare TaskRail compatibility, component requirements, operations, side effects, consumers, migration policy, and semantic identity. Community additions must pass TaskRail conformance before publication.

### taskrail-automations
Examples/reference automations. Automations stay isolated and thin, and consume TaskRail plus validated capabilities rather than embedding infrastructure copies.

The repositories are independently releasable. Compatibility metadata, not synchronized commits, is the contract between them.

## Standard build decision

Before substantial automation implementation:

`REQUIREMENT -> COMPONENT LOOKUP -> CAPABILITY LOOKUP -> REUSE / EXTEND / CREATE / LOCAL -> IMPLEMENT -> VERIFY -> SHIP`

Components cannot be created by ordinary automation agents. New capability creation is blocked when a canonical equivalent already exists.

## Transactional update model

Every framework, capability, or automation update follows:

`DISCOVER -> IMPACT -> CHECKPOINT -> STAGE -> VALIDATE -> SIMULATE -> ACTIVATE -> VERIFY -> COMMIT`

If any stage after checkpoint fails:

`FAIL -> FREEZE NEW ACTIVATION -> RESTORE LAST-KNOWN-GOOD -> VERIFY RESTORE -> RESUME`

### Checkpoint

A checkpoint records:
- target identity and version
- current release/version
- last-known-good release/version
- dependency graph snapshot
- affected consumers
- compatibility result
- state/migration strategy
- activation strategy
- recovery plan
- immutable release paths

A checkpoint is written before any mutation.

### Stage

New artifacts are built in a separate candidate/release path. The live release is not modified.

### Validate

Run schema/config checks, TaskRail compatibility, capability/component compatibility, permission policy, static conformance, tests, security/secret checks, and declared health probes against the candidate.

### Simulate

Run migration preflight and rollback-preflight. Where a reversible migration is impossible, the release must explicitly declare a forward-recovery strategy before activation.

### Activate

Prefer one atomic pointer/symlink switch. On platforms where atomic directory replacement is used, preserve the old release separately before activation.

### Verify

Run health probes and defined stability checks. A new release is not last-known-good until verification passes.

### Commit

Persist the new last-known-good pointer and update usage/version metadata only after verification succeeds.

## Rollback/recovery contract

Rollback must be prevalidated before activation. Required checks:
- previous release still exists and is immutable
- previous configuration can still be loaded
- rollback target passes an offline health/readiness probe when possible
- migration compatibility is known
- rollback operation does not depend on the broken candidate
- rollback itself is protected by a recovery lock/checkpoint

Rollback flow:

`READ CHECKPOINT -> VERIFY OLD RELEASE -> ATOMIC RESTORE -> HEALTH CHECK -> COMMIT RESTORE`

If rollback verification fails, TaskRail keeps both releases intact, marks the target RECOVERY_REQUIRED, and refuses destructive cleanup. It must never delete the last known good release during recovery.

## Shared dependency usage graph

TaskRail maintains a deterministic dependency graph derived from manifests and capability metadata:
- component -> capability consumers
- component -> direct automation consumers
- capability -> automation consumers
- profile -> automation consumers
- TaskRail API surface -> declared compatibility range

No shared update is activated without a blast-radius report.

### Change classes

PATCH: compatible behavior/fix. No consumer pause. Run impacted tests.

MINOR: additive API/capability operations. No consumer pause when compatibility passes. Run impacted tests plus Golden Path.

BREAKING: removed/changed contract or incompatible state. Block activation until affected consumers have a migration/adaptation plan. Pause only affected deployment/update activity, never the entire TaskRail fleet.

## Automation isolation

TaskRail's baseline isolation contract:
- unique release, state, cache, temp, log, and lock namespaces per automation
- no automation write permission to TaskRail core or another automation's managed roots
- declared filesystem roots and optional network/process policy
- bounded CPU, memory, child tasks, concurrency, timeout, output, and retry behavior
- per-automation deployment locks; no global execution lock
- framework control-plane operations cannot be invoked from automation business code unless explicitly authorized
- failures and recovery states are scoped to the target automation

Linux profiles may additionally apply systemd hardening. Other platforms use the strongest portable checks available without pretending to provide OS sandboxing that is not present.

## Hooks and lifecycle events

TaskRail exposes stable lifecycle hooks for adapters/capabilities without allowing arbitrary mutation of core state:

- requirement:analyzed
- architecture:planned
- candidate:staged
- preflight:passed / preflight:failed
- migration:preflight
- activation:before / activation:after
- health:passed / health:failed
- rollback:before / rollback:after
- release:committed
- recovery:required

Hooks are ordered, timeout-bounded, observable, and classified as read-only or mutation-capable. Mutation-capable hooks require explicit manifest permission and cannot bypass core safety gates.

## Engineering and performance standard

Every automation/capability must have budgets appropriate to its profile:
- startup latency budget
- operation timeout
- max concurrency
- retry ceiling
- memory/CPU/task ceiling where supported
- log/output ceiling
- bounded pagination/batching
- no unbounded polling or recursive retries
- no blocking sleep loops where timers/schedulers are appropriate
- no hidden global mutable state
- no duplicated generic integration logic when a capability exists

Standards are versioned. New language/runtime guidance is adopted only when it improves reliability, security, portability, or performance and is validated by TaskRail conformance tests.

## Release gates

A TaskRail release is not production-ready unless all applicable gates pass:
- full unit/integration suite
- architecture/conformance validation
- API compatibility checks
- dependency/usage graph validation
- capability semantic-conflict audit
- package footprint budget
- fresh packed-artifact install on Linux/macOS/Windows
- Golden Path fresh automation scaffold/run
- upgrade simulation from supported previous versions
- forced activation failure + successful automatic rollback
- forced rollback interruption + successful recovery/resume test
- isolation/failure-containment tests
- 1,000+ automation supervision/concurrency conformance
- documentation and AI-skill contract checks

## Sentinel

TaskRail Sentinel is a scheduled CI/control-plane verifier, not a permanent framework daemon. It periodically runs conformance, package installation, supported-version upgrades, rollback/recovery drills, dependency/security checks, footprint checks, and public API checks. Failures should open/update one actionable issue or configured notification target with evidence.

Runtime fleet health remains the responsibility of TaskRail heartbeat/supervision plus the operating system/service manager.

## Delivery phases

1. Lock architecture/invariants and ADRs.
2. Add dependency/usage graph and impact classification.
3. Add transactional update checkpoints and recovery state machine.
4. Harden rollback with prevalidation, interruption recovery, and immutable LKG guarantees.
5. Add automation isolation/policy manifest and conformance validator.
6. Add stable lifecycle hooks.
7. Add component/API namespaces and compatibility contracts where still missing.
8. Add Hub compatibility schema and installation contract.
9. Add upgrade/rollback/failure-injection Golden Paths.
10. Add Sentinel and release-readiness summary.
11. Create Hub and Automations repositories only after core compatibility contracts are executable and tested.

<h1 align="center">TASKRAIL</h1>

<p align="center"><strong>Lightweight, AI-first automation framework for building, validating, deploying, updating, supervising, and safely operating production automations.</strong></p>

<!-- taskrail-size:start -->
<p align="center"><strong>⚡ Tiny framework footprint: ~216 KiB compressed / ~1135 KiB unpacked, with zero runtime npm dependencies.</strong></p>
<!-- taskrail-size:end -->

TaskRail is a small control plane and SDK for reliable automation. It is designed to be especially easy for coding agents such as Codex and other AI development tools, while remaining deterministic and fully usable without AI. It provides reusable components, governed capabilities, thin automation scaffolds, deployment safety, transactional updates, rollback/recovery controls, supervision, privacy-safe diagnostics, optional agent adapters, and progressive-disclosure agent skills without requiring a database, queue, container platform, permanent daemon, vector store, or runtime model service.

**Keywords:** automation framework, AI automation, coding agents, agentic automation, workflow automation, Node.js automation, TypeScript automation, deployment automation, automation SDK, reusable components, reusable integrations, capability registry, idempotency, transactional deployment, rollback, recovery, health checks, drift detection, systemd automation, cross-platform automation, production automation, MCP automation, Codex skills, AI developer tooling.

<!-- taskrail-ai-efficiency:start -->
## Built for AI agents: small context, fast automation work

**An AI agent does not need to load or repeatedly scan the whole TaskRail framework to build an automation.** TaskRail is deliberately designed around progressive disclosure: the agent reads only the small amount of context needed for the current task, while the framework handles the reusable safety and operational machinery itself.

For a normal automation, an agent typically needs only:

- the short repository/agent instructions relevant to the task
- the automation manifest and business requirement
- the names/contracts of the components and capabilities it needs
- the implementation of a specific component or capability only when modification is actually necessary

It normally does **not** need the complete TaskRail source, every capability implementation, every test suite, or the internals of deployment, locking, rollback, drift, supervision, retries, timeouts, idempotency, security and release certification in its working context.

```text
USER REQUIREMENT
      ↓
SHORT TASKRAIL INSTRUCTIONS
      ↓
LOOK UP ONLY RELEVANT COMPONENTS / CAPABILITIES
      ↓
WRITE THIN BUSINESS LOGIC
      ↓
TASKRAIL HANDLES THE REUSABLE SAFETY + OPERATIONS
```

| Without a reusable framework | With TaskRail |
| --- | --- |
| Agent repeatedly reasons about retries, timeouts, state, deployment, rollback and safety | Agent reuses existing TaskRail contracts and concentrates on the business requirement |
| More infrastructure code has to be generated and reviewed | Automation stays thin and composes proven components/capabilities |
| Larger working context is often needed to remember project-specific infrastructure | Progressive-disclosure skills and discovery commands keep context focused |
| Safety conventions can vary between automations | TaskRail validates and enforces common contracts deterministically |
| More repeated implementation work | More lookup/reuse, less reinvention |

This architecture is intended to reduce unnecessary AI context and token use, shorten implementation time, and make generated automations more consistent. Exact token savings depend on the agent, model and task, so TaskRail does not claim a fixed percentage. The structural advantage is simpler: **the agent works with the small interface it needs; TaskRail takes care of the rest.**

Useful discovery commands are intentionally concise:

```bash
taskrail components
taskrail component <name>
taskrail capability-find "<needed behavior>"
taskrail capability <name>
taskrail doctor <automation>
taskrail check <automation>
taskrail test <automation>
```

The expected AI workflow is therefore **discover → reuse → implement thin logic → verify**, not **scan the entire framework → rebuild infrastructure → repeat**.
<!-- taskrail-ai-efficiency:end -->

## How TaskRail works

```text
 REQUIREMENT / IDEA
        │
        ▼
 ┌────────────────────┐       ┌──────────────────────┐       ┌──────────────────────┐
 │ TASKRAIL + SKILLS  │──────▶│ COMPONENT CATALOG    │──────▶│ CAPABILITY REGISTRY  │
 │ understand + plan  │       │ stable core building │       │ search / reuse /     │
 │ before coding      │       │ blocks               │       │ extend / create      │
 └────────────────────┘       └──────────────────────┘       └──────────┬───────────┘
                                                                       │
                                                                       ▼
                                                             ┌──────────────────────┐
                                                             │ THIN AUTOMATION      │
                                                             │ business logic only  │
                                                             └──────────┬───────────┘
                                                                        │
                                                                        ▼
 ┌────────────────────┐       ┌──────────────────────┐       ┌──────────────────────┐
 │ SUPERVISE + LEARN  │◀──────│ EXECUTE SAFELY       │◀──────│ VERIFY + RELEASE     │
 │ health / heartbeat │       │ isolation / limits   │       │ checks / impact /    │
 │ drift / decisions  │       │ retry / idempotency  │       │ update / rollback    │
 └────────────────────┘       └──────────────────────┘       └──────────────────────┘
```

## Architecture: modular by design

TaskRail is intentionally split into independently improvable layers:

1. **Core components** — small, stable, vendor-neutral technical primitives.
2. **Capabilities** — reusable integrations and domain actions built on components.
3. **Automations** — isolated business workflows that compose components and capabilities.
4. **Control-plane policies** — update safety, rollback, compatibility, provenance, diagnostics, security and certification.
5. **Optional adapters** — platform- or protocol-specific integrations such as MCP, kept outside the core package when they add dependencies.
6. **CI/release gates** — Golden Paths, Sentinel, fault injection, security audits and certification; these do not run in the hot path of ordinary automations.

The standard design decision is:

```text
REQUIREMENT -> COMPONENT LOOKUP -> CAPABILITY LOOKUP -> REUSE / EXTEND / CREATE / LOCAL -> IMPLEMENT -> VERIFY -> SHIP
```

The framework follows one rule throughout: **centralize reusable primitives and safety contracts; decentralize automation decisions and execution.**

Ordinary automation agents consume components; they do not invent new TaskRail core components. Before creating a capability, an agent must search the capability registry. Equivalent capabilities are reused instead of duplicated.

## Modular validation and security

Validation and security are registries of reusable modules rather than one giant checklist. A module declares its stable ID, version, applicable contexts/tags, dependencies and evaluator. Profiles select only the modules relevant to an install, update, deployment, rollback, runtime check, security audit or certification run.

The same validator or security control can therefore be reused by many flows without copying its logic. Adding or improving one module automatically strengthens every suite that selects it, while dependency cycles and missing dependencies fail closed.

The standard validation catalog includes manifest/config validation, artifact checksum verification, shared-dependency compatibility, rollback readiness and reboot readiness. The standard security catalog reuses TaskRail's source scanner, private-state permission checks and default-deny network policy. Existing CLI commands remain stable while these internals can evolve independently.

Public orchestration lives under `taskrail/testing` through `ValidationRegistry`, `SecurityRegistry`, `createTaskRailValidationRegistry()` and `createTaskRailSecurityRegistry()`.

## Component SDK

Use the stable public surface:

```js
import {
  createExecutionContext,
  LocalStateStore,
  IdempotencyStore,
  runIdempotent,
  withRetry,
  withTimeout,
  mapConcurrent,
  effectiveExecutionPolicy,
  http,
  config,
  log,
  fsSafe,
} from 'taskrail/components';
```

| Component | Purpose |
| --- | --- |
| Execution context | Stable execution IDs and per-run context |
| Local state | Small isolated durable state without a database |
| Idempotency | Atomic claims and duplicate-execution protection |
| Retry | Bounded exponential retry with jitter support |
| Timeout | Abort-aware operation deadlines |
| Concurrency | Bounded parallel work |
| HTTP | Safe generic HTTP requests and response handling |
| Config | Typed environment/config access and validation |
| Structured logging | JSON-friendly logging with secret redaction |
| Safe filesystem | Root-bounded file operations and path protection |

Discover components with:

```bash
taskrail components
taskrail component http
```

Service-specific integrations such as Telegram, Meta, Twenty, PostgreSQL, Google, WordPress, Slack, or rclone belong in capabilities rather than core components.

## Governed capabilities

Capabilities can declare canonical purpose, domain, operations, keywords, side effects, idempotency behavior, components used, input/output contracts, lifecycle status, and supersession metadata.

TaskRail detects duplicate names and semantic hard conflicts. Capability creation fails closed when an existing capability already covers the requested purpose unless a reviewed overlap rationale is supplied.

```bash
taskrail capabilities
taskrail capability <name>
taskrail capability-find "send telegram message"
taskrail capability-check <name> --strict
taskrail impact <name>
```

Create a governed capability only after lookup:

```bash
taskrail init capability example-api \
  --description "Reusable Example API client" \
  --purpose "Call the Example service API" \
  --domain example \
  --operation read \
  --operation write \
  --component http
```

## Compatibility contracts and blast radius

TaskRail derives a deterministic dependency graph from automation manifests and capability metadata. It tracks:

- component -> direct automation consumers
- component -> capability consumers -> transitive automation consumers
- capability -> automation consumers
- profile -> automation consumers

```bash
taskrail usage
taskrail usage component http
taskrail usage capability example-api
taskrail update-plan capability example-api --from 1.2.0 --to 2.0.0 --breaking
```

Reusable artifacts can carry explicit compatibility contracts: artifact kind, version, supported TaskRail version, dependency ranges, change level, and migration requirements. TaskRail can determine exactly which consumers fall outside the new contract before activation.

Breaking changes fail closed when migration guidance or a safe consumer plan is missing. Unrelated automations remain outside the affected scope.

Stable public exports, commands and manifest fields can also be compared as a backward-compatibility snapshot. Removing a stable contract is treated as a major-version change instead of silently breaking existing users.

## Safe lifecycle

For a first deployment:

```text
doctor -> check -> test -> plan -> ship -> health
```

```bash
taskrail doctor <automation>
taskrail check <automation>
taskrail test <automation>
taskrail plan <automation>
taskrail ship <automation>
taskrail health <automation>
```

`ship` prepares and validates a candidate, tracks immutable releases/backups, activates safely, verifies health, records the last-known-good release, and supports rollback.

## Transactional automation updates

After an automation already has a verified last-known-good release, use the stricter update path:

```bash
taskrail update <automation>
```

```text
DISCOVER -> IMPACT -> CHECKPOINT -> STAGE -> VALIDATE -> SIMULATE
       -> ROLLBACK-READY -> ACTIVATE -> VERIFY -> COMMIT
```

If activation fails:

```text
FAIL -> ROLLBACK-REQUIRED -> REVALIDATE OLD RELEASE -> RESTORE -> VERIFY -> CLOSE
```

If a candidate fails before activation, the live release is untouched. If TaskRail cannot prove a safe recovery path after activation uncertainty, the transaction enters **recovery-required** and destructive cleanup/new activation is blocked until recovery is inspected.

Automations with migrations are conservative by default. Rollback compatibility must be explicitly proven before a transactional migration update can proceed:

```bash
taskrail update <automation> --migration-compatible
```

## Reboot recovery and bounded retention

TaskRail treats host reboot as a recoverable operating event. On Linux, `taskrail-systemd-sync --all --apply --ensure-enabled` can verify and enable declared services and timers so managed automations return after boot. The reboot policy separately classifies missed work per automation as **run on recovery**, **skip**, or **manual review** instead of applying one dangerous global rule.

Transient health/reconciliation evidence is governed by bounded retention so operational metadata does not grow forever. Deployment and failure evidence can be preserved longer while routine health history is pruned or aggregated. TaskRail does not require a central database for this policy.

## Isolation and performance guardrails

TaskRail is designed so one automation cannot become the framework's single point of failure. The control plane provides:

- per-automation state, release, lock, heartbeat, and execution namespaces
- fleet managed-root collision detection
- no global execution lock
- bounded concurrency, retries, and timeouts
- CPU/memory/task policy support
- optional strict Linux systemd filesystem isolation
- control-plane mutation authorization
- failure/recovery state scoped to the affected automation
- deterministic supervision designed for 1,000+ independent automations
- explicit package/startup/validation/memory performance budgets

```bash
taskrail isolation-audit
taskrail conformance
taskrail-supervise
```

TaskRail does not serialize independent automations just because they start at the same time. Performance budgets fail closed when measured framework size or execution overhead exceeds the configured ceiling rather than allowing gradual unnoticed bloat.

## Runaway execution guardrails

TaskRail can bound an execution by maximum observed steps, elapsed time, repeated state/fingerprint count, and consecutive failures. `RunawayExecutionGuard` trips deterministically when a budget is exceeded and remains tripped for that execution.

Guardrail trips can be written as private metadata-only JSONL using `journalExecutionGuardTrip()`. The journal intentionally excludes arbitrary business payloads and repeated fingerprint values, and old transient evidence remains subject to TaskRail's retention policy.

## Hooks and lifecycle events

The bounded lifecycle event bus lets integrations observe or explicitly authorized control-plane code participate in lifecycle events without bypassing TaskRail safety gates. Handlers are ordered, timeout-bounded, and classified as read-only or mutation-capable; mutation handlers require explicit authorization.

Examples include requirement analysis, staging, preflight, activation, health, rollback, release commit, and recovery-required events.

## Release provenance

TaskRail now has a small provenance verification contract independent of the installer implementation. A release, adapter, component bundle, or capability bundle can be checked for:

- exact SHA-256 artifact identity
- approved source
- version/subject metadata
- timestamp validity
- optional or required cryptographic signature
- explicit trusted-key selection

Provenance verification uses Node's built-in cryptography APIs and adds no runtime npm dependency.

Checksums remain useful for corruption detection; signed provenance adds an origin/authenticity layer on top.

## Versioned security policy

Security requirements are represented as a versioned policy rather than being scattered across documentation. Automations and adapters can declare which policy version and controls they satisfy.

Current control categories include:

- secret redaction
- per-automation/scoped secrets
- deny-by-default network exposure
- untrusted-input boundaries for AI/webhook/email content
- SQL parameterization
- shell argument boundaries
- private state storage
- signed provenance where required

When TaskRail's security policy advances, older declarations can be identified as stale instead of silently remaining on an unknown standard.

## Privacy-safe diagnostics and Error Intelligence

TaskRail diagnostic reports are deliberately minimized. Default reports exclude automation identity and business payloads and aggressively redact secrets, connection strings, filesystem paths, IP addresses, and user identity.

Diagnostics are validated against a strict schema and maximum size before they are considered suitable for submission.

The Error Intelligence layer groups valid reports by deterministic fingerprint, severity, TaskRail version, platform, and occurrence count. This allows a private intake or Sentinel workflow to deduplicate recurring failures without collecting the user's internal automation logic.

Opt-in diagnostic submission envelopes are available through `taskrail/agent`. They revalidate every report, bound batch size, pseudonymize a local installation identifier and explicitly prohibit automatic submission or embedded credentials.

End-user installations should never receive credentials for the maintainers' private diagnostics repository. Any future remote intake must be explicitly authorized, previewable, authenticated, rate-limited, and privacy-preserving.

## Fault injection

Fault injection is a **test/release capability, not runtime machinery**. It is intended to keep adding reproducible failure scenarios such as:

- interrupted network/download
- checksum corruption
- missing platform payload
- permission denied
- disk/full-storage simulation
- process interruption
- stale locks
- state corruption
- rollback interruption
- host reboot/restart reconciliation

A fault scenario passes only when TaskRail reaches the expected safe/recoverable state. A test that merely reproduces a crash without proving containment/recovery is not considered a successful fault test.

## TaskRail certification

TaskRail has a small certification aggregator for independent release gates. Certification does not replace CI or control automations; it summarizes their verdicts and fails closed if a required gate fails.

Certification gates can include:

- core CI
- package Golden Path
- installer Golden Path
- release-readiness audit
- fault injection
- security-policy conformance
- provenance verification
- compatibility-contract checks
- optional MCP adapter matrix

The intended final release verdict is conceptually:

```text
TASKRAIL CERTIFIED — PASS
```

Only independent green gates should produce that verdict.

## Public SDK

TaskRail keeps public APIs deliberate instead of exposing every internal file:

```text
taskrail/components
taskrail/capabilities
taskrail/manifest
taskrail/testing
taskrail/control
taskrail/agent
taskrail/platform
```

Examples:

- `taskrail/components` — stable vendor-neutral primitives
- `taskrail/testing` — modular validation/security, conformance, compatibility, performance, isolation, fault-injection and certification helpers
- `taskrail/control` — lifecycle/update controls plus compatibility, provenance, security-policy, reboot/retention and error-intelligence contracts
- `taskrail/agent` — permissioned AI/agent-facing contracts, privacy-safe diagnostics and opt-in diagnostic submission envelopes
- `taskrail/platform` — transport-neutral dashboard/app contracts, role-gated command intents, real-time event observers, test/status structures and runaway-execution guardrails

Internal files can evolve more quickly without making every implementation detail part of TaskRail's semver promise.

## Future dashboard and application hooks

TaskRail core does not run a dashboard server or open a web port. `taskrail/platform` provides stable structures and hooks so a separate dashboard repository can expose authenticated HTTP, SSE, WebSocket or webhook transport without becoming a second control plane.

Future clients can consume automation/component/capability inventories, health/state, per-automation test totals and failed test IDs, notifications and realtime lifecycle events. Control intents include start, stop, pause, resume, run, scheduler enable/disable, and notification acknowledgement/resolution.

All mutations must pass through `PlatformCommandGateway`, which applies role checks before invoking a canonical TaskRail executor. The external service must bind that executor to the same TaskRail control functions used by CLI operations; clients never receive arbitrary shell execution access.

See `docs/platform-and-insights-contract.md` for the integration boundary.

## Optional MCP adapter

MCP is an **optional adapter**, not a core runtime dependency.

The current direction is:

- stdio-first
- no network listener by default
- read-only by default
- TaskRail CLI remains canonical
- explicit tool allowlist
- metadata-only local audit trail
- no raw prompt, secret, stdout, or arbitrary command recording in audit events
- write/control actions remain absent until separately scoped and proven safe

The adapter has its own dependencies and three-platform CI matrix so MCP can evolve without increasing the TaskRail core package footprint.

Future MCP write capabilities, if enabled, should require explicit scopes, TaskRail mutation authorization, existing update/rollback gates, and full auditability. External content can never grant itself permission to mutate TaskRail.

## AI-agent skills

TaskRail uses progressive disclosure so an agent only loads the instructions required for the work at hand:

- `skills/taskrail/SKILL.md` — normal automation development and operation
- `skills/taskrail-capability/SKILL.md` — governed capability authoring and maintenance
- `skills/taskrail-core/SKILL.md` — TaskRail core/component maintenance

Repository-level `AGENTS.md` contains short global rules. The important automation rule is: **look for reusable components and capabilities before writing infrastructure or integration code.**

## Installation requirements

TaskRail core requires:

- Node.js 22 or newer
- npm
- network access to the selected release source for the bootstrap installer path

Git is recommended for development and production source tracking. Platform/service requirements are profile-dependent; for example, Linux service profiles can use systemd.

TaskRail itself does **not** require Docker, Kubernetes, Redis, PostgreSQL, a queue, or a TaskRail daemon.

## Cross-platform installation

TaskRail uses **three tiny user-facing bootstrap installers**. The setup file does not contain three copies of TaskRail and does not bundle every operating-system integration.

### Linux

Download `taskrail-install-linux.sh`, then run:

```bash
chmod +x taskrail-install-linux.sh
./taskrail-install-linux.sh
```

### macOS

Download `TaskRail-Install.command` and open it, or run:

```bash
chmod +x TaskRail-Install.command
./TaskRail-Install.command
```

### Windows

Download `TaskRail-Install.ps1` and run it with PowerShell.

Each installer follows the same verified protocol:

```text
DETECT PLATFORM
      -> FETCH VERSIONED RELEASE MANIFEST
      -> DOWNLOAD COMMON TASKRAIL PACKAGE
      -> VERIFY SHA-256 / PROVENANCE POLICY
      -> INSTALL CORE
      -> DOWNLOAD ONLY THIS OS ADAPTER
      -> VERIFY ADAPTER + VERSION
      -> REGISTER ATOMICALLY
      -> VERIFY CLI + PLATFORM STATUS
      -> CLEAN TEMP FILES
```

Linux never retains the macOS/Windows adapter payload; macOS and Windows behave the same way for their respective platforms. Core and adapter versions must match exactly. A corrupt checksum or mismatched version is rejected before adapter registration.

Repair or inspect platform setup with:

```bash
taskrail platform status
taskrail platform install
```

The repository also remains installable for framework development:

```bash
git clone https://github.com/gurjyot/taskrail.git
cd taskrail
npm ci
npm test
npm run check
npm run size:check
npm run release:readiness
```

## Golden Paths and release safety

TaskRail keeps independent release gates so one passing test cannot hide another class of failure:

- **TaskRail CI** — framework tests, public API/CLI, modular security checks and README-footprint freshness
- **Package Golden Path** — packed-artifact install/scaffold on Linux, macOS, and Windows
- **Installer Golden Path** — actual Linux/macOS/Windows setup files, platform bootstrap failure tests, checksums, retries and post-install verification
- **MCP adapter matrix** — optional adapter tested separately on Linux, macOS, and Windows
- **Release readiness audit** — version consistency, public API, docs/skills, required installers/adapters/workflows, modular architecture and anti-bloat contracts
- **Fault injection** — intentional failure scenarios must prove containment and recovery
- **Certification** — aggregate required gate verdicts only after the individual gates succeed

The release package builder fails if platform-specific installer payloads or optional MCP dependencies leak into the core npm tarball.

## TaskRail Sentinel

TaskRail Sentinel is a scheduled GitHub control-plane verifier—not a permanent daemon. It periodically reruns framework tests, public API checks, dependency security audit, release-package construction, release-readiness contracts and other designated safety gates.

If Sentinel fails, it can open or update a deduplicated GitHub issue with evidence and the workflow run. When all scheduled gates recover, Sentinel can close that issue automatically. Runtime fleet health remains handled by heartbeats/supervision plus the operating system or service manager.

Sentinel/Error Intelligence is intentionally external to the automation hot path: reporting infrastructure failing must never stop user automations.

## Feature overview

TaskRail includes:

- **Tiny package footprint with zero runtime npm dependencies**
- CLI-first control plane
- deliberate public TypeScript/Node.js SDK namespaces
- TaskRail-owned component SDK
- governed capability registry
- semantic capability duplicate detection without embeddings/vector infrastructure
- capability search, scaffolding, strict checks, and usage tracking
- deterministic component/capability/profile dependency graph
- blast-radius analysis for shared updates
- compatibility contracts for reusable artifacts
- backward-compatibility snapshot assessment for stable public contracts
- profile-aware thin automation scaffolding
- manifest/config contracts and preflight validation
- reusable modular validation registry and context-specific suites
- reusable modular security-control registry and strict profiles
- environment detection
- structured logs/errors and secret redaction
- privacy-safe diagnostic schema and validation
- opt-in pseudonymous diagnostic submission envelopes
- diagnostic deduplication/error intelligence
- versioned security-policy declarations
- provenance/checksum/signature verification contracts
- deterministic execution IDs
- isolated local state
- durable idempotency claims
- decision journaling and heartbeats
- bounded retries, timeouts, concurrency, execution policies and runaway-loop guardrails
- CPU, memory, task, and process-priority guardrails
- systemd resource drop-ins, reboot readiness and optional strict filesystem isolation
- missed-run recovery policy per automation
- bounded operational-data retention policy
- health checks and freshness SLAs
- read-only multi-service supervision
- fleet managed-root isolation audit
- immutable release support and release retention
- deployment locks
- atomic deployment/activation strategies
- last-known-good tracking
- rollback and recovery-readiness verification
- durable transactional update checkpoints
- explicit pre-activation abort vs post-activation recovery states
- drift detection and reconciliation
- compatibility checks and safe manifest upgrades
- bounded lifecycle hooks with mutation authorization
- transport-neutral dashboard/app platform hooks and realtime observer contract
- role-gated future start/stop/pause/resume/run/scheduler command intents
- executable engineering/conformance standard
- reusable fault-injection harness
- package/startup/validation/memory performance budgets
- certification gate aggregation
- three small cross-platform bootstrap installers
- on-demand, version-matched platform adapters
- optional read-only stdio MCP adapter outside core
- package-size/anti-bloat guards
- automatic README package-footprint freshness gate
- Golden Path installation tests on Linux, macOS, and Windows
- scheduled Sentinel verification
- concise AI-agent instructions and dedicated skills
- 1,000+ automation supervision/concurrency conformance testing

## Operations and discovery commands

```text
taskrail env
taskrail paths
taskrail bootstrap
taskrail doctor
taskrail check
taskrail test
taskrail gate
taskrail verify-change
taskrail plan
taskrail deploy
taskrail ship
taskrail update
taskrail recover
taskrail health
taskrail rollback
taskrail drift
taskrail reconcile
taskrail repair
taskrail upgrade
taskrail list
taskrail status
taskrail inspect
taskrail components
taskrail component
taskrail capabilities
taskrail capability
taskrail capability-find
taskrail capability-check
taskrail impact
taskrail usage
taskrail update-plan
taskrail isolation-audit
taskrail conformance
taskrail diagnostics
taskrail security
taskrail agent
taskrail platform
taskrail init automation
taskrail init capability
```

Additional utilities include `taskrail-supervise`, `taskrail-heartbeat`, `taskrail-systemd-sync`, and `taskrail-platform-bootstrap`.

## Framework footprint

<!-- taskrail-footprint:start -->
**Current TaskRail package footprint: ~216 KiB compressed / ~1135 KiB unpacked. Runtime npm dependencies: 0.**

Measured automatically from the actual `npm pack` artifact. The CI size-check fails whenever these README figures drift, and the Golden Path release gate enforces an unpacked size budget.
<!-- taskrail-footprint:end -->

A separate **2 MB unpacked size guardrail** prevents accidental framework bloat. Platform installer/adapter source and optional MCP dependencies are deliberately excluded from the core npm package and installed only when relevant.

## What TaskRail deliberately does not require

- mandatory database
- Redis
- queue runtime
- heavyweight workflow-engine runtime
- permanent TaskRail daemon
- vector database
- runtime AI/model dependency
- dashboard requirement
- service mesh
- container requirement
- organization-specific business logic in public core

Individual automations can use any of these when their domain genuinely requires them; they are not framework prerequisites.

## Ecosystem direction

The compatibility model is designed for three independently releasable repositories:

- **taskrail** — small stable core, SDK, components, safety, compatibility, lifecycle, certification and skills
- **taskrail-hub** — governed reusable capabilities and optional ecosystem packages
- **taskrail-automations** — isolated example/reference automations

Compatibility metadata—not synchronized commits—is the contract between them. The core remains small even if the capability and automation ecosystems become large.

## Development philosophy

TaskRail optimizes for predictable AI-agent behavior, low context/token requirements, reusable technical building blocks, minimal duplication, deterministic validation, safe production changes, explicit contracts, failure isolation, secure defaults, modular upgrades, and low operational overhead.

A new TaskRail core component should be added only when repeated real-world automation work demonstrates a stable vendor-neutral primitive that cannot be cleanly expressed with existing components and capabilities.

A new control-plane feature should remain independently testable and should not become part of the ordinary automation execution hot path unless runtime execution genuinely requires it.
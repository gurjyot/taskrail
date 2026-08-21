<h1 align="center">TASKRAIL</h1>

<p align="center"><strong>Lightweight, AI-first automation framework for building, validating, deploying, updating, supervising, and safely operating production automations.</strong></p>

<!-- taskrail-size:start -->
<p align="center"><strong>⚡ Tiny framework footprint: ~108 KiB compressed / ~588 KiB unpacked, with zero runtime npm dependencies.</strong></p>
<!-- taskrail-size:end -->

TaskRail is a small control plane and SDK for reliable automation. It is designed to be especially easy for coding agents such as Codex and other AI development tools, while remaining deterministic and fully usable without AI. It provides reusable components, governed capabilities, thin automation scaffolds, deployment safety, transactional updates, rollback/recovery controls, supervision, platform adapters, and progressive-disclosure agent skills without requiring a database, queue, container platform, daemon, vector store, or runtime model service.

**Keywords:** automation framework, AI automation, coding agents, agentic automation, workflow automation, Node.js automation, TypeScript automation, deployment automation, automation SDK, reusable components, reusable integrations, capability registry, idempotency, transactional deployment, rollback, recovery, health checks, drift detection, systemd automation, cross-platform automation, production automation, Codex skills, AI developer tooling.

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

The diagram is plain text so it renders directly on GitHub, stays version-controlled, needs no image asset, and remains easy for both humans and coding agents to parse.

## Architecture: components, capabilities, automations

TaskRail separates reusable work into three layers:

1. **Components** — small, stable, vendor-neutral technical primitives owned and shipped by TaskRail core.
2. **Capabilities** — reusable integrations and domain actions composed from components. They are independently versioned and governed against semantic duplication.
3. **Automations** — isolated, thin business workflows that compose components and capabilities instead of rebuilding infrastructure.

The standard design decision is:

```text
REQUIREMENT -> COMPONENT LOOKUP -> CAPABILITY LOOKUP -> REUSE / EXTEND / CREATE / LOCAL -> IMPLEMENT -> VERIFY -> SHIP
```

Ordinary automation agents consume components; they do not invent new TaskRail core components. Before creating a capability, an agent must search the capability registry. Equivalent capabilities are reused instead of duplicated. A genuinely new reusable integration can be scaffolded as a governed capability.

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

## Usage graph and safe shared changes

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

Shared updates fail closed when the graph is incomplete. Patch/minor changes do not pause unrelated consumers. A breaking shared change identifies the exact dependent automation set that requires migration handling; unrelated automations remain outside that scope.

## Automation scaffolding

```bash
taskrail init automation my-automation --profile smg-node-timer@1
```

Profiles keep manifests small while supplying reusable operational defaults: runtime, deployment strategy, execution policy, health behavior, drift policy, resource limits, release retention, and optional service-manager integration.

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

The transaction records durable checkpoints and requires a proven recovery point before activation:

```text
DISCOVER -> IMPACT -> CHECKPOINT -> STAGE -> VALIDATE -> SIMULATE
       -> ROLLBACK-READY -> ACTIVATE -> VERIFY -> COMMIT
```

If activation fails:

```text
FAIL -> ROLLBACK-REQUIRED -> REVALIDATE OLD RELEASE -> RESTORE -> VERIFY -> CLOSE
```

If a candidate fails before activation, the transaction is **aborted** and the live release is untouched. If TaskRail cannot prove a safe recovery path after activation uncertainty, the transaction enters **recovery-required** and destructive cleanup/new activation is blocked until recovery is inspected.

Automations with migrations are conservative by default. Rollback compatibility must be explicitly proven before a transactional migration update can proceed:

```bash
taskrail update <automation> --migration-compatible
```

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

```bash
taskrail isolation-audit
taskrail conformance
taskrail-supervise
```

TaskRail does not serialize independent automations just because they start at the same time.

## Hooks and lifecycle events

The bounded lifecycle event bus lets integrations observe or explicitly authorized control-plane code participate in lifecycle events without bypassing TaskRail safety gates. Handlers are ordered, timeout-bounded, and classified as read-only or mutation-capable; mutation handlers require explicit authorization.

Examples include requirement analysis, staging, preflight, activation, health, rollback, release commit, and recovery-required events.

## Public SDK

TaskRail keeps public APIs deliberate instead of exposing every internal file:

```text
taskrail/components
taskrail/capabilities
taskrail/manifest
taskrail/testing
taskrail/control
```

`taskrail/control` includes lifecycle hooks, durable update checkpoints, recovery-readiness helpers, and transactional automation deployment.

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
- network access to GitHub for the small bootstrap installer path

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
      -> VERIFY SHA-256
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
```

## Golden Paths and release safety

TaskRail keeps independent release gates so one passing test cannot hide another class of failure:

- **TaskRail CI** — full framework tests and public API/CLI checks
- **Package Golden Path** — package footprint plus fresh packed-artifact install/scaffold on Linux, macOS, and Windows
- **Installer Golden Path** — actual Linux/macOS/Windows setup files, platform bootstrap failure tests, release payload checksums, and post-install verification
- **Release readiness audit** — version consistency, public API, docs/skills, required installers/adapters/workflows, and anti-bloat contracts

The release package builder fails if platform-specific installer payloads leak into the core npm tarball.

## TaskRail Sentinel

TaskRail Sentinel is a scheduled GitHub control-plane verifier—not a permanent daemon. It periodically reruns framework tests, public API checks, dependency security audit, release-package construction, and the executable release-readiness contract.

If Sentinel fails, it opens or updates one deduplicated GitHub issue with evidence and the workflow run. When all scheduled gates recover, Sentinel closes that issue automatically. Runtime fleet health remains handled by heartbeats/supervision plus the operating system or service manager.

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
- profile-aware thin automation scaffolding
- manifest/config contracts and preflight validation
- environment detection
- structured logs/errors and secret redaction
- deterministic execution IDs
- isolated local state
- durable idempotency claims
- decision journaling and heartbeats
- bounded retries, timeouts, concurrency, and execution policies
- CPU, memory, task, and process-priority guardrails
- systemd resource drop-ins and optional strict filesystem isolation
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
- executable engineering/conformance standard
- three small cross-platform bootstrap installers
- on-demand, version-matched platform adapters
- package-size/anti-bloat guards
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
taskrail platform
taskrail init automation
taskrail init capability
```

Additional utilities include `taskrail-supervise`, `taskrail-heartbeat`, `taskrail-systemd-sync`, and `taskrail-platform-bootstrap`.

## Framework footprint

<!-- taskrail-footprint:start -->
**Current TaskRail package footprint: ~108 KiB compressed / ~588 KiB unpacked. Runtime npm dependencies: 0.**

Measured automatically from the actual `npm pack` artifact. The Golden Path release gate enforces an unpacked size budget, and the main-branch size-sync workflow refreshes these figures after framework changes.
<!-- taskrail-footprint:end -->

A separate **2 MB unpacked size guardrail** prevents accidental framework bloat. Platform installer/adaptor source is deliberately excluded from the core npm package and downloaded only when relevant.

## What TaskRail deliberately does not require

- mandatory database
- Redis
- queue runtime
- heavyweight workflow-engine runtime
- TaskRail daemon
- vector database
- runtime AI/model dependency
- dashboard requirement
- service mesh
- container requirement
- organization-specific business logic in public core

Individual automations can use any of these when their domain genuinely requires them; they are not framework prerequisites.

## Ecosystem direction

The compatibility model is designed for three independently releasable repositories:

- **taskrail** — small stable core, SDK, components, safety, compatibility, lifecycle, and skills
- **taskrail-hub** — governed reusable capabilities
- **taskrail-automations** — isolated example/reference automations

Compatibility metadata—not synchronized commits—is the contract between them. The core remains small even if the capability and automation ecosystems become large.

## Development philosophy

TaskRail optimizes for predictable AI-agent behavior, low context/token requirements, reusable technical building blocks, minimal duplication, deterministic validation, safe production changes, explicit contracts, failure isolation, and low operational overhead.

A new TaskRail core component should be added only when repeated real-world automation work demonstrates a stable vendor-neutral primitive that cannot be cleanly expressed with existing components and capabilities.

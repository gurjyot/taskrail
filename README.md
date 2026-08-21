<h1 align="center">TASKRAIL</h1>

<p align="center"><strong>Lightweight, AI-first automation framework for building, validating, deploying, supervising, and safely operating production automations.</strong></p>

<!-- taskrail-size:start -->
<p align="center"><strong>⚡ Tiny framework footprint: ~108 KiB compressed / ~588 KiB unpacked, with zero runtime npm dependencies.</strong></p>
<!-- taskrail-size:end -->

TaskRail is designed for coding agents such as Codex and other AI development tools, but remains deterministic and useful without AI. It provides a small control plane, reusable component SDK, governed capabilities, deployment safety, runtime guardrails, and progressive-disclosure agent instructions without requiring a database, queue, container platform, daemon, vector store, or runtime AI service.

**Keywords:** automation framework, AI automation, coding agents, agentic automation, workflow automation, Node.js automation, TypeScript automation, deployment automation, CLI framework, automation SDK, reusable components, reusable integrations, capability registry, idempotency, retries, health checks, rollback, drift detection, systemd automation, production automation, Codex skills, AI developer tooling.

## How TaskRail works

```text
 REQUIREMENT / IDEA
        │
        ▼
 ┌────────────────────┐       ┌──────────────────────┐       ┌──────────────────────┐
 │ TASKRAIL + SKILLS  │──────▶│ COMPONENT CATALOG    │──────▶│ CAPABILITY REGISTRY  │
 │ understand + plan  │       │ stable core building │       │ reuse / extend /     │
 │ before coding      │       │ blocks               │       │ create / keep local  │
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
 │ SUPERVISE + LEARN  │◀──────│ EXECUTE SAFELY       │◀──────│ VERIFY + SHIP        │
 │ health / heartbeat │       │ isolation / limits   │       │ doctor / check /     │
 │ drift / decisions  │       │ retry / idempotency  │       │ test / plan / ship   │
 └────────────────────┘       └──────────────────────┘       └──────────────────────┘
```

The diagram is intentionally plain text: it renders directly in GitHub, stays version-controlled, works without external image assets, and remains easy for humans and coding agents to parse.

## Why TaskRail

Most automations repeat the same technical work: configuration, HTTP calls, retries, timeouts, state, idempotency, logging, filesystem safety, deployment, health checks, and service integrations. TaskRail makes those reusable by separating the system into three layers:

1. **Components** — small, stable, TaskRail-owned technical primitives.
2. **Capabilities** — reusable integration/domain modules composed from components.
3. **Automations** — thin business workflows that reuse components and capabilities instead of rebuilding infrastructure.

The intended development decision is:

`REUSE -> EXTEND -> CREATE CAPABILITY -> KEEP LOCAL`

Ordinary automation agents consume components but do not create new core components. New capabilities are allowed, but TaskRail searches and checks the registry first to prevent duplicate or semantically overlapping integrations.

## Core workflow

```text
doctor -> check -> test -> plan -> ship -> health
```

TaskRail keeps the mature deployment lifecycle separate from the new composition layer. Existing lifecycle commands continue to work through the same underlying implementation.

## Component SDK

TaskRail 2.0.8 exposes a stable public component surface through:

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

Current components:

| Component | Purpose |
| --- | --- |
| Execution context | Stable execution IDs and per-run context |
| Local state | Small durable local state without a database |
| Idempotency | Atomic claims and duplicate-execution protection |
| Retry | Bounded exponential retry with optional jitter |
| Timeout | Abort-aware operation timeouts |
| Concurrency | Bounded parallel work |
| HTTP | Safe generic HTTP requests and response handling |
| Config | Environment/config access and validation helpers |
| Structured logging | JSON-friendly logging with secret redaction |
| Safe filesystem | Root-bounded file operations and path protection |

Components are intentionally vendor-neutral. Service-specific integrations such as Telegram, Meta, Twenty, Postgres, Google, WordPress, Slack, or rclone belong in capabilities rather than core components.

### Component discovery

```bash
taskrail components
taskrail component http
```

## Governed capabilities

Capabilities are TaskRail's reusable integration ecosystem. A capability can describe:

- canonical purpose
- domain
- supported operations
- keywords
- side effects
- idempotency behavior
- components used
- input/output contract
- lifecycle status and supersession

TaskRail detects duplicate names and semantic hard conflicts. Capability scaffolding fails closed when an existing capability already covers the requested purpose unless an explicit reviewed overlap rationale is supplied.

### Capability discovery and validation

```bash
taskrail capabilities
taskrail capability <name>
taskrail capability-find "send telegram message"
taskrail capability-check <name> --strict
taskrail impact <name>
```

### Create a governed capability

```bash
taskrail init capability example-api \
  --description "Reusable Example API client" \
  --purpose "Call the Example service API" \
  --domain example \
  --operation read \
  --operation write \
  --component http \
  --component retry
```

Before creating anything, TaskRail searches the existing registry and returns reuse/overlap information.

## Automation scaffolding

Create a profile-aware automation skeleton:

```bash
taskrail init automation my-automation --profile smg-node-timer@1
```

Profiles provide reusable operational defaults such as runtime, deployment strategy, systemd service/timer definitions, execution policy, health checks, drift behavior, resource limits, and release retention.

## Features

TaskRail currently includes:

- **Tiny package footprint: ~108 KiB compressed / ~588 KiB unpacked, with zero runtime npm dependencies**
- CLI-first control plane
- public TypeScript/Node.js library API
- component SDK
- governed capability registry
- semantic duplicate capability detection without embeddings or vector infrastructure
- profile-aware automation scaffolding
- capability scaffolding and strict conformance checks
- manifest/config contract
- environment detection
- validation and preflight gates
- plugin/adapter support
- structured logs and errors
- secret guardrails and redaction
- deterministic execution IDs
- isolated local state
- durable idempotency claims
- decision journaling
- heartbeats
- bounded retries
- operation timeouts
- bounded concurrency
- execution policies
- CPU, memory, task, and process-priority guardrails
- systemd integration and generated resource drop-ins
- health checks and freshness SLAs
- read-only multi-service supervision
- deployment locks
- immutable release support
- backup and retention
- atomic deployment
- last-known-good tracking
- automatic rollback
- drift detection and reconciliation
- change inspection and deployment eligibility checks
- compatibility checks and safe manifest upgrades
- concise AI-agent instructions
- dedicated TaskRail automation, capability-authoring, and core-maintainer skills
- CI and conformance tests

## AI-agent skills

TaskRail uses progressive disclosure so coding agents do not need to load the whole framework into context for every change.

Included skills:

- `skills/taskrail/SKILL.md` — normal TaskRail automation development and operation
- `skills/taskrail-capability/SKILL.md` — governed capability creation and maintenance
- `skills/taskrail-core/SKILL.md` — TaskRail framework/component maintenance only

Repository-level `AGENTS.md` provides the short global rules. Deeper framework documentation is loaded only when an agent is changing the corresponding layer.

The key rule is simple: **check components and capabilities before writing reusable infrastructure or integration code.**

## Installation requirements

### Framework development

Recommended:

- Node.js 22
- npm
- Git

The framework itself has **zero runtime npm dependencies**. Development currently uses TypeScript and Node type definitions only.

### Running managed automations

Requirements depend on the selected profile/runtime. Typical Node automations require Node.js; production Linux profiles that use TaskRail's service-manager features require systemd. Shell and PHP automation profiles can use their corresponding runtimes.

TaskRail itself does not require Docker, Kubernetes, Redis, Postgres, a queue, or a long-running TaskRail daemon.

## Install today

Until TaskRail is published as a public package, install from the repository:

```bash
git clone https://github.com/gurjyot/taskrail.git
cd taskrail
npm ci
npm run build
npm test
npm run check
```

For development from another project, use the repository/package locally after building.

### Planned easy installation

The recommended distribution path is to publish TaskRail as a normal npm package so installation becomes:

```bash
npm install -g taskrail
```

or, without a permanent global install:

```bash
npx taskrail --help
```

A cross-platform installer can then wrap npm for macOS, Linux, and Windows while keeping the package itself platform-neutral. Linux/systemd-specific deployment features remain optional and profile-dependent.

## Deploy an automation

1. Inspect the environment and manifest:

```bash
taskrail doctor <automation>
```

2. Validate and test:

```bash
taskrail check <automation>
taskrail test <automation>
```

3. Inspect the deployment plan:

```bash
taskrail plan <automation>
```

4. Run the safe deployment lifecycle:

```bash
taskrail ship <automation>
```

5. Verify health:

```bash
taskrail health <automation>
```

`ship` performs the guarded production path instead of encouraging ad-hoc edits. Deployment behavior includes validation, tests/gates, candidate preparation, backup/release tracking, atomic replacement, post-deploy health verification, and rollback support.

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
taskrail init automation
taskrail init capability
```

Additional utilities include `taskrail-supervise`, `taskrail-heartbeat`, and `taskrail-systemd-sync`.

## Framework footprint

<!-- taskrail-footprint:start -->
**Current TaskRail package footprint: ~108 KiB compressed / ~588 KiB unpacked. Runtime npm dependencies: 0.**

Measured automatically from the actual `npm pack` artifact. The Golden Path release gate enforces an unpacked size budget, and the main-branch size-sync workflow refreshes these figures after framework changes.
<!-- taskrail-footprint:end -->

A separate **2 MB unpacked size guardrail** currently prevents accidental framework bloat.

## What TaskRail deliberately does not include

- mandatory database
- Redis
- queue runtime
- workflow-engine runtime
- TaskRail daemon
- vector database
- runtime AI/model dependency
- dashboard requirement
- service mesh
- container requirement
- organization-specific business logic in public core

These can be used by individual automations when needed, but they are not framework requirements.

## Architecture boundary

Use a **component** when the behavior is small, generic, vendor-neutral, stable, and useful across many unrelated automations.

Use a **capability** when the behavior represents an integration, protocol/service client, reusable domain action, or vendor-specific contract composed from components.

Keep logic **local to an automation** when it is business-specific and unlikely to be reused.

This boundary keeps TaskRail small while allowing the capability ecosystem to grow quickly.

## Compatibility and safety

TaskRail 2.0.8 is an additive 2.0.x release. Existing automation manifests and lifecycle/deployment behavior remain compatible; the component and capability composition layer is added without introducing a centralized runtime.

## Development philosophy

TaskRail optimizes for:

- predictable AI-agent behavior
- small context/token requirements
- reusable technical building blocks
- minimal duplication
- deterministic validation
- safe production deployment
- explicit contracts over hidden magic
- low operational overhead

A new TaskRail core component should be added only when repeated real-world automation work demonstrates a vendor-neutral primitive that cannot be cleanly expressed using existing components and capabilities.

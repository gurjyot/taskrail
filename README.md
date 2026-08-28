<h1 align="center">TASKRAIL</h1>

<p align="center"><strong>Build automations fast. Run them robustly in production.</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/taskrail"><img alt="npm version" src="https://img.shields.io/npm/v/taskrail?label=version"></a>
  <a href="https://github.com/gurjyot/taskrail/actions/workflows/ci.yml"><img alt="TaskRail CI" src="https://github.com/gurjyot/taskrail/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Node 22+" src="https://img.shields.io/badge/Node-%3E%3D22-339933?logo=node.js&logoColor=white">
  <img alt="Zero runtime dependencies" src="https://img.shields.io/badge/runtime%20dependencies-0-brightgreen">
  <img alt="CLI startup" src="https://img.shields.io/badge/CI%20CLI%20startup-~50%20ms-blue">
  <img alt="Core package install" src="https://img.shields.io/badge/CI%20core%20install-~0.83%20s-blue">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/github/license/gurjyot/taskrail"></a>
</p>

<!-- taskrail-size:start -->
<p align="center"><strong>⚡ Tiny framework footprint: ~244 KiB compressed / ~1289 KiB unpacked, with zero runtime npm dependencies.</strong></p>
<!-- taskrail-size:end -->

## Primary goal

**TaskRail exists to make creating production automations faster and simpler without sacrificing runtime reliability.**

The priority order is deliberate:

1. **Fast automation development.** An automation author should spend almost all of their time on business logic, not deployment plumbing, systemd details, retries, rollback, logging, secrets, compatibility or certification boilerplate.
2. **Robust production execution.** TaskRail owns the reusable guardrails that make an automation safe to deploy, execute, verify, recover and operate under the real production runtime identity.
3. **Low framework overhead.** Framework sophistication is not a goal. A feature belongs in TaskRail only when it solves a repeated problem once and makes future automations easier, safer or faster.

The practical test for every TaskRail change is:

> **Does this make the next automation faster to build while keeping production execution trustworthy?**

If the answer is no, the change should normally stay out of the core.

TaskRail therefore favors **convention over configuration, thin business logic, reusable capabilities, automatic production guardrails and coordinated migrations while the ecosystem is still small**. Reliability should be inherited from the framework rather than reimplemented inside every automation.

## TaskRail in 15 seconds

| | Current measured / enforced state |
| --- | --- |
| **Core package** | ~244 KiB compressed / ~1289 KiB unpacked |
| **Runtime npm dependencies** | **0** |
| **CLI startup** | ~50 ms median / ~52 ms p95 in the current Ubuntu CI performance run |
| **Core package install** | ~0.83 s in the current Ubuntu Golden Path |
| **AI-agent context** | Progressive disclosure: load only the manifest, relevant instructions, components and capabilities |
| **Production changes** | Validate → stage → activate → health-check → commit or rollback |
| **Release safety** | CI + Golden Paths + installer matrix + fault injection + certification |

The performance figures above are reproducible CI measurements on GitHub-hosted Ubuntu 24.04 with Node 22.23.2, not universal hardware guarantees. The ~0.83 s figure measures installation of the already-built local TaskRail package; a first-time bootstrap can take longer when Node or release artifacts must be downloaded.

TaskRail deliberately keeps the hot path small. It does **not** require a database, queue, Redis, container platform, permanent TaskRail daemon, vector store, or runtime AI/model service.

## Built for AI agents: small context, less repeated work

**An AI agent does not need to scan the whole TaskRail repository every time it builds an automation.** TaskRail is designed around progressive disclosure.

For ordinary automation work, an agent normally needs only:

- the business requirement
- the automation manifest
- the short TaskRail/agent instructions relevant to the task
- the contracts for the components and capabilities it actually uses

The framework itself handles reusable infrastructure such as retries, timeouts, idempotency, state, deployment safety, rollback, drift checks, supervision, validation and release controls.

```text
REQUIREMENT
    ↓
SHORT TASKRAIL INSTRUCTIONS
    ↓
LOOK UP ONLY WHAT IS NEEDED
    ↓
REUSE COMPONENTS / CAPABILITIES
    ↓
WRITE THIN BUSINESS LOGIC
    ↓
TASKRAIL HANDLES SAFETY + OPERATIONS
```

That means the expected AI workflow is **discover → reuse → implement thin logic → verify**, not **scan the whole framework → rebuild infrastructure → repeat**. Exact token savings vary by model and task, so TaskRail does not advertise a made-up percentage; the architectural goal is simply to keep the agent's working context small and deterministic.

Useful discovery commands:

```bash
taskrail components
taskrail component <name>
taskrail capability-find "<needed behavior>"
taskrail capability <name>
taskrail doctor <automation>
taskrail check <automation>
taskrail test <automation>
```

## How TaskRail works

```text
 REQUIREMENT / IDEA
        │
        ▼
 ┌────────────────────┐       ┌──────────────────────┐       ┌──────────────────────┐
 │ TASKRAIL + SKILLS  │──────▶│ COMPONENT CATALOG    │──────▶│ CAPABILITY REGISTRY  │
 │ small agent context│       │ stable core building │       │ search / reuse /     │
 │ understand + plan  │       │ blocks               │       │ extend / create      │
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
 │ health / heartbeat │       │ retry / isolation    │       │ tests / rollback /   │
 │ drift / diagnostics│       │ limits / idempotency │       │ compatibility        │
 └────────────────────┘       └──────────────────────┘       └──────────────────────┘
```

The governing rule is: **centralize reusable primitives and safety contracts; decentralize automation decisions and execution.**

## Quick start

TaskRail requires Node.js 22 or newer.

```bash
npm install -g taskrail

taskrail components
taskrail init automation hello-taskrail --profile portable-node@1
cd hello-taskrail

taskrail doctor
taskrail check
taskrail test
```

For a first production deployment:

```text
doctor → check → test → plan → ship → health
```

```bash
taskrail plan
taskrail ship
taskrail health
```

For an existing automation with a verified last-known-good release, use the stricter transactional path:

```bash
taskrail update <automation>
```

The update path stages and validates the candidate before activation, verifies rollback readiness, activates atomically, checks health, and commits only after success. If post-activation health fails, TaskRail restores the last-known-good release when a safe rollback path is proven.

## Small core, reusable capabilities

TaskRail keeps vendor-neutral technical primitives in the core and service-specific integrations in governed capabilities.

Core components include execution context, local state, idempotency, retry, timeout, bounded concurrency, safe HTTP, typed config, structured logging and safe filesystem operations.

Service integrations such as Telegram, Meta, Google, Shopify, WordPress or CRM APIs belong in capabilities. Before creating one, agents are expected to search the capability registry and reuse an existing equivalent when available.

```bash
taskrail capabilities
taskrail capability-find "send telegram message"
taskrail capability-check <name> --strict
taskrail impact <name>
taskrail usage
```

## Production safety, without a heavyweight control plane

TaskRail includes the contracts needed to operate automations predictably while keeping runtime machinery small:

- bounded subprocesses, retries, timeouts and output capture
- isolated per-automation state, locks, releases and heartbeats
- immutable release snapshots and last-known-good tracking
- health verification and rollback/recovery controls
- drift detection and reconciliation
- compatibility and blast-radius analysis
- resource/isolation policies for systemd workloads
- privacy-safe structured diagnostics and Error Intelligence
- bounded operational-history retention
- fail-closed mutation authorization

### Release provenance

TaskRail can verify artifact identity, approved source, checksum, metadata, timestamp validity and optional cryptographic signatures without adding a runtime npm dependency.

### Versioned security policy

Security controls are explicit and versioned: secret redaction, scoped secrets, deny-by-default network exposure, untrusted-input boundaries, SQL/shell safety, private state and signed provenance where required.

### Fault injection

Fault injection is a release/test capability, not runtime machinery. Scenarios include interrupted downloads, checksum corruption, permission failures, full-disk simulation, stale locks, state corruption, rollback interruption and reboot reconciliation. A scenario passes only when containment or recovery is proven.

### TaskRail certification

A release is not considered certified because one test passed. Certification aggregates independent gates such as core CI, package Golden Path, installer Golden Path, release-readiness checks, fault injection, security/provenance checks and the optional MCP matrix.

```text
TASKRAIL CERTIFIED — PASS
```

should mean the required gates independently passed.

## Cross-platform installation

TaskRail uses three small user-facing bootstrap installers and downloads only the platform adapter required by the host.

### Linux

```bash
chmod +x taskrail-install-linux.sh
./taskrail-install-linux.sh
```

### macOS

```bash
chmod +x TaskRail-Install.command
./TaskRail-Install.command
```

### Windows

Run `TaskRail-Install.ps1` with PowerShell.

The installer protocol is fail-closed:

```text
DETECT PLATFORM
  → FETCH VERSIONED RELEASE MANIFEST
  → DOWNLOAD COMMON TASKRAIL PACKAGE
  → VERIFY CHECKSUM / PROVENANCE
  → INSTALL CORE
  → DOWNLOAD ONLY THIS OS ADAPTER
  → VERIFY ADAPTER + VERSION
  → REGISTER ATOMICALLY
  → VERIFY CLI + PLATFORM STATUS
```

## Optional MCP adapter

MCP is deliberately outside the core package. The adapter is stdio-first, has no network listener by default, is read-only by default, and is tested separately across Linux, macOS and Windows. TaskRail CLI remains canonical.

## Performance is a release contract

TaskRail measures real execution rather than relying on claims. CI currently checks:

- cold CLI startup across multiple fresh processes, including median, p95 and max
- representative manifest/config validation time
- resident memory
- compressed and unpacked package size
- clean packed-package installation on Linux, macOS and Windows

Each CI run preserves a machine-readable performance report so performance changes can be compared over time. Performance budgets fail the release gate when the framework exceeds its allowed envelope. The intention is to detect gradual degradation before it becomes operational pain—not to add caches, daemons or lazy-loading machinery unless profiling proves they provide meaningful value.

Current core budgets are intentionally generous safety ceilings rather than targets:

| Metric | Release ceiling |
| --- | ---: |
| Compressed package | 512 KiB |
| Unpacked package | 2 MiB |
| CLI startup p95 | 1000 ms |
| Representative validation | 5000 ms |
| RSS | 128 MiB |

The current measured startup is far below the ceiling, so TaskRail prioritizes correctness and deployment reliability over shaving milliseconds that users will not notice.

## Public SDK

Stable public surfaces:

```text
taskrail/components
taskrail/capabilities
taskrail/manifest
taskrail/testing
taskrail/control
taskrail/agent
taskrail/platform
```

Internal implementation files can evolve without turning every source path into a semver promise.

## Framework footprint

<!-- taskrail-footprint:start -->
**Current TaskRail package footprint: ~244 KiB compressed / ~1289 KiB unpacked. Runtime npm dependencies: 0.**

Measured automatically from the actual `npm pack` artifact. The CI size-check fails whenever these README figures drift, and the Golden Path release gate enforces an unpacked size budget.
<!-- taskrail-footprint:end -->

A separate **2 MiB unpacked guardrail** prevents accidental framework bloat. Platform installer assets and optional MCP dependencies are deliberately excluded from the core npm package.

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

Individual automations can still use any of these when their domain genuinely requires them; they are not framework prerequisites.

## Deeper documentation

The README is intentionally the human-facing overview. Detailed contracts live in focused docs instead of turning this page into a reference manual:

- [`FRAMEWORK.md`](FRAMEWORK.md) — framework contract and operating model
- [`docs/taskrail-3-reliability-architecture.md`](docs/taskrail-3-reliability-architecture.md) — reliability architecture
- [`docs/architecture/ai-development-workflow.md`](docs/architecture/ai-development-workflow.md) — AI development workflow
- [`docs/architecture/component-capability-model.md`](docs/architecture/component-capability-model.md) — component/capability model
- [`docs/diagnostics-and-security.md`](docs/diagnostics-and-security.md) — diagnostics and security
- [`docs/ERROR-INTELLIGENCE.md`](docs/ERROR-INTELLIGENCE.md) — Error Intelligence
- [`docs/platform-and-insights-contract.md`](docs/platform-and-insights-contract.md) — platform/dashboard boundary

## Development philosophy

TaskRail optimizes first for **automation author speed**, then for **production reliability inherited from the framework**, while keeping context/token requirements, runtime overhead and operational machinery small.

Automation authors should write business logic and declare only what cannot be inferred. TaskRail should own repeated infrastructure concerns once: deployment, runtime verification, retries, timeouts, state, logging, rollback, drift handling, compatibility and production certification. While the ecosystem is still small, coordinated migrations are preferred over preserving unnecessary legacy complexity indefinitely.

A new core component should be added only when repeated real-world automation work demonstrates a stable vendor-neutral primitive that cannot be cleanly expressed with existing components and capabilities. A new control-plane feature should stay independently testable and remain outside the ordinary automation hot path unless runtime execution genuinely requires it.

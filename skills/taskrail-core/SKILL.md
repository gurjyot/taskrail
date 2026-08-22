---
name: taskrail-core
description: Maintain TaskRail core and its fixed component platform with strict compatibility and component acceptance gates.
reviewed_for_taskrail: 3.0.6
---
# TaskRail Core / Component Maintenance

Use this skill only when changing TaskRail itself. Ordinary automation/capability agents must not create components.

## Component acceptance gate

A new component is allowed only when all are true:

1. It solves a generic technical concern, not a business/domain concern.
2. It is useful across several unrelated automation categories.
3. Its public API can remain stable through the current major line.
4. Central ownership materially reduces duplicated code, bugs, or agent tokens.
5. It requires no mandatory daemon, database, queue, Docker, or external service.
6. It has deterministic tests.
7. It cannot be expressed more cleanly as a capability.

If any condition fails, do not add a component.

## Dependency boundary

Allowed:

`automation -> capability -> component -> core`

Also allowed: `automation -> component`.

Forbidden:

- core or component depending on capability
- component depending on automation/customer/domain state
- capability depending on an automation
- cross-domain shared memory

## Component quality

Every component must:

- have a stable versioned registry entry
- expose typed public API through `taskrail/components`
- perform no network/background work on import
- be dependency-light and cheap to initialize
- document error semantics
- pass unit and public contract tests
- preserve existing API behavior for additive releases

Prefer adapting existing hardened TaskRail primitives rather than creating parallel implementations.

## CLI and command contracts

`taskrail test` and `taskrail ship` each have one canonical implementation routed by `taskrail-cli.ts`. Do not reintroduce duplicate command implementations in legacy CLI files.

The bounded command runner is deliberately not a shell. Do not add implicit shell execution to support pipes, redirects, `&&`, or inline environment assignments. Complex operations belong in explicit scripts.

TaskRail supports zero or one operational plugin per automation manifest. Do not broaden this to multi-plugin deployment aggregation without a demonstrated contract and concrete need.

## Compatibility and package surface

Do not close existing stable import paths accidentally. New code should use the deliberate public APIs. The v3 `./dist/*` deep-import bridge exists only for compatibility and must not be expanded; removal requires a major release and consumer migration evidence.

Additive public APIs may ship within the major line. Breaking contract changes require a major TaskRail version and an explicit migration path.

## Update surface gate

Every TaskRail core change must review the surfaces that can drift with the framework: MCP, packaged skills, platform/install assets, public APIs, critical docs, tests, security/fault/performance gates, examples/contracts, and release packaging.

Run `npm run surfaces:check` before considering a framework change complete. Every top-level TaskRail CLI command must be classified in `adapters/mcp/compatibility.json` as either MCP-exposed or intentionally excluded. A new or removed CLI command must fail the gate until that MCP review is recorded.

Run `npm run mcp:check` for the packed MCP consumer test. Release certification must include both update-surface and packed-MCP gates; do not rely only on the standalone MCP workflow.

## Release skill freshness gate

Skills are part of the framework contract. Every TaskRail version must explicitly review every packaged `skills/*/SKILL.md` file. The `reviewed_for_taskrail` value must exactly match `package.json` and `npm run skills:check` must pass.

A skill review may conclude that no prose change is necessary, but the review marker must still advance with the framework version. Never bypass or weaken this gate to complete a release.

## Performance discipline

Preserve measurement-based performance checks. Startup regression should be evaluated against the checked-in baseline as well as absolute ceilings, and memory measurement should represent the spawned TaskRail CLI process rather than the benchmark runner.

Do not introduce caches, persistent inventories, indexes, daemons, worker pools, or other optimization machinery unless measurements demonstrate a material bottleneck. Prefer the smallest change that restores a measured budget.

## Core restraint

TaskRail remains an SDK/control plane, not a central execution engine. Do not introduce mandatory storage, worker pools, schedulers, vector stores, AI calls, or runtime services to solve development-time convenience problems.

Once correctness, compatibility, security, release gates, performance budgets, update surfaces, MCP compatibility, and skill freshness are green, freeze core and return effort to automations rather than continuing speculative framework expansion.

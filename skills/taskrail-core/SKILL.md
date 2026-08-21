---
name: taskrail-core
description: Maintain TaskRail core and its fixed component platform with strict compatibility and component acceptance gates.
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

## Compatibility

Do not close existing import paths accidentally. Additive public APIs may ship within the major line. Breaking contract changes require a major TaskRail version and an explicit migration path.

## Core restraint

TaskRail remains an SDK/control plane, not a central execution engine. Do not introduce mandatory storage, worker pools, schedulers, vector stores, AI calls, or runtime services to solve development-time convenience problems.

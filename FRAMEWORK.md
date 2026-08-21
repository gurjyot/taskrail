# TaskRail Contract

## Goal

TaskRail is an AI-first automation SDK and control plane. It provides stable technical components, governed reusable capabilities, lifecycle guardrails, deployment safety, and operational reporting. Domain intelligence stays in automations.

## Layers

`automation -> capability -> component -> core`

Automations may also use components directly for generic technical needs.

- **Core**: lifecycle, validation, deployment, compatibility, supervision, resource safety.
- **Components**: fixed TaskRail-owned technical primitives with stable public APIs.
- **Capabilities**: governed reusable integrations/features that agents may create or extend.
- **Automations**: domain decisions and orchestration.

Forbidden dependencies:

- core/component -> capability
- component/capability -> automation
- cross-domain shared memory

## Rules

1. Keep core and components small.
2. No mandatory storage, queue, Docker, daemon, vector store, or AI layer.
3. TypeScript/Node.js is the TaskRail implementation runtime; managed applications may use supported runtimes.
4. CLI is the control plane.
5. Components are TaskRail-owned and cannot be created by ordinary automation/capability agents.
6. Capability discovery is mandatory before creating reusable integration code.
7. Semantic duplicate capabilities fail validation when governed metadata establishes the same canonical purpose or substantially identical domain/operations.
8. Validation is enforced by tooling.
9. Deploy through TaskRail, not ad-hoc edits.
10. Deployment must validate, test, build candidate, back up, replace atomically, check health, and roll back if needed.
11. Projects may use other frameworks internally.

## Automation design workflow

Before substantial implementation:

`requirement -> component lookup -> capability lookup -> REUSE / EXTEND / CREATE / LOCAL -> implementation`

Delivery remains:

`doctor -> check -> test -> plan -> ship -> health`

Use `gate` and `verify-change` for shared/risky changes.

## Components

Stable public import:

`taskrail/components`

Initial component surface:

- execution
- state
- idempotency
- retry
- timeout
- concurrency
- HTTP
- config
- structured/redacted logging
- safe filesystem persistence

Components do no background/network work on import. Service-specific clients are capabilities, not components.

A new component must pass the component acceptance gate in the `taskrail-core` skill and be broadly useful across unrelated automation categories.

## Capabilities

Capability registry metadata may include:

- canonical purpose
- domain
- operations
- keywords
- side effects
- idempotency semantics
- TaskRail components consumed
- status/supersession

Creation should use `taskrail init capability`, which performs overlap checks before writing files. New capabilities should pass `taskrail capability-check <name> --strict`.

Superseded capabilities name a canonical replacement. Do not leave two active capabilities with the same canonical purpose.

## Progressive disclosure

Normal agents should load only:

- project `AGENTS.md`
- automation manifest
- TaskRail health/context
- compact component list
- compact capability search results

Read detailed component/capability docs only after shortlisting. Read implementation source only when modifying/debugging that unit.

## Operational surface

TaskRail includes:

- manifest/profile/framework-capability contracts
- validation, gate, planning and change verification
- immutable/safe deployment, backup and rollback
- drift detection and repair
- structured logs/errors and secret guardrails
- compatibility checks and tier-aware health
- execution IDs, isolated state, idempotency, retry/timeout/concurrency primitives
- heartbeat supervision and resource/systemd guardrails
- capability registry/discovery/governance
- TaskRail component SDK
- automation/capability scaffolding
- agent skills for automation, capability, and core maintenance

## Freeze policy

Add to core or the component catalog only when a real repeated generic problem cannot be solved cleanly with the existing component surface, a governed capability, or automation-local logic. Components evolve more slowly than capabilities.

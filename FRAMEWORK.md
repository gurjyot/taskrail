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

## Command execution contract

TaskRail manifest commands are executed by the bounded argument runner, **not by a shell**. Quoted and unquoted arguments are supported, but shell syntax is intentionally not interpreted. Do not place shell-only constructs such as environment-variable prefixes, pipes, redirects, command chaining, command substitution, or glob-dependent logic directly in manifest commands.

For complex command sequences, put the logic in a checked-in script and make the manifest invoke that script. This keeps timeout/output bounds deterministic and avoids expanding TaskRail's shell-attack surface.

## Plugin contract

A managed automation may declare **zero or one operational plugin**. Plugins are optional extension hooks for validation, health, backup/rollback, or change review; they are not a composition system. Reusable integration behavior belongs in capabilities instead. Manifests declaring multiple plugins fail validation rather than implying unsupported aggregation semantics.

## Public package surface

Use the deliberate public entry points:

- `taskrail/components`
- `taskrail/capabilities`
- `taskrail/manifest`
- `taskrail/testing`
- `taskrail/control`
- `taskrail/agent`
- `taskrail/platform`

Deep `taskrail/dist/*` imports remain available in the v3 line only as a legacy compatibility surface. They are internal, unstable, and may be removed in the next major release after consumer checks. New code must not depend on them. Source-tree imports are not part of the published package contract.

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

Do not add caches, indexes, daemons, or new fleet-wide coordination merely for theoretical scale. Introduce an in-memory workspace inventory or capability-governance optimization only when measured repository-scale profiling shows discovery/governance work is materially affecting a real invocation.

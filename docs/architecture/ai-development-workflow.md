# AI-First Development Workflow

Status: proposed agent contract

## Objective

Make reuse a deterministic stage of development, not an optional recommendation.

## Global agent rule

For every new automation and every substantial feature:

1. Understand the requested outcome.
2. Inspect TaskRail components relevant to the technical needs.
3. Search the capability registry using the intended purpose and operations.
4. Choose and record exactly one capability decision:
   - `REUSE`
   - `EXTEND`
   - `CREATE`
   - `LOCAL`
5. Only then design or change automation code.
6. Run the normal TaskRail lifecycle.

An agent must not create a capability without running capability discovery first.

## Capability selection order

1. Exact active capability by canonical purpose.
2. Existing capability with the required operation.
3. Existing capability that can accept a small backwards-compatible operation extension.
4. New capability.
5. Local logic only when the behavior is automation/domain specific.

## Duplicate prevention

A proposed capability is compared against the registry using normalized metadata.

Hard conflicts:
- same name
- same canonical purpose
- same domain + substantially same operations

Soft conflicts:
- strong keyword overlap
- same external service + overlapping operations
- capability marked as predecessor/successor

Hard conflicts block creation. Soft conflicts require an explicit decision to reuse, extend, or justify why the contracts are materially different.

No vector database or LLM is required for CI. AI may reason over the deterministic shortlist during development.

## Skills

### `taskrail`

Audience: automation-building agents.

Responsibilities:
- lifecycle
- component lookup
- capability-first decision
- compose existing building blocks
- keep business logic local

### `taskrail-capability`

Audience: agents creating/extending capabilities.

Responsibilities:
- search before creation
- semantic overlap review
- contract design
- side-effect/idempotency declaration
- scaffolding
- conformance tests
- consumer impact
- deprecation/supersession rules

### `taskrail-core`

Audience: agents modifying TaskRail itself.

Responsibilities:
- component acceptance gate
- public API stability
- compatibility
- benchmark/contract tests
- component catalog ownership

Ordinary automation agents should not be instructed how to author TaskRail components.

## Progressive disclosure

Keep startup context small.

Registry summary contains only enough metadata to choose candidates.
Detailed `CAPABILITY.md` is read only for shortlisted capabilities.
Implementation source is read only when changing/debugging a selected capability.

The same applies to components: compact component catalog first, detailed contract docs second, source last.

## Scaffolding contract

`taskrail init automation` generates:
- minimal manifest/profile
- entrypoint
- self-test
- AGENTS guidance/reference
- no duplicated infrastructure helpers

`taskrail init capability` generates:
- capability manifest
- `CAPABILITY.md`
- implementation entrypoint
- contract test
- integration-test placeholder where appropriate

Before writing files, capability init runs the duplicate-prevention search and fails closed on hard conflicts.

## Promotion rule

When an agent encounters generic integration/technical logic already present in another automation, it must stop before copying and evaluate extraction into a capability.

When generic platform/infrastructure behavior is repeatedly needed, the agent may propose a TaskRail component through a core change, but it must not create a component locally.

## Token-efficiency rules

- never load all capability docs
- never inspect component source when public docs are sufficient
- prefer generated scaffolds over hand-written boilerplate
- use CLI discovery output before repository-wide search
- load consumer impact only when changing shared behavior
- keep capability manifests concise and machine-readable

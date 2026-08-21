# TaskRail Component + Capability Architecture

Status: proposed architecture

## North star

TaskRail should make the correct reusable design the easiest design for an AI agent.

Before substantial automation code is written, the development flow is:

`requirement -> component lookup -> capability lookup -> reuse / extend / create -> automation logic -> TaskRail lifecycle`

## Components

Components are TaskRail-owned platform primitives.

Rules:

- only TaskRail releases may add/change components
- agents may never create components inside an automation repository
- components are versioned and have stable public contracts
- components must be domain-agnostic
- components may depend only on Node standard library or another lower-level TaskRail component when explicitly allowed
- components must not depend on capabilities, automations, customer data, or service-specific credentials
- components must be cheap to import and must not start background work on import
- components must be deterministic unless their purpose is explicitly I/O
- every component needs unit tests and public examples

### Component acceptance gate

A proposed component enters TaskRail core only when ALL are true:

1. It solves a generic technical concern, not a business/domain concern.
2. It is useful across several unrelated automation categories.
3. Its API can remain stable for a major TaskRail line.
4. Central ownership materially reduces bugs, tokens, or duplicated code.
5. It does not require a daemon, database, queue, Docker, or mandatory external service.
6. It can be tested deterministically.
7. The same need cannot be better expressed as a capability.

## Capabilities

Capabilities are reusable service/integration/feature units above components.

Examples: `telegram-send`, `wordpress-publish`, `meta-api`, `google-business-profile-read`.

Agents may create capabilities, but only through the capability governance flow.

### Capability-first decision

Every new automation or substantial feature must record one of:

- `REUSE:<capability>`
- `EXTEND:<capability>`
- `CREATE:<proposed-capability>`
- `LOCAL:<reason>`

Implementation begins only after this decision.

### Creation gate

A new capability is allowed only if:

- no existing capability has the same canonical purpose
- no existing capability covers the need through an existing operation or small backwards-compatible extension
- the functionality is reusable technical/integration behavior rather than automation-specific decision logic
- its contract is small and testable
- side effects and idempotency behavior are declared

### Semantic duplicate prevention

Capability names alone are not sufficient. The registry must maintain normalized discovery metadata:

- `name`
- `version`
- `description`
- `purpose`
- `domain`
- `operations[]`
- `keywords[]`
- `input`
- `output`
- `sideEffects`
- `idempotency`
- `components[]`
- `canonicalPath`
- `status` (`active`, `deprecated`, `superseded`)
- `supersededBy` when relevant

Creation performs a deterministic candidate search using normalized purpose/domain/operations/keywords before scaffolding. AI may help judge ambiguous similarity during development, but runtime and CI never depend on an LLM.

If a likely overlap is found, creation fails closed until the agent chooses reuse, extension, or provides an explicit override rationale in the change record.

### Promotion rule

If generic technical/integration logic appears in a second automation, the agent must evaluate promotion to a capability before copying it.

## Public API boundaries

TaskRail publishes components through a single stable package namespace, conceptually:

```ts
import { http, retry, state, log } from '@taskrail/components';
```

Internal TaskRail files are not public APIs. Consumers must not import from `src/*` internals.

Capabilities may consume TaskRail components. Automations may consume components directly for generic primitives and capabilities for reusable integrations.

## Progressive disclosure for AI agents

Discovery must stay token-cheap.

Level 1: compact registry metadata only.
Level 2: `CAPABILITY.md` or component documentation when selected as relevant.
Level 3: implementation source only when modifying/debugging that unit.

Agents should never load the entire capability library into context.

## Required CLI UX

Target commands:

```sh
taskrail components
taskrail component <name>
taskrail capabilities
taskrail capability <name>
taskrail capability-find "publish wordpress post"
taskrail capability-check <name>
taskrail init automation <name> --profile <profile>
taskrail init capability <name>
```

`capability-find` is deterministic metadata search first. No runtime embeddings/vector DB.

`init capability` must refuse to scaffold when a probable equivalent exists unless an explicit reviewed override is supplied.

## Required skills

- TaskRail automation skill: composition and lifecycle.
- TaskRail capability skill: discovery, similarity review, contract design, scaffolding, tests, impact analysis.
- TaskRail core/component skill: maintainers only; strict component acceptance gate and compatibility rules.

Agents creating ordinary automations should not receive component-authoring instructions.

## Failure isolation

Components are libraries, not services. A component failure affects only the calling process.
Capabilities remain independently testable.
Automations remain independently executable.
No central component daemon or capability server exists.

## Compatibility

- additive component APIs may ship within the current major line
- removals/contract breaks require a major version
- deprecations must name a replacement and remain discoverable for a migration window
- capability supersession is explicit; duplicates must not silently coexist

## Quality gates

Every component:

`typecheck -> unit tests -> API contract tests -> benchmark/smoke -> docs example`

Every capability:

`manifest validation -> duplicate/similarity check -> unit/integration tests -> consumer impact -> health contract`

Every automation:

`component check -> capability decision -> doctor -> check -> test -> plan -> ship -> health`

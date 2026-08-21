---
name: taskrail
description: Build and operate TaskRail-managed automations using stable components and governed capabilities.
---
# TaskRail

Use this skill for ordinary TaskRail-managed automation work.

## Start cheap

Read the automation manifest and run:

- `taskrail doctor`
- `taskrail components`
- `taskrail capability-find "<needed behavior>"`

Do not load every component/capability implementation. Read detailed docs only for shortlisted building blocks.

## Required design decision

Before substantial new automation or feature code, record exactly one capability decision:

- `REUSE:<capability>` — existing capability fits
- `EXTEND:<capability>` — a small backwards-compatible operation should be added
- `CREATE:<capability>` — materially distinct reusable integration/technical behavior is missing
- `LOCAL:<reason>` — automation-specific business/domain logic

Do not start implementation before this lookup and decision.

## Components

Use TaskRail components for generic infrastructure such as HTTP, config, logging, state, idempotency, retry, timeout, bounded concurrency, and safe files.

Components are TaskRail-owned. Do not create or modify components during ordinary automation work. Import stable public APIs rather than TaskRail internals.

## Capabilities

- reuse the canonical active capability when it fits
- extend rather than fork when the existing capability can safely cover the operation
- use `taskrail init capability` only after discovery
- never create semantically overlapping capabilities to avoid changing an existing contract
- when generic integration logic would be copied into a second automation, evaluate promotion into a capability first
- keep capabilities small, modular, testable, explicit about side effects/idempotency, and free of secrets

For capability authoring or extension, switch to the `taskrail-capability` skill.

## Delivery lifecycle

`doctor -> check -> test -> plan -> ship -> health`

Use `gate` and `verify-change` when reviewing risky/shared changes. Treat drift as reconciliation, not silent overwrite.

## Restraint

Business decisions stay in automations. Service/integration reuse belongs in capabilities. Generic stable infrastructure belongs in TaskRail components. Do not expand TaskRail core for automation-specific needs.

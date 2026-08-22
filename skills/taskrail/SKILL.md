---
name: taskrail
description: Build and operate TaskRail-managed automations using stable components and governed capabilities.
reviewed_for_taskrail: 3.0.5
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

## Components and imports

Use TaskRail components for generic infrastructure such as HTTP, config, logging, state, idempotency, retry, timeout, bounded concurrency, and safe files.

Components are TaskRail-owned. Do not create or modify components during ordinary automation work. New work must use the deliberate public surfaces such as `taskrail/components`, `taskrail/capabilities`, `taskrail/manifest`, `taskrail/testing`, `taskrail/control`, `taskrail/agent`, and `taskrail/platform` rather than deep `dist` internals.

## Capabilities

- reuse the canonical active capability when it fits
- extend rather than fork when the existing capability can safely cover the operation
- use `taskrail init capability` only after discovery
- never create semantically overlapping capabilities to avoid changing an existing contract
- when generic integration logic would be copied into a second automation, evaluate promotion into a capability first
- keep capabilities small, modular, testable, explicit about side effects/idempotency, and free of secrets

For capability authoring or extension, switch to the `taskrail-capability` skill.

## Commands are not shell snippets

TaskRail executes declared commands with its bounded argument runner, not through a shell. Simple quoted/unquoted arguments are supported. Do not put shell operators, pipes, redirects, `&&`, or inline environment assignments into manifest commands. Put complex behavior in a checked-in script and invoke that script explicitly.

## Operational plugin contract

An automation may declare zero or one operational plugin. Do not model multiple operational plugins in one manifest; TaskRail validates this contract explicitly.

## Delivery lifecycle

`doctor -> check -> test -> plan -> ship -> health`

`test` and `ship` have one canonical CLI route each. Do not call legacy/deep CLI implementation files directly.

Use `gate` and `verify-change` when reviewing risky/shared changes. Treat drift as reconciliation, not silent overwrite. `ship` resolves automation source-relative dependency and lockfile paths from the automation workspace, so avoid CWD-dependent assumptions in automation code.

## Restraint

Business decisions stay in automations. Service/integration reuse belongs in capabilities. Generic stable infrastructure belongs in TaskRail components. Do not expand TaskRail core for automation-specific needs.

Do not add caches, daemons, indexes, worker services, or other framework machinery to optimize hypothetical scale. Require measured evidence of a real bottleneck first.

---
name: taskrail
description: Build and operate TaskRail-managed automations quickly using thin business logic and framework-owned production guardrails.
reviewed_for_taskrail: 3.0.8
---
# TaskRail

Use this skill for ordinary TaskRail-managed automation work.

## North star

Build the automation fast; inherit production reliability from TaskRail.

Automation code should contain business logic and genuine domain-specific configuration. Do not repeat standard runtime, deployment, validation, testing, health, systemd, rollback or operational plumbing when the selected profile already supplies it.

For a conventional automation, prefer a thin manifest such as:

```json
{
  "name": "example-report",
  "profile": "smg-node-timer@1",
  "capabilities": ["telegram-bot"]
}
```

Add manifest fields only when the automation genuinely differs from the profile convention.

## Fast development loop

Start with the requirement and the existing automation files. During normal implementation use:

```text
implement -> test -> check
```

Run:

- `taskrail capability-find "<needed behavior>"` when the automation needs an external/service integration
- `taskrail test` after meaningful logic changes
- `taskrail check` before considering the implementation locally complete

Do not scan the entire component or capability registry by default. Load only what the automation actually needs.

## Reuse without ceremony

Business/domain logic stays local to the automation.

When an external or reusable integration is needed:

- reuse the canonical active capability when it fits
- extend rather than fork when the existing capability can safely cover the operation
- create a capability only when materially distinct reusable integration behavior is missing
- keep automation-specific decisions out of shared capabilities

Use TaskRail components when generic infrastructure is actually needed, but do not browse or import components merely because they exist. Components are TaskRail-owned and ordinary automation work should not modify them.

For capability authoring or extension, switch to the `taskrail-capability` skill.

## Public imports only

New work must use deliberate public surfaces such as `taskrail/components`, `taskrail/capabilities`, `taskrail/manifest`, `taskrail/testing`, `taskrail/control`, `taskrail/agent`, and `taskrail/platform` rather than deep `dist` internals.

## Commands are not shell snippets

TaskRail executes declared command overrides with its bounded argument runner, not through a shell. Do not put shell operators, pipes, redirects, `&&`, or inline environment assignments into manifest commands. Put complex behavior in a checked-in script and invoke that script explicitly.

Most conventional automations should not need to declare validation/test/health commands at all; the profile owns them.

## Production lifecycle

Production is deliberately stricter than local development:

```text
doctor -> check -> test -> plan -> ship -> runtime verification -> health
```

TaskRail owns this production ceremony. Do not reproduce it inside automation code.

For Linux/systemd production, `ship` must pass the runtime-context gate: the declared service must be loaded, its real `User=` must be able to traverse `WorkingDirectory=`, required shared files must be readable by that user, and declared timers must be enabled and active. A code-level health pass does not replace this runtime check. A post-activation runtime failure must fail the ship and trigger rollback verification.

Treat drift as reconciliation, not silent overwrite. Use `gate` and `verify-change` for genuinely risky/shared changes.

## Restraint

Framework sophistication is not a goal. Before adding TaskRail core machinery, ask whether it makes future automations faster to build or materially strengthens production execution without increasing normal authoring complexity.

Do not add caches, daemons, indexes, worker services, dashboards or other framework machinery for hypothetical scale. Require measured evidence of a real need first.

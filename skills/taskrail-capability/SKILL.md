---
name: taskrail-capability
description: Create, extend, validate, deprecate, and govern reusable TaskRail capabilities without duplication.
reviewed_for_taskrail: 3.0.6
---
# TaskRail Capability Authoring

Use this skill only when the automation workflow has selected `EXTEND` or `CREATE`.

## Discovery before design

Always run:

- `taskrail capability-find "<intended purpose and operation>"`
- `taskrail capabilities`
- `taskrail impact <existing-capability>` when extension is being considered

Do not scaffold a capability before discovery.

## Prefer extension over duplication

Selection order:

1. exact canonical capability
2. existing capability already exposing the needed operation
3. small backwards-compatible extension to an existing capability
4. new capability

A different name is not sufficient justification for a new capability.

## New capability contract

Use `taskrail init capability` and provide:

- concise description
- canonical purpose
- domain/service
- explicit operations
- search keywords
- side-effect classification
- idempotency contract
- TaskRail components consumed
- minimal input/output contract

The scaffold performs deterministic overlap checks before writing files. Hard conflicts must not be bypassed. Soft overlap requires a written rationale explaining the materially different contract.

## Implementation boundaries

- use deliberate public surfaces such as `taskrail/components` rather than TaskRail deep internals
- do not create TaskRail components here
- keep authentication/config values outside git
- keep service-specific behavior here, not in TaskRail core
- avoid generic orchestration/business strategy in capability code
- do not depend on the legacy `taskrail/dist/*` compatibility bridge for new capability code

TaskRail's bounded command execution is not a shell. If a capability needs a complex local command, put that behavior in an explicit checked-in script instead of embedding shell operators in a manifest command.

## Verification

For a new capability:

`taskrail capability-check <name> --strict`

For a change:

- run capability tests
- run `taskrail impact <name>`
- test affected consumers when shared behavior changes
- verify side effects and idempotency semantics remain correct

## Lifecycle

Capabilities may be `active`, `deprecated`, or `superseded`. Superseded capabilities must name the canonical replacement. Do not leave two active capabilities with the same canonical purpose.

## Promotion rule

If reusable integration/technical logic appears in a second automation, evaluate capability extraction before copying it.

Do not optimize the capability catalogue for hypothetical scale. Keep deterministic duplicate detection until measurements demonstrate that catalogue size makes it a material bottleneck.

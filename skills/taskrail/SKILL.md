# TaskRail

Use TaskRail when working on managed automations.

Before meaningful work:
- `taskrail doctor`
- `taskrail list`
- if capability work is involved: `taskrail capabilities`
- if capability work is involved: `taskrail inspect <automation>`

Capability rule:
- check existing capabilities first
- reuse a capability when its contract fits
- create a new capability only when small reusable technical functionality is likely to help multiple automations
- do not create capabilities for trivial helpers
- do not create capabilities for automation-specific business logic
- keep capabilities small, fast, testable, modular, and free of secrets

Changing an automation:
`doctor -> source change -> gate -> verify-change -> plan -> deploy -> health`

Changing a shared capability:
- `taskrail capability <name>`
- `taskrail capability-impact <name>`
- test the capability and relevant consumers after changing shared behavior

Restraint:
- do not expand TaskRail core unless a real repeated problem cannot be solved with an automation, capability, adapter/helper, or the existing manifest/lifecycle

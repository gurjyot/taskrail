# TaskRail Contract

## Goal

TaskRail provides guardrails, structure, deployment safety, and operational reporting. It does not provide intelligence.

## Rules

1. Tiny core.
2. No mandatory storage, queue, Docker, daemon, or AI layer.
3. TypeScript/Node.js only.
4. CLI is the control plane.
5. Features live in plugins/adapters.
6. Validation is enforced by tooling.
7. Deploy through TaskRail, not ad-hoc edits.
8. Deployment must validate, test, build candidate, back up, replace atomically, check health, and roll back if needed.
9. Shared behavior belongs in framework code, not copied into each automation.
10. Projects may use other frameworks internally.

## Lifecycle

`doctor -> source change -> gate -> verify-change -> plan -> deploy -> health`

## Discovery

Normal automation work usually needs only:
- project `AGENTS.md`
- project manifest
- `taskrail doctor`
- CLI help when needed

Read deeper framework docs only when changing TaskRail itself.

## v1.2.0 surface

- manifest/config contract
- lifecycle
- validation
- plugins/adapters
- structured logs/errors
- `doctor`
- `plan`
- `gate`
- `verify-change`
- deployment locks
- immutable releases
- backup
- atomic deploy
- rollback
- drift detection
- secret guardrail
- compatibility checks
- tier-aware health
- lightweight audit history
- idempotency helper
- capability registry and discovery

## Agent contract

- Read manifest first.
- Reuse existing modules/adapters.
- Never patch managed production files directly.
- Do not duplicate integrations.
- Make changes in clean source/candidate files.
- Use TaskRail validation and deployment tools.
- Verify health after deployment.
- Treat drift as reconciliation.

## Freeze policy

After `v1.2.0`, add a new core feature only when a real managed application exposes a generic problem that cannot be solved cleanly through existing contracts or an optional adapter.

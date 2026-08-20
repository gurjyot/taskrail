# TaskRail Contract

## Goal

Make automations hard to break.

## Rules

1. Tiny core.
2. No mandatory storage, queue, Docker, daemon, or AI layer.
3. TypeScript/Node.js only.
4. CLI is the control plane.
5. Features live in plugins/adapters.
6. Validation is enforced by tooling.
7. Deploy through the framework, not ad-hoc edits.
8. Deployment must support validate, test, build candidate, backup, atomic replace, health check, drift detection, and rollback.
9. Shared behavior belongs in framework code, not copied into each automation.
10. Projects must stay free to use other frameworks internally.

## Lifecycle

`create -> check -> test -> build -> deploy -> verify -> run`

## v0.2 additions

- `plan`
- `doctor`
- deployment locks
- immutable releases
- audit history
- structured failure reports
- idempotency helper

## Deployment sequence

`validate -> test -> build candidate -> backup -> atomic deploy -> health check -> keep OR rollback`

## Managed project shape

- `AGENTS.md`
- `automation.json`
- `src/`
- `tests/`
- `deploy/`

## Agent contract

- Read framework rules first.
- Inspect existing modules before creating new ones.
- Do not duplicate integrations.
- Do not make ad-hoc production edits.
- Change source first.
- Run validation.
- Deploy with framework tooling.
- Verify health after deploy.

## v1 plugin model

Plugins are optional adapters that may provide:
- config loading
- health checks
- deploy hooks
- backup hooks
- runtime bindings
- external API clients

Core only knows the contract, not the implementation.

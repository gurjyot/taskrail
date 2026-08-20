# TaskRail v1.1.1

TaskRail is a lightweight framework for building, validating, deploying, and safely operating automations. It provides structure and guardrails without requiring a heavy runtime or orchestration platform.
It provides guardrails, structure, deployment safety, and operational reporting. It does not provide intelligence.

Core ideas:
- CLI first.
- Small core, optional adapters.
- Validate before deploy.
- Backup before replace.
- Health check after deploy.
- Roll back on failure.
- Plan and doctor commands for dry-runs and diagnostics.
- Locks, immutable releases, drift detection, and audit history.
- Keep agent instructions local to each managed project.

This repo is the public framework shell. It does not include organization-specific logic.

## Lifecycle

`doctor -> source change -> gate -> verify-change -> plan -> deploy -> health`

## v1 scope

- manifest
- project layout
- lifecycle
- config contract
- structured logging
- validation
- plugin interface
- CLI
- templates
- health-check contract
- safe deployment
- backup
- rollback
- `AGENTS.md` contract

## Excluded from v1

- Redis
- PostgreSQL
- Docker
- queue runtime
- daemon runtime
- dashboard
- AI framework
- org-specific adapters

## Freeze policy

After `v1.1.1`, add a new core feature only when a real managed application exposes a generic problem that cannot be solved cleanly through the existing contracts or an optional adapter.

## Commands

- `taskrail check`
- `taskrail gate`
- `taskrail verify-change`
- `taskrail plan`
- `taskrail doctor`
- `taskrail test`
- `taskrail build`
- `taskrail deploy`
- `taskrail verify`
- `taskrail run`
- `taskrail rollback`

## 1.1.1

- Fixed the canonical `taskrail gate` and deploy-time verification path.
- `taskrail deploy` now respects configured verification and protected paths.
- Protected paths support absolute and relative paths.
- Drift ignores generated release metadata.
- `taskrail rollback` resolves state from the active manifest.
- Command failures return clean TaskRail errors.

- `taskrail gate`
- `taskrail verify-change`
- optional `requiredChecks`
- optional `protectedPaths`
- deterministic PASS / FAIL / MISCONFIGURED gating
- `.taskrail/evidence/latest.json`
- portable command resolution for direct CLI smoke tests

## Suggested repo name

`taskrail`

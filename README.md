# TaskRail v0.2

TaskRail is a lightweight framework for building, validating, deploying, and safely operating automations. It provides structure and guardrails without requiring a heavy runtime or orchestration platform.

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

`create -> check -> test -> build -> deploy -> verify -> run`

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

## Commands

- `taskrail check`
- `taskrail plan`
- `taskrail doctor`
- `taskrail test`
- `taskrail build`
- `taskrail deploy`
- `taskrail verify`
- `taskrail run`
- `taskrail rollback`

## Suggested repo name

`taskrail`

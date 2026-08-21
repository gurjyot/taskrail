# TaskRail v2.0.4

TaskRail is a lightweight framework for building, validating, deploying, and safely operating automations.
It gives coding agents a small, deterministic contract for structure, guardrails, deployment safety, and discovery.
It does not provide intelligence.

## Core workflow

`doctor -> source change -> gate -> verify-change -> plan -> deploy -> health`

## Runtime rules

- Validation and test commands run from `sourceDir`.
- Health checks run from `deployDir`.
- Requiring `health` in pre-deploy `requiredChecks` can block repair of an already-broken live target. Deploy still performs post-deploy health and rollback.

## What TaskRail does

- CLI-first control plane.
- Zero runtime dependencies.
- Validation, preflight, and deploy-time gates.
- Atomic deployment, backup, rollback, drift detection, and locks.
- Concise agent guidance through local `AGENTS.md`.
- Optional reusable capabilities with deterministic discovery.

## Discovery

- `taskrail list`
- `taskrail status`
- `taskrail inspect <automation>`
- `taskrail capabilities`
- `taskrail capability <name>`
- `taskrail impact <name>`

## Capability rule

Check existing capabilities first, reuse when the contract fits, and create a new capability only for small generic technical functionality that is likely useful across multiple automations.

## v2.0.4 scope

- manifest/config contract
- lifecycle
- validation
- plugins/adapters
- structured logs/errors
- `doctor` and `doctor --json`
- `status --json` and `inspect --json`
- `plan`
- `gate` and `verify-change`
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
- concise `AGENTS.md`
- optional `skills/taskrail/SKILL.md`

## Still excluded

- database
- Redis
- queue runtime
- daemon runtime
- dashboard
- workflow engine
- AI framework
- service mesh
- package manager
- org-specific SMG logic in public core

## Freeze policy

After `v2.0.4`, add a new core feature only when a real managed application exposes a generic problem that cannot be solved cleanly through the existing contracts or an optional adapter.

## Commands

- `taskrail check`
- `taskrail gate`
- `taskrail verify-change`
- `taskrail plan`
- `taskrail doctor`
- `taskrail test`
- `taskrail deploy`
- `taskrail health`
- `taskrail rollback`
- `taskrail list`
- `taskrail inspect`
- `taskrail capabilities`
- `taskrail capability`
- `taskrail capability-impact`

# TaskRail v2.0.5

TaskRail is a lightweight framework for building, validating, deploying, and safely operating automations.
It gives coding agents a small, deterministic contract for structure, guardrails, deployment safety, and discovery.
It does not provide intelligence.

## Core workflow

`doctor -> check -> test -> plan -> ship`

## Runtime rules

- Validation and test commands run from `sourceDir`.
- Health checks run from `deployDir`.
- Requiring `health` in pre-deploy `requiredChecks` can block repair of an already-broken live target. Deploy still performs post-deploy health and rollback.

## What TaskRail does

- CLI-first control plane.
- Zero runtime dependencies.
- Environment-aware validation, preflight, and deploy-time gates.
- Atomic deployment, backup, rollback, last-known-good tracking, drift detection, and locks.
- Concise agent guidance through local `AGENTS.md`.
- Optional reusable business capabilities with deterministic discovery.
- Versioned framework capabilities and versioned profiles for reusable operational behavior.

## Discovery

- `taskrail list`
- `taskrail status`
- `taskrail inspect <automation>`
- `taskrail capabilities`
- `taskrail capability <name>`
- `taskrail impact <name>`

## Environment and operations

- `taskrail env`
- `taskrail paths`
- `taskrail bootstrap`
- `taskrail drift`
- `taskrail reconcile`
- `taskrail explain`
- `taskrail repair`
- `taskrail ship <automation>`
- `taskrail upgrade <automation>`

## Capability rule

Check existing capabilities first, reuse when the contract fits, and create a new capability only for small generic technical functionality that is likely useful across multiple automations.

## v2.0.5 scope

- manifest/config contract
- lifecycle
- validation
- environment detection
- plugins/adapters
- structured logs/errors
- `doctor` and `doctor --json`
- `status --json` and `inspect --json`
- `plan`
- `gate` and `verify-change`
- `env`, `paths`, `bootstrap`, `drift`, `reconcile`, `explain`, `repair`
- `ship`
- `upgrade`
- deployment locks
- immutable releases
- backup
- atomic deploy
- rollback
- last-known-good metadata
- drift detection
- secret guardrail
- compatibility checks
- tier-aware health
- lightweight audit history
- idempotency helper
- capability registry and discovery
- versioned framework capabilities
- versioned profiles
- effective manifest resolution
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

After `v2.0.5`, add a new core feature only when a real managed application exposes a generic problem that cannot be solved cleanly through the existing contracts or an optional adapter.

## Commands

- `taskrail check`
- `taskrail env`
- `taskrail paths`
- `taskrail bootstrap`
- `taskrail gate`
- `taskrail verify-change`
- `taskrail plan`
- `taskrail doctor`
- `taskrail test`
- `taskrail drift`
- `taskrail reconcile`
- `taskrail explain`
- `taskrail repair`
- `taskrail deploy`
- `taskrail ship`
- `taskrail upgrade`
- `taskrail health`
- `taskrail rollback`
- `taskrail list`
- `taskrail inspect`
- `taskrail capabilities`
- `taskrail capability`
- `taskrail capability-impact`

# AGENTS.md

Read this first. These rules apply to ChatGPT, Codex, Hermes, Claude, Copilot, other agents, and human contributors.

## Mandatory repository orientation

Before changing implementation:
1. Read `README.md`.
2. Read `docs/README.md` and the documents it marks as relevant to the task.
3. Read this file completely.
4. Read `FRAMEWORK.md` before changing TaskRail core behavior or public contracts.
5. Inspect the actual source/tests for the subsystem being changed; documentation gives the map, not permission to skip source inspection.

## Documentation is part of implementation

A change is **not complete** until the affected documentation is updated in the same iteration.

Update documentation whenever a change affects architecture, public APIs, CLI commands, manifests, components, capabilities, lifecycle/release behavior, security assumptions, diagnostics, supported platforms, installation, verification, performance contracts, repository relationships, or operator/agent workflow.

At minimum review:
- `README.md` for user-facing behavior and entry points.
- `FRAMEWORK.md` and architecture docs for framework contracts.
- `docs/README.md` for navigation.
- relevant focused docs under `docs/`.
- `CHANGELOG.md` when the change is release-significant.
- this `AGENTS.md` when agent workflow or invariants change.

Every new documentation file must be indexed and covered by documentation diagnostics in the same iteration. If a new kind of documentation cannot be meaningfully checked by the existing diagnostics, extend the diagnostics as part of that change. Run `npm run docs:check` before considering documentation work complete.

Never leave knowingly stale docs behind. If behavior is implemented but not yet runtime-verified, document it as implemented/unverified rather than as passing.

For the full policy, read `docs/DOCUMENTATION_POLICY.md`.

## Normal delivery workflow

`doctor -> check -> test -> plan -> ship -> health`

Before substantial automation or feature implementation:
1. inspect `automation.json`
2. run `taskrail doctor`
3. run `taskrail components` and prefer TaskRail components for generic technical infrastructure
4. run `taskrail capability-find "<needed behavior>"`
5. record exactly one decision: `REUSE`, `EXTEND`, `CREATE`, or `LOCAL`
6. only then write automation code

## Capability rules

- discovery is mandatory before capability creation
- reuse the canonical active capability when its contract fits
- extend an existing capability when a small backwards-compatible operation covers the need
- create a capability only for reusable integration/technical behavior that is materially distinct from existing capabilities
- use `taskrail init capability` rather than hand-building capability boilerplate
- use `taskrail capability-check <name> --strict` for new capabilities
- never copy reusable integration logic into a second automation without evaluating capability promotion
- keep automation-specific business decisions local

## Component rules

- components are TaskRail-owned platform APIs
- automation/capability agents consume components; they do not create components
- ordinary work imports the stable `taskrail/components` surface, not TaskRail internals
- component changes require the `taskrail-core` skill and the component acceptance gate

## Operational rules

- prefer profiles and framework capabilities for operational behavior
- never patch managed production files directly
- make clean source/candidate changes only
- do not repair corrupted managed files with repeated line edits
- use TaskRail lifecycle commands for validation and deployment
- treat drift as reconciliation, not silent overwrite
- use `taskrail repair` only for deterministic safe fixes
- verify health after deployment
- keep secrets out of git and docs

## When changing TaskRail itself

- use the `taskrail-core` skill
- run `npm run surfaces:check`; MCP, skills, platform/install assets, public APIs, critical docs/contracts, and release surfaces must be reviewed together
- run `npm run docs:check`; new documentation must be indexed and governed by diagnostics
- classify every top-level CLI command in `adapters/mcp/compatibility.json` as MCP-exposed or intentionally excluded
- run the packed MCP compatibility gate with `npm run mcp:check`
- advance every packaged skill review marker when the TaskRail version advances
- do not release unless full `npm run certify` passes

## Never

- add ad-hoc production edits
- add duplicate integrations or semantically duplicate capabilities
- create TaskRail components inside an automation/capability repository
- add SMG-specific logic to public core
- claim verification that did not actually run
- create orphaned/unindexed documentation or documentation without a maintenance diagnostic
- merge behavior changes while knowingly leaving affected documentation stale

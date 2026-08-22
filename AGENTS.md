# AGENTS.md

Read this first.

Normal delivery workflow:
`doctor -> check -> test -> plan -> ship -> health`

Before substantial automation or feature implementation:
1. inspect `automation.json`
2. run `taskrail doctor`
3. run `taskrail components` and prefer TaskRail components for generic technical infrastructure
4. run `taskrail capability-find "<needed behavior>"`
5. record exactly one decision: `REUSE`, `EXTEND`, `CREATE`, or `LOCAL`
6. only then write automation code

Capability rules:
- discovery is mandatory before capability creation
- reuse the canonical active capability when its contract fits
- extend an existing capability when a small backwards-compatible operation covers the need
- create a capability only for reusable integration/technical behavior that is materially distinct from existing capabilities
- use `taskrail init capability` rather than hand-building capability boilerplate
- use `taskrail capability-check <name> --strict` for new capabilities
- never copy reusable integration logic into a second automation without evaluating capability promotion
- keep automation-specific business decisions local

Component rules:
- components are TaskRail-owned platform APIs
- automation/capability agents consume components; they do not create components
- ordinary work imports the stable `taskrail/components` surface, not TaskRail internals
- component changes require the `taskrail-core` skill and the component acceptance gate

Operational rules:
- prefer profiles and framework capabilities for operational behavior
- never patch managed production files directly
- make clean source/candidate changes only
- do not repair corrupted managed files with repeated line edits
- use TaskRail lifecycle commands for validation and deployment
- treat drift as reconciliation, not silent overwrite
- use `taskrail repair` only for deterministic safe fixes
- verify health after deployment
- keep secrets out of git and docs
- read `FRAMEWORK.md` only when changing TaskRail itself

When changing TaskRail itself:
- use the `taskrail-core` skill
- run `npm run surfaces:check`; MCP, skills, platform/install assets, public APIs, critical docs/contracts, and release surfaces must be reviewed together
- classify every top-level CLI command in `adapters/mcp/compatibility.json` as MCP-exposed or intentionally excluded
- run the packed MCP compatibility gate with `npm run mcp:check`
- advance every packaged skill review marker when the TaskRail version advances
- do not release unless full `npm run certify` passes

Never:
- add ad-hoc production edits
- add duplicate integrations or semantically duplicate capabilities
- create TaskRail components inside an automation/capability repository
- add SMG-specific logic to public core

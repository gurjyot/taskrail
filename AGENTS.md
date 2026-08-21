# AGENTS.md

Read this first.

Normal workflow:
`doctor -> check -> test -> plan -> ship`

Rules:
- inspect `automation.json` first
- run `taskrail doctor` first for context
- prefer profiles and framework capabilities for operational behavior
- check existing capabilities before writing integration or infrastructure code
- reuse an existing capability when its contract fits
- create a new capability only for small generic technical functionality likely to help multiple automations
- keep one-off business logic local to the automation
- never patch managed production files directly
- make clean source/candidate changes only
- do not repair corrupted managed files with repeated line edits
- use `taskrail env`, `taskrail paths`, `taskrail check`, `taskrail gate`, `taskrail verify-change`, `taskrail plan`, `taskrail ship`, `taskrail health`, and `taskrail upgrade`
- treat drift as reconciliation, not silent overwrite
- use `taskrail repair` only for deterministic safe fixes
- verify health after deployment
- keep secrets out of git and docs
- read `FRAMEWORK.md` only when changing TaskRail itself

Never:
- add ad-hoc production edits
- add duplicate integrations
- add SMG-specific logic to public core

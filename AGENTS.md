# AGENTS.md

Read this first.

Normal workflow:
`doctor -> source change -> gate -> verify-change -> plan -> deploy -> health`

Rules:
- inspect `automation.json` first
- run `taskrail doctor` first for context
- check existing capabilities before writing integration or infrastructure code
- reuse an existing capability when its contract fits
- create a new capability only for small generic technical functionality likely to help multiple automations
- keep one-off business logic local to the automation
- never patch managed production files directly
- make clean source/candidate changes only
- do not repair corrupted managed files with repeated line edits
- use `taskrail check`, `taskrail gate`, `taskrail verify-change`, `taskrail plan`, `taskrail deploy`, and `taskrail health`
- treat drift as reconciliation, not silent overwrite
- verify health after deployment
- keep secrets out of git and docs
- read `FRAMEWORK.md` only when changing TaskRail itself

Never:
- add ad-hoc production edits
- add duplicate integrations
- add SMG-specific logic to public core

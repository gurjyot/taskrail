# AGENTS.md

Read this first for normal automation work:
- inspect `automation.json`
- run `taskrail doctor`
- inspect existing modules/adapters before adding new code
- reuse existing integrations
- change source, not managed production files
- use `taskrail check`
- use `taskrail test`
- use `taskrail plan`
- deploy only through `taskrail deploy`
- verify health after deployment
- treat drift as a reconciliation signal, not something to patch by hand
- keep secrets out of git

Normal workflow:
`doctor -> source change -> check -> test -> plan -> deploy -> health`

Do not read `FRAMEWORK.md` or deeper design docs unless changing TaskRail itself.

Never:
- patch managed production files directly
- duplicate an integration that already exists
- add SMG-specific logic to public core
- make ad-hoc deploys outside TaskRail

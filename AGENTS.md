# AGENTS.md

Read TaskRail docs first.

Rules:
- Read `FRAMEWORK.md` before editing.
- Inspect `automation.json` and the framework contract before changing architecture.
- Inspect existing modules before adding new code.
- Do not duplicate an existing integration.
- Never edit a managed production target directly.
- Rebuild complete source/candidate files instead of repeatedly patching corrupted production fragments.
- Change source first.
- Run `check`, `test`, `build`.
- Deploy through framework tooling only.
- Verify health after deploy.
- Reuse existing plugins/modules before creating new ones.

Safe defaults:
- Keep changes small.
- Keep secrets out of git.
- Keep org-specific logic out of the public core.

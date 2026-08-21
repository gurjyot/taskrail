# Changelog

## 2.0.5

- Added environment-aware lifecycle helpers and concise agent-facing commands: `env`, `paths`, `bootstrap`, `drift`, `reconcile`, `explain`, `repair`, `ship`, and `upgrade`.
- Added deploy receipts, explicit last-known-good release metadata, safer source/runtime discovery, and deterministic repair flows for stale locks and broken TaskRail symlinks.
- Added versioned framework capabilities, versioned profiles, effective manifest resolution, and safe declarative manifest upgrades so non-breaking framework improvements can flow to managed automations without business-logic edits.

## 2.0.4

- Documented sourceDir validation and test execution, deployDir health execution, and the pre-deploy health check tradeoff.
- Improved gate failure details to include the command, cwd, exit code, stdout, and stderr.
- Bumped the maintenance release to v2.0.4.

## 2.0.1

- Regenerated the package lockfile from `package.json`.
- Added YAML frontmatter to `skills/taskrail/SKILL.md`.
- Removed unused `LifecycleStep`.

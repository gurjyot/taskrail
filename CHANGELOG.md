# Changelog

## 1.2.1

- Fixed capability canonical path resolution.
- Validated capability implementation paths and required shared files.
- Rejected duplicate capability names across roots.
- Kept capability discovery deterministic and secret-free.

## 1.2.0

- Added capability registry and discovery commands.
- Added optional `capabilities` and `capabilityRoots` manifest fields.
- Validated declared capabilities during preflight.
- Kept capability output deterministic and secret-free.
- Preserved zero runtime dependencies and backward compatibility.

## 1.1.1

- Unified gate execution and enforced deploy-time verification.
- Fixed protected-path matching for absolute and relative paths.
- Ignored generated release metadata in drift detection.
- Fixed rollback state resolution from the active manifest.
- Hardened command execution failures.
- Updated templates and docs to the 1.1.1 workflow.

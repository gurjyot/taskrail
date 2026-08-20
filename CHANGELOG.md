# Changelog

## 1.1.0

- Added `taskrail gate` and `taskrail verify-change`.
- Added optional `requiredChecks` and `protectedPaths`.
- Added deterministic PASS / FAIL / MISCONFIGURED gating.
- Wrote verification evidence to `.taskrail/evidence/latest.json`.
- Fixed portable command resolution for direct CLI smoke tests.

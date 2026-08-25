# TaskRail AI instructions

Read `/AGENTS.md` and `/docs/README.md` before making changes.

For every substantial automation or feature change, use this order before implementation:

1. inspect the automation manifest and TaskRail health/context
2. inspect `taskrail components` for generic technical primitives
3. run `taskrail capability-find "<needed behavior>"`
4. choose `REUSE`, `EXTEND`, `CREATE`, or `LOCAL`
5. only then implement

Rules:

- documentation is part of implementation: update affected docs in the same iteration whenever behavior, interfaces, architecture, compatibility, security, diagnostics, release procedures, or agent workflow changes
- never claim tests, builds, certification, benchmarks, deployment, or runtime verification passed unless they actually ran
- reuse or extend the canonical capability instead of creating semantic duplicates
- create capabilities only through the governed capability workflow
- prefer `taskrail/components` for generic infrastructure
- do not create TaskRail components in automation/capability work
- components are changed only as TaskRail-core work under the component acceptance gate
- business/domain decisions stay local to automations
- never add shared cross-domain memory or a central runtime dependency
- preserve TaskRail lifecycle, isolation, idempotency, and compatibility guarantees
- follow `/docs/DOCUMENTATION_POLICY.md` and `/AGENTS.md` as authoritative repository policy

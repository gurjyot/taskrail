# Documentation Maintenance Policy

Documentation is a maintained product surface, not optional cleanup.

## Definition of done

Any change that alters behavior, interfaces, architecture, supported environments, dependencies, security assumptions, operational procedures, diagnostics, release gates, installation, compatibility, or agent workflow is incomplete until the relevant documentation is updated in the same iteration.

A contributor or agent must not mark work complete merely because code compiles or tests pass while the documented operating model is known to be stale.

## Documentation diagnostics

Documentation must be diagnosed, not merely written.

`npm run docs:check` is the canonical repository documentation diagnostic and is part of the normal TaskRail `check`/certification path. It verifies that required documentation exists, is non-empty, remains discoverable from the documentation index, and does not carry known unresolved documentation placeholders.

Every new documentation file or documentation category must be added to the appropriate index or registered documentation surface in the same iteration. New documentation must therefore become visible to diagnostics immediately; orphaned documentation is a failure, not an acceptable intermediate state.

When a new subsystem, capability class, operational surface, integration class, security boundary, or release surface requires documentation that existing diagnostics cannot meaningfully validate, the same change must extend the documentation diagnostics so that the new documentation has an enforceable health signal going forward.

Documentation diagnostics must never claim semantic correctness that was not checked. Structural/document-discovery PASS means only that those checks passed. Runtime, security, deployment, and behavior claims must still be backed by their respective executed gates.

## Required repository documentation

TaskRail should maintain:

1. `README.md` — concise public entry point and supported user workflow.
2. `AGENTS.md` — mandatory instructions/invariants for AI agents and humans.
3. `docs/README.md` — documentation map.
4. `FRAMEWORK.md` and focused architecture docs — durable contracts and boundaries.
5. security/diagnostics/operations/release documentation appropriate to the implemented system.
6. `CHANGELOG.md` for release-significant changes.

## Documentation rules

- Prefer durable concepts and contracts over narrating every line of code.
- Link to canonical source locations rather than duplicating large implementation blocks.
- Distinguish `implemented`, `verified`, `production-accepted`, `deprecated`, and `planned` states.
- Never claim a test, benchmark, deployment, platform build, or runtime behavior passed unless that verification actually ran.
- Never put secrets, credentials, private production values, tokens, or sensitive logs into documentation.
- Remove or correct stale instructions when replacing behavior; do not accumulate contradictory runbooks.
- Record important reasons and invariants so a future maintainer does not have to rediscover architectural intent from commit archaeology.
- New documentation must be indexed and covered by documentation diagnostics in the same iteration.
- If a new documentation surface introduces a new kind of maintenance risk, extend diagnostics to detect that risk rather than relying on memory or manual review alone.

## Agent rule for future repositories

When an agent creates a new project/repository for this ecosystem, documentation scaffolding is part of repository creation. Before substantial feature work, create at least:

- `README.md`
- `AGENTS.md`
- `docs/README.md`
- `docs/DOCUMENTATION_POLICY.md`
- an architecture/development document appropriate to the project

As the project grows, add focused security, operations, diagnostics, deployment/release, integration, and troubleshooting documents where relevant.

The repository must also gain a documentation diagnostics mechanism appropriate to its stack. Creating documentation without a corresponding health/maintenance check is incomplete ecosystem scaffolding.

## Final review

Before finishing an iteration, ask:

1. What observable behavior or contract changed?
2. Which document describes that behavior or contract?
3. Does it still tell the truth?
4. Are verification claims backed by an executed gate?
5. Is every new documentation surface indexed and covered by diagnostics?
6. Could an unfamiliar agent safely continue this work from the repository alone?

If any answer is no, the iteration is not finished.

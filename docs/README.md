# TaskRail Documentation Index

This is the navigation page for maintainers, AI agents, operators, and contributors.

## Read first

- `../README.md` — product purpose, quick start, user-facing capabilities, current performance/release posture.
- `../AGENTS.md` — mandatory working rules for agents and contributors.
- `../FRAMEWORK.md` — canonical framework contract and operating model.
- `DOCUMENTATION_POLICY.md` — rule that documentation changes with implementation.

## Architecture and contracts

- `taskrail-3-reliability-architecture.md` — reliability and transactional deployment architecture.
- `architecture/ai-development-workflow.md` — expected AI development flow and progressive disclosure.
- `architecture/component-capability-model.md` — boundary between core components, governed capabilities, and automation-local business logic.
- `platform-and-insights-contract.md` — platform/dashboard/read-model boundary.

## Security, diagnostics, and operations

- `diagnostics-and-security.md` — structured diagnostics, security boundaries, redaction and operational safety.
- `ERROR-INTELLIGENCE.md` — Error Intelligence behavior and evidence model.
- `operations/` — operational contracts/runbooks where present.

## Release and compatibility

When changing TaskRail core, review all surfaces together: CLI, public SDK, MCP adapter, skills, installers/platform assets, manifests, docs, tests, release metadata, and compatibility declarations. `npm run surfaces:check`, `npm run mcp:check`, and `npm run certify` are the authoritative repository gates.

## How to use these docs

Documentation explains intent, invariants, ownership, and expected workflow. It does not replace source inspection. Before modifying a subsystem, read the relevant document, then inspect the implementation and tests that enforce it.

If code and documentation disagree, stop and determine which is stale. Do not silently choose one and continue. Update the stale side deliberately and record any contract change.

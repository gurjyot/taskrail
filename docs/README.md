# TaskRail Documentation Index

This is the navigation page for maintainers, AI agents, operators, and contributors.

## Read first

- `../README.md` — product purpose, quick start, user-facing capabilities, current performance/release posture.
- `../AGENTS.md` — mandatory working rules for agents and contributors.
- `../FRAMEWORK.md` — canonical framework contract and operating model.
- `DOCUMENTATION_POLICY.md` — documentation maintenance policy and mandatory documentation diagnostics.

## Architecture and contracts

- `taskrail-3-reliability-architecture.md` — reliability and transactional deployment architecture.
- `architecture/ai-development-workflow.md` — expected AI development flow and progressive disclosure.
- `architecture/component-capability-model.md` — boundary between core components, governed capabilities, and automation-local business logic.
- `architecture/human-intervention-control-plane.md` — generic Needs-Me, approvals, drafts, actions, permissions, audit, Hermes requests, and real-time Control Center integration architecture.
- `architecture/human-intervention-control-plane-update.md` — implementation/status companion note for the human-intervention architecture.
- `architecture/control-center-dashboard-contract.md` — SMG Control Center modular dashboard contract: domain modules, automations controls, real Run Now results, logs, priorities, notifications, bulk actions and pagination.
- `platform-and-insights-contract.md` — platform/dashboard/read-model boundary.

## Security, diagnostics, and operations

- `diagnostics-and-security.md` — structured diagnostics, security boundaries, redaction and operational safety.
- `ERROR-INTELLIGENCE.md` — Error Intelligence behavior and evidence model.
- `operations/` — operational contracts/runbooks where present.

## Research and evaluations

- `research/components-capabilities-market-review.md` — research and market review informing the components/capabilities model.

## Documentation diagnostics

Run `npm run docs:check` whenever documentation is added or changed. It is also part of the normal TaskRail repository check path.

Every new documentation file must be discoverable from this index (directly or through an indexed documentation directory). If a new documentation type introduces a maintenance risk not covered by the current structural checks, extend the documentation diagnostic in the same change.

A documentation diagnostic PASS means the structural/document-governance checks passed; it does not replace runtime, security, deployment, performance, or behavioral verification.

## Release and compatibility

When changing TaskRail core, review all surfaces together: CLI, public SDK, MCP adapter, skills, installers/platform assets, manifests, docs, tests, release metadata, and compatibility declarations. `npm run surfaces:check`, `npm run docs:check`, `npm run mcp:check`, and `npm run certify` are authoritative repository gates.

## How to use these docs

Documentation explains intent, invariants, ownership, and expected workflow. It does not replace source inspection. Before modifying a subsystem, read the relevant document, then inspect the implementation and tests that enforce it.

If code and documentation disagree, stop and determine which is stale. Do not silently choose one and continue. Update the stale side deliberately and record any contract change.

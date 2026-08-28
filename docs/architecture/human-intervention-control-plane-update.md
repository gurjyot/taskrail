# Human Intervention Architecture Update

Date: 2026-08-29

This companion note preserves the full original `human-intervention-control-plane.md` specification while recording the implementation/status additions made after the Control Center requirements were clarified.

## Control Center requirements

The detailed modular dashboard contract is in `control-center-dashboard-contract.md`. It covers:

- Needs Me plus separate domain modules such as WhatsApp and Meta Ads;
- dynamically listed TaskRail automations;
- TaskRail-owned enable/disable controls;
- genuine production `Run Now` results rather than fixture/demo output;
- a guarded, bounded Run All concept;
- structured logs and error drill-down;
- high/urgent notification interruption only by default;
- normal/low items visible without interrupting the user;
- latest 50 records loaded by default with older history on demand;
- confirmation for bulk read/dismiss and other consequential bulk actions;
- modular UI architecture for future Marketing, Accounting and other agency modules.

## First implementation slice

The specification branch now includes `src/human-intervention.ts`, exported through `taskrail/platform`, with framework-generic contracts for:

- InterventionItem;
- ApprovalRequest;
- DraftSet and DraftOption;
- ActionRequest and ExecutionAttempt;
- IntelligenceRequest;
- AuditRecord;
- AutomationRunSummary;
- actor/source/resource references;
- durable human-intervention event envelopes.

It also includes fail-closed lifecycle guards for approvals, draft sets, actions and intelligence requests; the default high/urgent notification policy; a 50-item default Control Center page size with bounded maximum; draft-set validation; and action idempotency/payload identity validation.

Focused tests are in `test/human-intervention.test.ts`.

## Still deliberately not implemented

- persistence/database;
- platform-service HTTP API;
- SSE transport;
- authentication/session handling;
- Hermes worker bridge;
- Control Center TaskRail client;
- WhatsApp transport;
- Meta Ads mutations;
- production deployment.

Repository CI/status must be obtained and any contract/surface failures fixed before the implementation expands into persistence or network code.
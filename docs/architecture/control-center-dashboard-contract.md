# SMG Control Center Dashboard Contract

Status: architecture/UI contract. TaskRail remains authoritative; Control Center is a client/dashboard.
Date: 2026-08-29

## Purpose

SMG Control Center is the human-facing dashboard over TaskRail. It exists to answer two questions quickly:

1. What is TaskRail doing and is it healthy?
2. Where does TaskRail genuinely need human attention or a human decision?

It is not a second source of truth, not an automation runtime, and not an AI orchestrator. If Control Center is closed for days, TaskRail automations should continue normally.

## Core navigation

The interface should be modular rather than built as one giant dashboard. Initial modules:

- **Needs Me** — the cross-domain queue for genuine human intervention.
- **WhatsApp / Client Relations** — drafts, approvals and exceptional communication decisions.
- **Meta Ads** — recommendations, analysis and later approval of proposed campaign actions.
- **Automations** — TaskRail automation inventory, state, real Run Now actions and genuine execution results.
- **Logs** — TaskRail/platform and per-automation operational logs with error-focused filtering.

Future modules such as Marketing, Accounting, Sales, SEO, Websites or other departments must be addable without redesigning the shell.

A domain tab is a view over TaskRail-owned objects. Needs Me and domain tabs must not create duplicate records. The same intervention/recommendation can appear in multiple views while retaining one authoritative identity/state.

## Modular UI contract

Each domain module should plug into a shared shell using a small stable contract conceptually equivalent to:

```ts
interface ControlCenterModule {
  id: string;
  title: string;
  icon?: string;
  order?: number;
  badge?: ModuleBadgeQuery;
  routes: ModuleRoute[];
  capabilities: ModuleCapability[];
}
```

This is a Control Center presentation contract, not a TaskRail core API requirement. Modules may differ significantly in visual layout. Meta Ads does not need to look like WhatsApp; shared primitives should be reused only where they improve consistency.

The shell should provide navigation, global connection/health state, notification handling, loading/error boundaries, pagination conventions and shared confirmation dialogs.

## Needs Me

Needs Me contains only items where a human decision, approval or intervention is actually required.

Do not send routine autonomous work here merely because it happened.

Typical entries:

- choose one of three AI-generated client replies;
- approve/reject a consequential Meta Ads recommendation;
- resolve a payment or relationship escalation;
- intervene after repeated automation failure;
- provide missing information that automation/AI cannot safely infer.

Every item should show, at minimum:

- priority;
- domain/source;
- concise title;
- why human attention is required;
- relevant context;
- available actions;
- current status.

The user should be able to understand why they are being asked before opening deep context.

## Domain tabs

### WhatsApp / Client Relations

The tab surfaces exceptional communication decisions rather than every message.

For draft approvals, show three meaningfully different options by default:

1. recommended/balanced;
2. concise/direct;
3. detailed/explanatory.

Available actions can include send, edit, regenerate, reject, ask for more context and write manually. TaskRail owns the draft set and approval lifecycle; the UI does not reconstruct drafts from Hermes chat history.

### Meta Ads

The Meta Ads module is primarily a recommendation and decision surface.

During the recommendations phase it should show AI/agent recommendations derived from real campaign data, for example:

- keep watching;
- pause an underperforming ad;
- move budget;
- test a new creative;
- investigate a campaign anomaly.

Recommendations should include enough evidence to understand the suggestion and its confidence/rationale. Later, when action execution is enabled, the same recommendation can be bound to an approval and a TaskRail-governed action.

## Automations module

This module must list the TaskRail automation inventory dynamically. New managed automations should appear from TaskRail data rather than being manually hard-coded into Control Center.

Each automation row/card should expose true TaskRail state such as:

- enabled/disabled scheduling state;
- running/stopped/paused/failed state where applicable;
- health;
- last real execution time;
- last real execution result;
- next scheduled run if available;
- recent error indicator.

### Enable/disable control

The ON/OFF control must change TaskRail-owned scheduler/automation desired state through TaskRail commands. It must not directly edit systemd, cron, manifest files or provider configuration from the UI.

The visual toggle must distinguish desired state from transient runtime state. An automation can be enabled but currently idle, running, or failed.

### Run Now

The user does **not** want demo/test/fixture output in this surface.

`Run Now` means execute the real automation against its real configured production sources using the same governed execution path as a genuine invocation.

The resulting UI must show the genuine execution outcome and result evidence returned by TaskRail. A successful fake/self-test is not evidence that the automation is working against production data.

An automation that cannot safely support real ad-hoc execution must declare that capability unavailable instead of presenting a misleading Run Now button.

### Run All

A global **Run All** action may exist, but it is high-risk and must not simply fire every process simultaneously.

Required rules:

- only automations explicitly declaring safe real ad-hoc execution are eligible;
- production-data safety rules still apply;
- concurrency must be bounded by TaskRail;
- mutually conflicting or resource-heavy jobs must be serialized or excluded;
- any automation capable of an irreversible/high-impact side effect may require a separate confirmation or may be excluded from Run All;
- the batch result must show each genuine execution independently;
- one failure must not hide the results of other runs.

The UI should say exactly how many eligible automations will run before confirmation.

### Confirmation rules

Do not add confirmation friction to every routine action. Confirm bulk or consequential actions.

Examples requiring confirmation:

- Run All;
- bulk enable/disable;
- bulk dismiss/read;
- destructive or high-impact execution;
- any command whose downstream mutation policy explicitly requires it.

Confirmation text should name the action and count, e.g. `Dismiss 23 items`, rather than a generic `Yes`.

## Real execution results

An execution result should be a first-class TaskRail read model, not terminal text scraped into the UI.

Conceptually:

```ts
interface AutomationRunSummary {
  runId: string;
  automationId: string;
  startedAt: string;
  finishedAt?: string;
  trigger: 'schedule' | 'manual' | 'batch' | 'retry' | string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown_outcome';
  productionData: boolean;
  summary?: string;
  result?: unknown;
  error?: NormalizedError;
}
```

`productionData: true` is evidence from the governed run context, not a UI assumption.

## Logs module

Control Center should expose operational visibility without becoming a terminal emulator.

The logs view should support:

- TaskRail/platform logs;
- per-automation logs;
- run-specific logs;
- severity filters;
- automation/domain filters;
- time filtering;
- text search where practical;
- links from an error/intervention to relevant bounded logs.

Default view should emphasize structured errors, warnings and important lifecycle events. Raw verbose output can be available on drill-down when useful.

Never expose secrets, tokens, unrestricted credentials or unnecessarily sensitive business data in Control Center logs.

Errors requiring action should generate/attach to a Needs Me item rather than forcing the user to constantly watch the Logs tab.

## Priority and notification policy

All actionable recommendations/approvals/interventions should carry:

- `low`
- `normal`
- `high`
- `urgent`

Default notification behavior:

- **urgent**: external/user notification + visible in Control Center;
- **high**: external/user notification + visible in Control Center;
- **normal**: visible in Control Center only;
- **low**: visible in Control Center only.

The exact delivery transport may later be desktop/mobile push, system notification, sound or another adapter. Notification transport does not own the item state.

This policy should be configurable later, but the V1 default is deliberately quiet: only high and urgent should interrupt the user.

Informational platform notifications remain separate from actionable human-intervention objects.

## Read, dismiss and history behavior

Read/dismiss are presentation/workflow state changes, not deletion of TaskRail history.

Rules:

- `mark read` does not complete or approve an item;
- `dismiss` hides an item from the normal active view where policy permits;
- bulk `mark all read` and `dismiss all` require confirmation;
- approvals or mandatory decisions cannot be bypassed merely by marking them read;
- dismissing does not erase audit records, recommendations, executions or evidence.

### Default window: latest 50

Each high-volume module should load the newest **50** relevant records by default.

Older data remains in TaskRail/platform persistence but is not loaded/rendered until requested through `Load older`, cursor pagination or an explicit history view.

This rule applies to recommendation/history-style lists and should be adapted appropriately for active Needs Me queues. Active unresolved items must never be hidden merely because they fall outside a 50-item history window.

No client should download the full historical archive merely to render a module landing page.

## Recommendations versus approvals

A recommendation does not automatically mean human approval is required.

Example Meta Ads progression:

```text
real data collected
  -> deterministic/AI analysis
  -> recommendation stored
  -> Control Center displays it
  -> optional human decision
  -> later action/approval contract if execution is requested
```

When TaskRail can safely make a deterministic decision autonomously under policy, no Control Center intervention is needed.

When deterministic automation cannot decide, it may request intelligence from Hermes/specialists.

When AI also cannot safely take the consequential action autonomously, TaskRail creates an intervention/approval for the human.

That narrow escalation path is a central design rule.

## Hermes relationship

Hermes does not control the dashboard.

The preferred pattern is:

```text
automation/TaskRail detects ambiguity
  -> TaskRail creates IntelligenceRequest
  -> Hermes produces structured suggestions
  -> TaskRail validates/stores result
  -> Control Center displays it
  -> human decides if required
  -> TaskRail executes approved action
```

Control Center pulls/render TaskRail state. Hermes suggestions flow into TaskRail first.

## Performance

The dashboard must feel immediate even when intelligence work is slow.

- lightweight module lists read materialized TaskRail/platform state;
- interactive commands receive immediate accepted/rejected state from the service;
- real-time changes stream to the client;
- AI work runs asynchronously;
- large history is paginated;
- logs are bounded and queried on demand;
- modules should lazy-load domain-specific heavy views.

## Visual design

Visual quality is a product requirement, not decoration after implementation.

The interface should be something the user is willing to keep open every day. Requirements:

- clear information hierarchy;
- strong typography and spacing;
- calm default state rather than a wall of alerts;
- fast transitions and responsive feedback;
- consistent shared primitives without forcing every module into the same layout;
- polished empty/loading/error states;
- accessible focus, contrast and keyboard behavior;
- modular theme/design tokens so the visual language can evolve without rewriting domain logic.

Do not turn agent activity into decorative animation at the expense of useful information.

## V1 scope discipline

V1 should focus on the small set that already has a real operational purpose:

1. Needs Me;
2. Meta Ads recommendations;
3. WhatsApp/client communication approvals when implemented;
4. Automations inventory + enable/disable + genuine Run Now;
5. genuine execution result/history;
6. Logs/errors;
7. priority-driven notifications;
8. latest-50 pagination and safe bulk read/dismiss.

Future Marketing, Accounting and other modules should plug into this shell after the above is stable.

## Non-negotiable boundary

The correct mental model remains:

```text
TaskRail = engine + authoritative state + execution + policy
Control Center = modular human dashboard/read-and-command client
Hermes = intelligence on requested exceptions
Automations = deterministic workers
```

Control Center should become the convenient center point for understanding the agency and handling exceptions, while TaskRail remains the system doing the work.
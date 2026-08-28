# TaskRail Human Intervention Control Plane

Status: **architecture specification / first contract implementation started**  
Date: 2026-08-29  
Target: TaskRail 3.1-compatible architecture

## 1. Purpose

This document specifies the generic human-intervention layer required for SMG Control Center to become the primary human operating interface over TaskRail, while preserving TaskRail as the authoritative control plane.

The intended relationship is:

```text
SMG Control Center
    human UI only
        |
        | authenticated commands + real-time read model
        v
TaskRail platform service adapter
        |
        | stable TaskRail contracts
        v
TaskRail control plane
        |
        +-- deterministic automations
        +-- capabilities
        +-- Hermes / specialist intelligence requests
        +-- external systems
```

The governing rules are:

1. TaskRail owns authoritative workflow state.
2. Control Center renders and manipulates that state; it does not become a second control plane.
3. AI latency must never block the control plane.
4. Human intervention is generic and channel-neutral.
5. Consequential mutations are permissioned, idempotent, auditable and fail closed.
6. TaskRail core remains transport-neutral and does not gain a mandatory daemon, database or network listener.
7. A platform service adapter may provide the durable/networked runtime needed by an interactive client without making that runtime mandatory for ordinary TaskRail installations.

The detailed SMG Control Center module/UI requirements—including domain tabs, Automations controls, genuine Run Now behavior, Logs, priority-driven notifications, bulk confirmations and latest-50 pagination—are specified separately in `docs/architecture/control-center-dashboard-contract.md`. Those UI requirements consume the generic contracts defined here rather than adding SMG-specific behavior to TaskRail core.

## 2. Reconciliation with current TaskRail 3.1

### Already implemented

The current TaskRail platform surface already provides several foundations that should be extended rather than replaced:

- `PlatformEventBus`: bounded in-process event observation.
- `PlatformCommandGateway`: deterministic role authorization before command execution.
- `PlatformNotification`: channel-neutral notification records with acknowledge/resolve state.
- `PlatformSnapshot`: structured dashboard-facing automation state.
- platform roles: `viewer`, `operator`, `admin`.
- agent action authorization with read/write/control risk classes.
- short-lived agent grants scoped to explicit actions, sessions and nonces.
- framework primitives for state, idempotency, retry, timeout, bounded execution, structured logging and security controls.
- a documented platform-service boundary explicitly intended to host HTTP/SSE/WebSocket outside TaskRail core.

These are foundations, not a complete human-intervention system.

### Framework supports it, but integration is needed

- Platform event contracts can carry human-intervention domain events after additive versioned expansion.
- Platform command authorization can be generalized from automation controls to intervention actions.
- Agent grants can be extended from coarse action names to resource/capability scopes.
- Existing TaskRail state/idempotency/logging primitives can be reused by adapters and automation producers.
- The existing notification model can remain the non-actionable/operational notification primitive.
- The current platform-service architecture is the correct place for a Control Center API and real-time transport.

### New TaskRail feature required

TaskRail does not currently expose generic first-class objects for:

- Needs-Me / intervention items;
- approvals;
- draft sets and draft versions;
- action requests and execution attempts;
- intelligence requests to Hermes/specialists;
- durable cross-process event replay;
- full audit records tied to intervention/approval/execution lifecycle;
- domain-scoped permissions such as `communications.send` or `meta.ads.execute`;
- a durable platform-service implementation for interactive clients.

### New Control Center feature required

The current Control Center codebase is still primarily a Hermes visual/voice client. It requires:

- a TaskRail platform client;
- Needs-Me inbox;
- notification center;
- approval detail views;
- three-draft selection/edit/regenerate UX;
- execution progress/result UX;
- reconnect/catch-up behavior;
- TaskRail diagnostics/system-status views;
- agent activity views based on TaskRail state rather than decorative local state alone.

The Control Center implementation must also follow `control-center-dashboard-contract.md` so modules remain independent and future Marketing, Accounting and other agency areas can be added without redesigning the shell.

### Existing SMG patterns that must be generalized, not duplicated

SMG Automations already contains durable structured Hermes handoff patterns in Local SEO and deterministic queue/idempotency patterns in the unmerged client-renewal monitor. Those prove useful semantics but are automation-local implementations. The generic TaskRail layer should absorb the repeated infrastructure concepts while leaving domain policy in those automations.

## 3. Placement and package boundaries

### 3.1 TaskRail core

TaskRail core should own **contracts and deterministic domain logic**, not transport or SMG business policy.

Recommended public surface:

```text
taskrail/platform
```

Add the new human-intervention contracts to the existing platform namespace rather than creating a parallel control-plane namespace unless implementation review shows the public surface becomes too large. The platform namespace already owns dashboard/client contracts and real-time platform events.

Core responsibilities:

- domain types;
- validation;
- state-transition guards;
- command definitions;
- authorization contracts;
- idempotency contracts;
- audit-event schemas;
- event envelopes;
- adapter interfaces.

Core must not:

- open a listener;
- require SQLite/Postgres/Redis;
- call Hermes;
- send WhatsApp messages;
- contain SMG-specific workflow rules;
- store agency client data by itself.

### 3.2 Platform service adapter

A separate deployable service owns the interactive runtime.

Responsibilities:

- authentication and session handling;
- HTTP command/query endpoints;
- real-time SSE fanout;
- durable intervention state;
- durable event journal/replay;
- audit persistence;
- optimistic concurrency/version checks;
- rate limits;
- origin/CSRF controls where applicable;
- binding TaskRail `PlatformCommandGateway` to canonical executors;
- bridging intelligence requests to a Hermes worker/adapter;
- recovering subscribers after disconnect.

This is the place where an SMG deployment may choose storage and network details without imposing them on every TaskRail installation.

### 3.3 SMG Control Center

Control Center is a client of the platform service.

It may keep local ephemeral presentation state, but authoritative state comes from TaskRail.

Control Center must not directly:

- mark an approval complete without a TaskRail command;
- send an approved WhatsApp message bypassing TaskRail;
- edit campaign budgets bypassing TaskRail;
- reconstruct draft state from Hermes chat history;
- infer execution success from UI optimism alone.

The existing direct Hermes adapter may remain for conversational/voice interaction, but workflow operations should transition to:

```text
Control Center -> TaskRail -> intelligence request -> Hermes -> TaskRail -> Control Center
```

rather than:

```text
Control Center -> Hermes -> external mutation
```

## 4. Canonical domain objects

The first implementation slice now lives in `src/human-intervention.ts` and is exported through `taskrail/platform`. It deliberately contains only framework-generic contracts, validation and lifecycle guards; persistence and transport remain unimplemented.

All IDs below are opaque stable identifiers. Records should include a monotonically increasing `version` for optimistic concurrency.

### 4.1 InterventionItem (Needs-Me)

An actionable item requiring or inviting human attention.

```ts
interface InterventionItem {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  category: string;
  kind: 'attention' | 'approval' | 'draft_approval' | 'retry' | 'escalation';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'waiting' | 'completed' | 'dismissed' | 'cancelled';
  title: string;
  summary?: string;
  source: SourceReference;
  contextRefs: SourceReference[];
  approvalId?: string;
  draftSetId?: string;
  actionIds: string[];
  intelligenceRequestIds: string[];
  assignedTo?: ActorReference;
  dueAt?: string;
  tags?: string[];
  readAt?: string;
  dismissedAt?: string;
}
```

The InterventionItem is the inbox/read-model object. It must not duplicate the full immutable approval, draft or execution payload.

### 4.2 Notification

Notifications remain distinct from actionable intervention items.

Existing TaskRail notification semantics should remain compatible:

- `open`
- `acknowledged`
- `resolved`

An informational notification may optionally contain `interventionId` when an actionable object also exists, but notifications are never the authoritative approval object.

Default interruption policy for actionable items is intentionally quiet: `high` and `urgent` may trigger an external/user notification; `normal` and `low` remain visible in Control Center without interrupting the user. The helper `shouldNotifyPriority()` implements this default contract.

### 4.3 ApprovalRequest

A decision gate over a specific immutable proposed action/version.

```ts
interface ApprovalRequest {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired' | 'superseded';
  risk: 'low' | 'medium' | 'high' | 'critical';
  requestedBy: ActorReference;
  requestedActionId: string;
  actionPayloadHash: string;
  reason?: string;
  expiresAt?: string;
  decidedAt?: string;
  decidedBy?: ActorReference;
  decisionReason?: string;
}
```

Approval is bound to an action payload hash/version. Editing a consequential action after approval must invalidate/supersede that approval rather than silently reusing it.

Terminal approval states are immutable. The first contract slice includes explicit approval transition guards.

### 4.4 DraftSet and DraftOption

Drafts are immutable versioned artifacts.

```ts
interface DraftSet {
  id: string;
  workItemId: string;
  generation: number;
  version: number;
  status: 'generating' | 'ready' | 'failed' | 'superseded';
  createdAt: string;
  createdBy: ActorReference;
  contextRefs: SourceReference[];
  recommendedDraftId?: string;
  drafts: DraftOption[];
  requestId?: string;
}
```

Normal communication approval should request three meaningfully distinct options:

1. balanced/recommended;
2. concise/direct;
3. detailed/explanatory.

Regeneration creates a new DraftSet generation. Previous generations remain audit-visible and cannot be overwritten in place.

The first implementation slice validates ready draft sets, duplicate draft IDs and recommended-draft references and includes explicit lifecycle guards.

### 4.5 ActionRequest

Represents a requested consequential operation.

```ts
interface ActionRequest {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  type: string;
  status:
    | 'pending'
    | 'waiting_for_ai'
    | 'waiting_for_approval'
    | 'approved'
    | 'executing'
    | 'completed'
    | 'failed_retryable'
    | 'failed_permanent'
    | 'rejected'
    | 'cancelled';
  requestedBy: ActorReference;
  target: ResourceReference;
  payload: JsonValue;
  payloadHash: string;
  idempotencyKey: string;
  approvalId?: string;
  selectedDraft?: { draftSetId: string; draftId: string; generation: number };
  attemptCount: number;
  lastExecutionId?: string;
}
```

Every mutation action requires an idempotency key. A double-click, reconnect retry or duplicated event must not create duplicate side effects. The first implementation slice validates action identity/idempotency fields and implements lifecycle guards.

### 4.6 ExecutionAttempt

Execution history is append-only and includes an explicit `unknown_outcome` state for ambiguous transport failures where blind retry could duplicate a mutation.

For Control Center automation execution, a separate `AutomationRunSummary` read model records genuine real-run context including a `productionData` flag supplied by the governed execution path. Control Center must never infer production-data validity from successful test/demo output.

### 4.7 IntelligenceRequest

Hermes/specialist reasoning should be represented as durable requests rather than transient chat coupling.

The first implementation slice defines pending/running/completed/retryable/permanent/cancelled states and their allowed transitions. Structured results must be validated before persistence marks the request completed.

### 4.8 AuditRecord

Every consequential lifecycle change creates an audit record with actor, action, object, result and bounded metadata. Audit payloads must be minimized and redacted; secrets and unrestricted credentials are forbidden.

## 5. Actors, identity and permissions

Existing `viewer/operator/admin` roles remain useful for platform administration, but domain agents require scoped permissions. Prompts are not authorization boundaries.

Recommended permission names remain explicit namespaced actions such as:

```text
intervention.read
intervention.update
approval.decide
communication.draft.request
communication.whatsapp.send
communication.email.send
crm.client.read
crm.client.update
meta.ads.read
meta.ads.propose
meta.ads.execute
website.diagnose
website.deploy
seo.read
seo.propose
financial.read
financial.commit
```

The current contract slice defines generic actor/resource/source references. Scoped grant enforcement remains a later implementation phase after the base object/state contracts are reviewed.

## 6. Lifecycle and state-transition rules

Do not force notifications, approvals, AI requests and executions into one overloaded status enum.

The contract implementation currently provides fail-closed transition guards for:

- approval lifecycle;
- draft-set lifecycle;
- action lifecycle;
- intelligence-request lifecycle.

Terminal states cannot restart. Retryable action/intelligence failures may re-enter execution/running according to their explicit transition maps.

An InterventionItem may be marked completed only when its required decision/action has reached its appropriate terminal state. Dismissing an attention-only item is not equivalent to approving its linked action.

## 7. Event model

TaskRail's current `PlatformEventBus` remains an in-process observer. The human-intervention contract now defines generic durable-domain event names and a sequenced envelope for future persistence/replay adapters.

The future platform service must persist authoritative mutation + audit + outbox/event atomically before acknowledging consequential commands.

SSE remains the recommended V1 realtime transport for Control Center because commands can use authenticated HTTP while state changes primarily flow server-to-client. Reconnect must use ordered sequence/cursor replay rather than assuming the in-process event bus is durable.

## 8. Control Center list/history performance

`DEFAULT_CONTROL_CENTER_PAGE_SIZE` is 50, with a bounded maximum of 200 per request in the generic contract.

The 50-item default is a presentation/query window, not a retention/deletion policy. Older history remains server-side and loads only on request. Active unresolved Needs-Me items must never disappear merely because more than 50 historical records exist.

## 9. Storage boundary

TaskRail core gains no mandatory database.

The optional platform service may use SQLite/WAL for the initial SMG deployment if concurrency, crash recovery and atomic outbox behavior pass benchmark/recovery tests. If that gate fails, use an isolated Postgres database for the adapter. Do not reuse Twenty's database.

## 10. Existing SMG migration path

- Local SEO structured handoffs remain automation-local until the generic platform service exists; then map them into `IntelligenceRequest` and intervention objects rather than maintaining parallel human queues.
- Client renewal PR #64 retains its deterministic renewal policy/idempotency keys. Its internal escalations should eventually target InterventionItems/Needs Me rather than a separate Telegram approval path.
- WhatsApp transport remains later and provider-neutral. No WhatsApp code belongs in this first contract patch.

## 11. Implementation sequence

### Completed on this specification branch

1. Reconciled existing TaskRail platform/agent contracts with the desired architecture.
2. Documented generic human-intervention architecture.
3. Documented the SMG Control Center modular dashboard contract.
4. Added framework-generic `src/human-intervention.ts` types, validators and lifecycle guards.
5. Exported the contracts through `taskrail/platform`.
6. Added focused tests for lifecycle safety, priority notification defaults, bounded pagination, draft validation and action idempotency requirements.

### Next

1. Run/obtain repository CI and documentation/surface verification for the contract patch; fix any failures before expanding scope.
2. Add adapter interfaces for durable repositories/event journal and optimistic version checks.
3. Implement the optional platform service persistence layer with transactional audit/outbox semantics.
4. Add authenticated query/command API and SSE replay.
5. Connect Control Center read-only first.
6. Add Needs Me decisions and bulk read/dismiss with confirmation semantics in the UI.
7. Add Automations inventory, scheduler controls and genuine Run Now results.
8. Add Logs/error read model.
9. Wire durable intelligence requests to Hermes.
10. Only then integrate WhatsApp/client communications and executable Meta Ads approvals.

No production deployment should occur from this architecture branch until the contract/service/client phases pass their appropriate gates.

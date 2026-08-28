# TaskRail Human Intervention Control Plane

Status: **architecture specification / no runtime implementation yet**  
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

All IDs below are opaque stable identifiers. Records should include a monotonically increasing `version` for optimistic concurrency.

### 4.1 InterventionItem (Needs-Me)

An actionable item requiring or inviting human attention.

```ts
interface InterventionItem {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;

  category:
    | 'client'
    | 'approval'
    | 'payment'
    | 'system'
    | 'ads'
    | 'website'
    | 'seo'
    | 'sales'
    | 'other';

  kind:
    | 'attention'
    | 'approval'
    | 'draft_approval'
    | 'retry'
    | 'escalation';

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

interface DraftOption {
  id: string;
  label: 'recommended' | 'concise' | 'detailed' | 'alternative' | string;
  body: string;
  rationale?: string;
  metadata?: Record<string, JsonValue>;
}
```

Normal communication approval should request three meaningfully distinct options:

1. balanced/recommended;
2. concise/direct;
3. detailed/explanatory.

Regeneration creates a new DraftSet generation. Previous generations remain audit-visible and cannot be overwritten in place.

Editing a selected draft creates either:

- a new immutable custom DraftOption under the current generation; or
- a new DraftSet generation if the edit materially changes the intended action contract.

The implementation must choose one deterministic rule and test it. For V1, a new custom DraftOption under the current generation is preferred for simple text edits.

### 4.5 ActionRequest

Represents a requested consequential operation.

```ts
interface ActionRequest {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;

  type: string; // governed namespaced action, e.g. communications.whatsapp.send
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

Every mutation action requires an idempotency key. A double-click, reconnect retry or duplicated event must not create duplicate side effects.

### 4.6 ExecutionAttempt

Execution history is append-only.

```ts
interface ExecutionAttempt {
  id: string;
  actionId: string;
  attempt: number;
  startedAt: string;
  finishedAt?: string;

  executor: ActorReference;
  provider?: string;
  status: 'executing' | 'succeeded' | 'failed_retryable' | 'failed_permanent' | 'cancelled' | 'unknown_outcome';

  providerOperationId?: string;
  durationMs?: number;
  error?: NormalizedError;
  result?: JsonValue;
}
```

`unknown_outcome` is required for ambiguous transport failures where blindly retrying could duplicate a mutation. Such outcomes must reconcile before another send/mutation is attempted unless the provider guarantees idempotent replay.

### 4.7 IntelligenceRequest

Hermes/specialist reasoning should be represented as durable requests rather than transient chat coupling.

```ts
interface IntelligenceRequest {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;

  type: 'drafts' | 'analysis' | 'classification' | 'specialist';
  status: 'pending' | 'running' | 'completed' | 'failed_retryable' | 'failed_permanent' | 'cancelled';

  requestedBy: ActorReference;
  workItemId?: string;
  contextRefs: SourceReference[];
  input: JsonValue;
  expectedSchema: string;

  assignedAgent?: ActorReference;
  result?: JsonValue;
  error?: NormalizedError;
}
```

The system should validate structured Hermes results before accepting them as completed.

### 4.8 AuditRecord

Every consequential lifecycle change creates an audit record.

```ts
interface AuditRecord {
  id: string;
  at: string;
  actor: ActorReference;
  action: string;
  object: ResourceReference;
  requestId?: string;
  source?: SourceReference;
  reason?: string;
  approvalId?: string;
  result: 'accepted' | 'rejected' | 'succeeded' | 'failed';
  metadata?: Record<string, JsonValue>;
}
```

Audit payloads must be minimized and redacted. Secrets, access tokens and unrestricted raw credentials are forbidden.

## 5. Actors, identity and permissions

### 5.1 Actor model

```ts
type ActorKind = 'human' | 'agent' | 'automation' | 'system';

interface ActorReference {
  kind: ActorKind;
  id: string;
  displayName?: string;
}
```

Examples:

- `human:gurjyot`
- `agent:client-relations`
- `agent:paid-marketing`
- `automation:client-renewal-monitor`
- `system:taskrail-control-service`

### 5.2 Permission model

Existing `viewer/operator/admin` roles remain useful for platform administration, but domain agents require scoped permissions.

Recommended permission names are explicit namespaced actions:

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

Authorization is evaluated from:

```text
actor identity
+ active grant/policy
+ requested action
+ resource scope
+ approval requirements
+ environment
```

Prompts are not authorization boundaries.

### 5.3 Grant evolution

TaskRail's current short-lived `AgentGrant` should be evolved additively to support optional scopes such as:

```ts
resourceScopes?: string[];
constraints?: Record<string, JsonValue>;
```

Examples:

- Paid Marketing Agent may have `meta.ads.read` for all managed ad accounts and `meta.ads.propose`, but not `meta.ads.execute` without an approval-bound grant.
- Client Relations Agent may have `communication.whatsapp.send` only for approved/allowlisted client conversations and no Meta budget mutation permission.
- Developer Agent may have diagnostic read scopes broadly while deployment remains approval-bound.

## 6. Lifecycle and state-transition rules

### 6.1 No universal overloaded state machine

Different objects should have explicit state machines. Do not force notifications, approvals, AI requests and executions into one overloaded status enum.

### 6.2 Approval transitions

```text
pending -> approved
pending -> rejected
pending -> cancelled
pending -> expired
pending -> superseded
```

Terminal decisions are immutable.

### 6.3 Draft set transitions

```text
generating -> ready
generating -> failed
ready -> superseded
```

Regeneration creates a new generation; it does not reset the old row to `generating`.

### 6.4 Action transitions

```text
pending
  -> waiting_for_ai
  -> waiting_for_approval
  -> approved
  -> executing
  -> completed

waiting_for_approval -> rejected
any non-terminal -> cancelled
executing -> failed_retryable
executing -> failed_permanent
failed_retryable -> executing
```

Transitions must be validated centrally and covered by tests.

### 6.5 Intervention completion

An InterventionItem may be marked completed only when its required decision/action has reached its appropriate terminal state. Dismissing an attention-only item is not equivalent to approving its linked action.

## 7. Event model

### 7.1 Durable domain event envelope

The current `PlatformEventBus` remains an in-process observer. It must not become the sole real-time source because process restart would lose events.

The platform service should maintain a durable event journal with an envelope such as:

```ts
interface PlatformDomainEvent {
  apiVersion: string;
  id: string;
  sequence: number;
  at: string;
  kind: string;
  aggregate: ResourceReference;
  actor?: ActorReference;
  requestId?: string;
  data: Readonly<Record<string, JsonValue>>;
}
```

Example event kinds:

```text
intervention.created
intervention.updated
intervention.completed
approval.requested
approval.approved
approval.rejected
draft_set.requested
draft_set.ready
draft_set.failed
action.requested
action.authorized
action.started
action.completed
action.failed
intelligence.requested
intelligence.started
intelligence.completed
notification.created
notification.updated
agent.activity.updated
system.health.updated
```

### 7.2 Transactional event publication

Authoritative state mutation and event recording must be atomic from the platform-service perspective.

Do not implement:

```text
update state
then maybe publish event
```

where a crash between the two leaves subscribers permanently unaware.

Use one of:

- append-first event-sourced transaction with materialized state; or
- state transaction + durable outbox in the same storage transaction.

V1 should favor the simpler state + outbox model unless implementation testing shows event sourcing materially reduces complexity.

### 7.3 Real-time transport

For V1:

- **HTTPS commands/queries** for client -> TaskRail operations.
- **SSE** for TaskRail -> Control Center real-time updates.
- Control Center uses authenticated streaming fetch or another client capable of sending auth headers.
- reconnect resumes from the last acknowledged event sequence/id.
- the server replays missed events before switching to live delivery.

WebSocket is not required for V1. It should be introduced only if genuinely bidirectional streaming behavior needs it.

No 30/60-second polling loops should be used for interactive state propagation.

## 8. Persistence for the platform service

TaskRail core remains storage-neutral.

For the SMG platform-service deployment, the leading V1 storage choice is **SQLite in WAL mode**, subject to a pre-implementation runtime/concurrency/backup test.

Reasons:

- single VPS deployment;
- low operational overhead;
- transactional state + outbox support;
- suitable concurrency for this control-plane workload;
- simple backup/recovery;
- no Redis or separate queue required;
- no requirement to share or touch Twenty CRM's PostgreSQL.

SQLite is an adapter implementation detail, not a TaskRail core dependency.

Required tables are conceptually:

```text
interventions
notifications
approvals
draft_sets
draft_options
actions
execution_attempts
intelligence_requests
audit_records
domain_events
outbox
idempotency_records
actors
grants
```

If the concurrency/backup gate fails, use a dedicated PostgreSQL instance/schema owned by the platform service. Do not reuse Twenty's database.

## 9. Command and API contract

Exact URLs are adapter-specific, but the stable semantic operations should be defined first.

Suggested V1 HTTP mapping:

```text
GET  /v1/snapshot
GET  /v1/interventions
GET  /v1/interventions/:id
GET  /v1/notifications
GET  /v1/agents
GET  /v1/system/health
GET  /v1/events               # SSE

POST /v1/interventions/:id/dismiss
POST /v1/approvals/:id/approve
POST /v1/approvals/:id/reject
POST /v1/actions/:id/retry
POST /v1/draft-sets/:id/select
POST /v1/draft-sets/:id/edit
POST /v1/draft-sets/:id/regenerate
POST /v1/intelligence-requests
```

Every mutation request must include:

- authenticated actor identity;
- `requestId`;
- idempotency key where an external side effect may follow;
- expected object version (`If-Match` or equivalent) for conflict detection.

Conflicting stale writes return a typed conflict and the newest state; they do not silently overwrite.

## 10. Control Center interaction model

### 10.1 Startup

```text
open app
  -> authenticate platform session
  -> GET snapshot
  -> establish SSE stream from snapshot sequence
  -> render Needs-Me/notifications/status
```

### 10.2 Approve

```text
user presses Approve
  -> UI immediately enters local submitting state
  -> POST approval command with requestId + expectedVersion
  -> TaskRail authorizes and persists decision
  -> durable event recorded
  -> command response returns authoritative updated object
  -> execution may begin asynchronously
  -> SSE propagates execution updates
```

The button must not remain blocked waiting for Hermes reasoning.

### 10.3 Regenerate drafts

```text
user presses Regenerate
  -> TaskRail creates IntelligenceRequest + new DraftSet generation=generating
  -> command returns immediately
  -> Hermes worker processes asynchronously
  -> structured result validated
  -> DraftSet generation becomes ready
  -> SSE event updates Control Center
```

### 10.4 Optimistic UI

Control Center may optimistically show that a command was submitted, but must visually reconcile to authoritative TaskRail state. It must not show “sent” or “completed” before TaskRail records verified completion.

## 11. Hermes integration contract

Hermes is an intelligence provider, not the state store.

V1 semantic operations:

```text
requestDrafts()
requestAnalysis()
requestClassification()
requestSpecialist()
```

Each operation maps to a durable `IntelligenceRequest` and an expected output schema.

For `requestDrafts`, required structured output should contain:

- exactly three normal communication options unless the request explicitly calls for another count;
- distinct labels/tone intent;
- recommended option ID;
- body text;
- optional short rationale;
- no transport execution.

Hermes completion must include the TaskRail request ID/generation. A stale result for superseded generation N must not replace generation N+1.

Hermes outage behavior:

- intervention state remains available;
- pending intelligence requests remain durable;
- Control Center shows `WAITING_FOR_AI` / generating state;
- deterministic automations continue;
- retry policy classifies transport vs permanent/schema failures;
- no silent deletion of pending requests.

## 12. Communications boundary

The human-intervention core is channel-neutral.

A future communication action may target:

```text
communications.whatsapp.send
communications.email.send
communications.sms.send
communications.voice.call
communications.social_dm.send
```

A draft is not a WhatsApp object. It is communication content linked to context and a proposed action.

WhatsApp transport belongs in a governed capability/adapter layer after the generic intervention system is stable.

## 13. Migration path for existing SMG automation work

### 13.1 Client renewal monitor PR #64

Do not rewrite its renewal policy.

Keep:

- deterministic renewal stages;
- service-level idempotency keys;
- paid/cancelled/paused suppression;
- validation and pilot safety;
- provider-neutral send planning.

Future integration should change the sink:

```text
ESCALATE_INTERNAL
  from: Telegram/operations-only
  to: TaskRail InterventionItem(kind='escalation')
```

Routine deterministic reminders may remain direct automation -> approved communication template -> provider capability when policy permits.

Long-overdue or sensitive cases should create InterventionItems and, where communication is useful, an IntelligenceRequest that produces a three-option DraftSet.

The existing renewal event key should remain the business idempotency/source reference; do not generate a competing duplicate identity scheme.

### 13.2 Local SEO Hermes handoffs

The current Local SEO pending/completed handoff queue is a proven automation-local precursor.

Migration strategy:

1. Keep existing production behavior unchanged until generic TaskRail intelligence requests are stable.
2. Add an adapter that can emit the same Local SEO requests into TaskRail's generic `IntelligenceRequest` store.
3. Validate parity for task schemas, stale detection and completion semantics.
4. Only then retire duplicated local queue infrastructure if doing so reduces complexity without losing domain-specific validation.

## 14. Diagnostics

The platform service must expose actionable health, not decorative green dots.

Minimum health dimensions:

```text
platform_service
storage
real_time_stream
TaskRail core/CLI bridge
Hermes worker connection
pending intelligence requests
failed actions
retrying actions
open interventions
stale interventions
outbox backlog
oldest undelivered event
```

Control Center can aggregate these with existing automation health to show:

```text
TaskRail          Healthy
Hermes            Connected
Automations       17/17 Healthy
Needs Me          4
Failed actions    1
Retrying          0
AI requests       3 active
```

Health endpoints and diagnostics are read-only.

## 15. Logging and audit correlation

Structured operational logs should carry correlation IDs where available:

```text
request_id
event_id
intervention_id
approval_id
draft_set_id
action_id
execution_id
intelligence_request_id
agent_id
provider
duration_ms
error_class
```

Do not log:

- access tokens;
- secrets;
- raw credential material;
- full unbounded message history;
- unnecessary personal data.

## 16. Failure and retry semantics

Retry is a reliability mechanism, not a latency mechanism.

### Retryable examples

- temporary network failure;
- 429/rate limit with policy-compliant backoff;
- temporary provider 5xx;
- Hermes connection unavailable;
- transient CRM outage.

### Permanent examples

- invalid recipient;
- revoked/invalid credential after refresh has failed;
- unsupported action;
- permission denial;
- invalid provider template;
- schema-invalid AI output after bounded regeneration attempts.

### Ambiguous mutation outcome

Timeout after sending a mutation must become `unknown_outcome` when the provider cannot prove whether the operation occurred. Reconciliation is required before blind retry.

## 17. Security requirements

1. Platform service binds to a deliberately approved interface; do not casually expose a new public port.
2. Production remote access must use TLS and strong authenticated sessions.
3. Origin/CSRF controls apply to browser-like clients.
4. Mutation commands fail closed without authorization.
5. Approval decisions are bound to exact payload versions/hashes.
6. Agent grants are short-lived and scoped.
7. Provider credentials remain outside Git.
8. Audit records are append-only from ordinary client roles.
9. Rate limits protect mutation and AI-generation endpoints.
10. Sensitive context returned to Control Center is minimized by role and need.
11. No client can submit arbitrary shell commands through the platform adapter.
12. The platform adapter calls canonical TaskRail executors or governed capabilities.

## 18. Performance requirements

### Interactive control-plane target

The requirement is immediate propagation, not instantaneous AI.

Initial engineering targets for the single-VPS SMG deployment:

- local command authorization + durable state transition: p95 under 150 ms under normal load;
- command response acknowledging accepted state: p95 under 250 ms excluding external provider calls;
- committed event -> connected Control Center delivery: p95 under 250 ms under normal load;
- reconnect + replay for a normal short disconnect: under 2 seconds for the expected event backlog.

These are design targets, not claims. They must become measured tests before release.

AI operations have separate latency budgets and remain asynchronous.

## 19. Concurrency and idempotency requirements

Required tests include:

- double-click Approve produces one approval decision;
- two clients deciding the same approval produce one winner and one version conflict;
- duplicate HTTP retry with the same request/idempotency key does not execute twice;
- regenerated DraftSet generation N+1 cannot be overwritten by late generation N result;
- duplicated provider callback does not duplicate completion;
- service restart between state commit and client delivery still replays the event;
- service restart during `executing` preserves/reconciles action state;
- stale SSE client catches up from last event sequence.

## 20. Implementation phases

### Phase A — contract-only TaskRail change

Add and test:

- InterventionItem types/validation/transitions;
- ApprovalRequest types/transitions;
- DraftSet/DraftOption types;
- ActionRequest/ExecutionAttempt types/transitions;
- IntelligenceRequest types/transitions;
- Actor/resource/source references;
- permission names/scoped authorization contract;
- domain event envelope;
- additive platform event/command definitions;
- public exports;
- architecture/security documentation.

No network listener or storage dependency in core.

### Phase B — platform service adapter

Implement outside core:

- persistence adapter;
- SQLite WAL candidate and test adapter;
- state + outbox atomic transactions;
- authenticated query/command HTTP API;
- SSE replay/live stream;
- audit writer;
- idempotency store;
- health/diagnostics;
- canonical TaskRail command bridge.

### Phase C — Control Center read integration

Read-only first:

- TaskRail connection settings;
- snapshot;
- Needs-Me inbox;
- notification list;
- item details;
- system health;
- live SSE updates;
- reconnect/replay.

No mutation buttons until read path is stable.

### Phase D — Control Center decisions

Add:

- approve/reject;
- dismiss;
- retry;
- execution state;
- conflict handling;
- local optimistic submitting indicators;
- native notifications/badges only as secondary delivery surfaces.

### Phase E — Hermes intelligence requests

Add:

- request queue;
- Hermes worker bridge;
- schema validation;
- three-draft generation;
- regenerate;
- edit/select;
- stale-generation suppression;
- retry/failure classification.

### Phase F — migrate one existing workflow

Use a low-risk existing producer first. Recommended candidate: an internal escalation from client-renewal-monitor or another non-client-sending workflow.

Verify end-to-end:

```text
automation -> TaskRail InterventionItem -> Control Center -> decision -> TaskRail -> result
```

Only after this is stable should WhatsApp sending be introduced.

## 21. Acceptance gates before WhatsApp work

Do not begin production WhatsApp transport integration until all of these are demonstrated:

- durable Needs-Me persistence;
- real-time Control Center updates without polling;
- reconnect/replay;
- deterministic permission denial;
- approval version binding;
- audit trail;
- duplicate-click idempotency;
- execution retry/reconciliation semantics;
- Hermes draft generation stored in TaskRail;
- three-option selection flow;
- service restart recovery;
- diagnostics for failed/stale items;
- documented backup/recovery procedure;
- TaskRail repository checks and certification gates applicable to the changed public surface.

## 22. Explicit non-goals for the first implementation

- no WACli installation yet;
- no WhatsApp autonomous sending yet;
- no Meta campaign mutation through Control Center yet;
- no universal AI agent framework rewrite;
- no replacement of Twenty CRM;
- no Redis/Kafka/service mesh;
- no merging Control Center into TaskRail;
- no direct production edits;
- no forced migration of every existing automation-local queue at once;
- no decorative agent visualizations before useful state is available.

## 23. First code change after this specification is accepted

The first implementation branch should touch TaskRail core only at the contract/test layer:

```text
src/platform-contract.ts
src/public/platform.ts
test/platform-contract.test.ts
relevant documentation
```

The initial patch should add the new types, validation/state-transition guards and additive command/event contracts without adding persistence, HTTP, SSE, SQLite or SMG-specific code.

That keeps the first change small, reviewable and semver-conscious while establishing the stable contract required by both the platform service and Control Center.

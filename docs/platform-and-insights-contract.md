# TaskRail Platform and Insights contract

TaskRail core stays transport-neutral. A dashboard, mobile application, hosted subdomain, diagnostic intake service, or AI client must consume stable TaskRail contracts rather than bypassing the control plane.

## Three layers

1. **TaskRail core**
   - owns automation truth, validation, security, compatibility, execution guardrails, lifecycle events and authorization contracts;
   - exposes stable typed data through `taskrail/platform` and privacy-safe diagnostics through `taskrail/agent`;
   - does not open an HTTP/WebSocket listener and does not automatically transmit telemetry.

2. **Platform service adapter**
   - lives outside the core package and can expose HTTP, SSE, WebSocket or authenticated webhooks;
   - translates client requests into `PlatformCommandGateway` intents;
   - binds the gateway to the same canonical TaskRail control functions used by the CLI;
   - never executes arbitrary shell strings supplied by a client;
   - performs authentication, rate limiting, CSRF/origin controls where relevant, audit logging and transport security.

3. **Dashboard/client**
   - renders snapshots, events, notifications, test results and dependency information;
   - does not own automation state or bypass TaskRail gates;
   - can later be a web application, agency subdomain, desktop/mobile application or another client.

## Dashboard data contract

The platform namespace defines versioned structures for:

- automation state: running, stopped, paused, failed or unknown;
- automation health;
- category metadata;
- per-automation test totals, passed/failed/skipped counts and failed test IDs;
- component and capability inventory;
- framework counts;
- notifications and acknowledgement/resolution state;
- real-time platform events.

The dashboard should derive its UI from these structures rather than parsing human CLI text.

## Control contract

Supported control intents are deliberately small:

- `automation.start`
- `automation.stop`
- `automation.pause`
- `automation.resume`
- `automation.run`
- `scheduler.enable`
- `scheduler.disable`
- `notification.acknowledge`
- `notification.resolve`

Roles are deny-by-default:

- **viewer**: read-only;
- **operator**: normal automation controls and notification acknowledgement/resolution;
- **admin**: operator rights plus scheduler-level changes.

A client target must match TaskRail's bounded identifier contract. Shell metacharacter-shaped targets are rejected before they reach an executor.

`PlatformCommandGateway` authorizes an intent and calls a supplied canonical executor. Core deliberately does not invent an HTTP endpoint or platform-specific process manager for the intent. This prevents the dashboard from becoming a second control plane.

## Real-time updates

`PlatformEventBus` is an in-process observer contract. It is bounded by subscriber count and per-subscriber timeout. It does not listen on a port.

A future platform service can subscribe once and fan events out using:

- SSE for a simple web dashboard;
- WebSocket when bidirectional realtime behavior is materially useful;
- authenticated webhooks for external systems;
- local IPC/stdio for host-local tools.

Typical events include automation state/health changes, test completion, guardrail trips, security failures, deployment changes and notification changes.

## Runaway execution protection

`RunawayExecutionGuard` provides independent execution budgets for:

- maximum observed steps;
- maximum elapsed time;
- repeated state/fingerprint count;
- consecutive failure count.

A trip is sticky for the execution and produces a structured reason. `journalExecutionGuardTrip()` writes bounded operational metadata as private JSONL (`0600` on POSIX). It deliberately does not journal arbitrary business payloads or the repeated fingerprint value.

Existing TaskRail retention policy should prune old transient guardrail/health evidence while preserving important deployment and failure history according to policy.

## Notifications

The future dashboard should become the searchable operations view, while Telegram/email/etc. remain optional delivery channels.

The source notification record should be channel-neutral. Delivery adapters can subscribe to notification events, but acknowledgement/resolution belongs to TaskRail's platform-facing control contract so every client sees the same state.

## Privacy-safe Insights/error intake

TaskRail core still does not transmit telemetry automatically.

`createDiagnosticSubmissionEnvelope()` prepares a batch only when `explicitOptIn: true`. It:

- revalidates every diagnostic report against the privacy schema;
- limits batch size;
- hashes a local installation identifier into a pseudonymous installation key;
- includes no repository credential, upload token or maintainer secret;
- marks automatic submission as false.

A future intake service should accept these envelopes and then create/deduplicate issues in a **private maintainer-owned diagnostics repository**. End-user TaskRail installations must never receive GitHub credentials for that repository.

Recommended intake path:

```text
TaskRail installation
  -> local diagnostic preview
  -> explicit opt-in
  -> privacy validation
  -> authenticated/rate-limited intake service
  -> second server-side privacy validation
  -> fingerprint grouping
  -> private diagnostics repository / Sentinel triage
```

The intake service should store only the minimized report required to reproduce framework-level failures. It should reject unexpected fields, oversized payloads, secrets, filesystem paths, user identity, raw prompts and automation business data.

## Compatibility rule

The platform contract is a public API. Changes to existing stable fields or commands follow TaskRail backward-compatibility rules. Additive changes may evolve within a compatible release; removal or incompatible meaning changes require the appropriate major-version transition and migration guidance.

# Agent execution contract

TaskRail centralizes operational reliability. Automations and agents own domain decisions.

## Rules

- Each workload keeps isolated state under `/opt/smg-automations/state/<service-name>`.
- Do not share domain memory between unrelated agents.
- Every external side effect that may be retried must use an idempotency key.
- Decision journals contain concise metadata only. Never store secrets, credentials, full request bodies, or raw customer data.
- systemd remains the scheduler and process supervisor. TaskRail does not add a daemon or global execution lock.
- Separate services run in parallel. Internal fan-out must use bounded concurrency.
- Resource ceilings are guardrails, not reservations: a workload may use less CPU/memory, but cannot run away beyond its configured limit.
- Ordinary jobs get heartbeat tracking at the systemd boundary. Domain code does not need to import TaskRail merely for health tracking.
- Agents may use `LocalStateStore`, `IdempotencyStore`, decision records, retry, timeout, and concurrency helpers only when their domain needs them.
- Supervisors are read-only observers. They never make business decisions for an agent.
- `staleAfterMs` represents the expected maximum gap between successful executions. Set it per service when schedules differ.

## Default SMG policy

Timer jobs default to a 26-hour freshness window. Long-running services default to 15 minutes. Override `serviceManager.units[].staleAfterMs` for hourly, weekly, or other schedules.

Default execution limits are 5 minutes per run, four-way internal concurrency, three retry attempts with bounded exponential backoff and jitter, 512 MB memory, 100% of one CPU, 64 tasks, and nice level 5.

## VPS integration

After installing/upgrading TaskRail, run from the SMG automation workspace:

```sh
sudo taskrail-systemd-sync --all --apply
taskrail-supervise
```

The sync command installs TaskRail-owned systemd drop-ins for managed service units and performs `daemon-reload`. It does not change an automation's business command.

A newly instrumented service reports `missing` until it has executed at least once. Run the normal service/test path once during migration, then verify with `taskrail-supervise`.

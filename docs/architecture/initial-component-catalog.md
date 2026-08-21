# Initial TaskRail Component Catalog

Status: proposed baseline

The catalog is intentionally small. A component is TaskRail-owned and versioned; agents consume it but cannot add components from automation repositories.

## Tier 1 — ship first

These solve repeated infrastructure concerns across almost every automation and can remain lightweight.

### `execution`

Purpose: create stable execution context and identifiers.

Public concerns:
- execution ID
- automation identity
- start timestamp
- state root

Existing TaskRail code already implements most of this in `src/execution.ts`; implementation should expose it through the public component surface rather than duplicate it.

### `state`

Purpose: isolated local key/value state for one automation.

Contract:
- namespaced get/set/delete
- atomic writes
- no cross-automation shared memory
- corruption fails loudly

Existing `LocalStateStore` should become the underlying implementation.

### `idempotency`

Purpose: make side-effecting operations safe to retry and safe under parallel starts.

Contract:
- atomic claim
- release on failed operation
- stable scope/key semantics
- `runIdempotent` helper

Existing `IdempotencyStore` and `runIdempotent` should become the underlying implementation.

### `retry`

Purpose: bounded retries for transient work.

Contract:
- max attempts
- exponential backoff
- bounded delay
- jitter
- caller-provided retry predicate

Existing `withRetry` should be the implementation base.

### `timeout`

Purpose: hard upper bound for asynchronous operations.

Contract:
- AbortSignal to cooperative operations
- rejection even when operation ignores abort
- deterministic validation of timeout values

Existing `withTimeout` should be the implementation base.

### `concurrency`

Purpose: bounded parallelism without a central queue.

Contract:
- fixed maximum concurrency
- input order preserved in result
- no global process lock

Existing `mapConcurrent` should be the implementation base.

### `http`

Purpose: safe generic HTTP for capabilities and automations.

Contract:
- built on Node `fetch`
- timeout support
- optional retry policy
- JSON/text response helpers
- explicit status handling
- bounded response size where practical
- redacted logging hooks
- caller owns authentication headers

Why core: virtually every service capability needs HTTP; centralizing error/timeout/retry behavior prevents each capability from inventing its own networking layer.

What it must NOT become: a service-specific API client.

### `config`

Purpose: deterministic typed access to configuration and environment values.

Contract:
- required/optional env lookup
- simple parsing for string/number/boolean/JSON
- fail-fast missing configuration
- never print secret values

Why core: configuration behavior should be consistent across every runtime-facing Node capability/automation.

### `log`

Purpose: structured, consistent automation logs.

Contract:
- debug/info/warn/error
- execution ID + automation scope enrichment
- JSON output
- safe metadata
- key-based redaction utility

Why core: operational troubleshooting and AI-generated code both improve when logging is uniform.

### `fs-safe`

Purpose: safe small-file persistence primitives.

Contract:
- atomic write
- JSON read/write
- append JSONL
- private file mode by default for state artifacts
- mkdir parents

Why core: TaskRail already relies on atomic local state; exposing the same safe primitive prevents ad-hoc file writes in agents.

## Tier 2 — consider only after real demand

These are useful but should not be added until at least two unrelated workloads need them.

- `process`: bounded subprocess execution with captured output and timeout
- `lock`: scoped local file lock for rare non-idempotency coordination cases
- `cache`: TTL local cache
- `stream`: bounded streaming helpers
- `schema`: lightweight runtime object validation
- `metrics`: local counters/timings export format

## Explicitly NOT components

These belong in capabilities because they are service/integration specific:

- Telegram sending
- Slack sending
- Gmail
- WordPress publishing
- Meta API
- Google Ads
- Google Business Profile
- OpenAI/Anthropic/model calls
- databases or SaaS clients

These remain automation/domain logic:

- SEO topic selection
- ad-budget decisions
- content strategy
- lead qualification
- campaign optimization
- social post planning

These remain TaskRail core/control-plane behavior rather than callable components:

- deploy
- rollback
- doctor/gate/plan/ship
- systemd synchronization
- fleet supervision
- manifest compatibility

## Public surface rule

Tier 1 should be exported through one stable namespace. Internal source files stay private.

Conceptual API:

```ts
import {
  execution,
  state,
  idempotency,
  retry,
  timeout,
  concurrency,
  http,
  config,
  log,
  fsSafe,
} from '@taskrail/components';
```

Tree-shakability is not required, but imports must have near-zero side effects and no background startup.

## Performance budget

- zero daemon/background worker
- zero network work on import
- zero capability-registry scan on normal component calls
- no mandatory external dependency for Tier 1
- component initialization should be synchronous or trivial where possible
- filesystem work is local and scoped

## Component stability policy

Once published:

- behavior is covered by contract tests
- parameters/results are typed
- error semantics are documented
- additive changes are preferred
- breaking changes require a major TaskRail version
- deprecated APIs remain functional through a documented migration window

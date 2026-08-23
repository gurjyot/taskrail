# Fast Automation Authoring Architecture

## North star

TaskRail exists to make production automations fast to create and robust to operate.

The common automation authoring path should require business logic plus only the information TaskRail cannot safely infer. Repeated operational details belong to TaskRail profiles and runtime conventions, not individual automation manifests.

## Target author experience

For a normal automation, the author should be able to start with a manifest approximately this small:

```json
{
  "name": "example-report",
  "profile": "smg-node-timer@1",
  "capabilities": ["telegram-bot"]
}
```

Business-specific declarations such as required shared files, environment requirements, unusual health checks, database migrations or nonstandard resource limits remain explicit when needed.

The author should not normally have to repeat:

- runtime when the profile determines it
- managed mode
- source/deploy layout
- standard validation command
- standard test command
- standard health command
- required validation/test/health gates
- systemd service/timer naming
- deployment strategy
- rollback/retention defaults
- runtime resource defaults
- generated/runtime path exclusions

## Conventions

TaskRail profiles own a conventional project layout.

### Node

- entrypoint: `src/main.js`
- tests: `tests/*.test.js`
- validation: `node --check src/main.js`
- test: `node --test tests/*.test.js`
- default process health: entrypoint syntax validation

### Shell

- entrypoint: `src/main.sh`
- tests: `tests/self-test.sh`
- validation: `bash -n src/main.sh`
- test: `bash tests/self-test.sh`
- default process health: entrypoint syntax validation

### PHP

- entrypoint: `src/main.php`
- tests: `tests/self-test.php`
- validation: `php -l src/main.php`
- test: `php tests/self-test.php`
- default process health: entrypoint syntax validation

A nonstandard automation may override these conventions explicitly. The override path must stay possible, but it is not the default authoring path.

## Separation of responsibilities

### Automation author owns

- business logic
- domain-specific tests
- capabilities/integrations actually consumed
- unusual configuration or runtime requirements
- explicit exceptions to the profile conventions

### TaskRail owns

- standard project/runtime conventions
- validation/test/health defaults
- deployment staging and activation
- production runtime-context verification
- systemd integration supplied by the profile
- retries, timeouts and resource policy defaults
- release snapshots and rollback
- drift classification
- compatibility checks
- production certification machinery
- diagnostics and operational guardrails

## Development mode vs production mode

The local development loop must remain short:

```text
implement -> test -> check
```

Production remains strict:

```text
doctor -> check -> test -> plan -> ship -> runtime verification -> health
```

Strict production certification must not force additional boilerplate into every automation. The framework performs the extra work.

## Migration policy

TaskRail is still early and the production fleet is small. Prefer one coordinated migration to the clean convention over carrying permanent compatibility branches for accidental early layouts.

Migration should:

1. make the framework understand the thin manifest;
2. update the scaffold to generate only the thin contract;
3. migrate the current SMG production automations to conventional layouts where practical;
4. migrate the first-party automation library;
5. run framework, ecosystem and real production certification;
6. remove transitional compatibility code once the coordinated migration is complete.

## Acceptance criteria

The simplification phase is successful only if all of the following become true:

- a normal new automation manifest is materially smaller;
- a normal scaffold contains fewer author-maintained files/fields;
- the local edit-test loop is no slower than before;
- production checks remain fail-closed;
- systemd runtime-context failures are still detected before a ship is considered successful;
- framework upgrades do not require repetitive edits to every automation unless the business contract changes;
- the next real automation can be built with fewer manual decisions and less repeated infrastructure code than the current fleet.

## Design rule

Before adding a TaskRail feature, ask:

> Does this reduce repeated work for future automations or strengthen production execution without increasing normal authoring complexity?

If not, keep it outside the core.

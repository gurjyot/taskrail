# TaskRail Component + Capability Market Review

Status: architecture input, not implementation
Date: 2026-08-21

## Goal

Make TaskRail fast and predictable for AI-built automations by separating stable platform primitives from reusable integration/domain functionality.

## Market patterns reviewed

### Laravel

Laravel exposes stable framework services through contracts and resolves implementations centrally. The useful lesson for TaskRail is not a full service container; it is the discipline of a small public contract surface with replaceable internals and stable names.

TaskRail implication: components are versioned platform contracts. Automations and capabilities depend on contracts, not TaskRail internals.

### WordPress

WordPress combines stable core APIs with explicit extension points (actions and filters). Plugins reuse core APIs rather than rebuilding HTTP, configuration, filesystem, scheduling, or lifecycle primitives.

TaskRail implication: provide a small stable component API and lifecycle extension points. Do not make agents patch core behavior or invent infrastructure helpers inside automations.

### Apache Airflow

Airflow separates Connections (configuration/credentials), Hooks (reusable external-system communication), and Operators (task logic). Its own guidance recommends putting external-service communication in reusable Hooks rather than duplicating it across Operators.

TaskRail implication: platform connection/secrets/config primitives belong in components; service-specific integrations belong in capabilities; automation-specific decisions remain local.

### n8n

n8n separates workflow composition, reusable nodes, credentials, and execution history. It also provides a generic HTTP fallback when a dedicated node does not cover an operation.

TaskRail implication: capabilities should expose focused operations while a safe generic HTTP component prevents capability explosion for one-off API endpoints.

## Resulting TaskRail layers

1. **Core** — lifecycle, deployment, validation, supervision, compatibility.
2. **Components** — fixed TaskRail-owned technical primitives. Agents may consume but never create them.
3. **Capabilities** — governed reusable integrations/features. Agents may create them when no equivalent exists.
4. **Automations / agents** — domain decisions and orchestration.

Dependency direction is one-way:

`automation -> capability -> component -> core`

Also allowed: `automation -> component` for generic technical needs.

Forbidden:

- core depending on a capability
- component depending on a capability
- component depending on an automation
- capability depending on an automation
- cross-domain shared memory

## Design principles extracted from mature systems

- Stable public interfaces, replaceable internals.
- Reuse before extension.
- Declarative metadata for discovery.
- Credentials/configuration separated from business logic.
- Generic fallback primitives to avoid integration explosion.
- Progressive disclosure: discovery metadata stays tiny; detailed docs load only when relevant.
- Explicit lifecycle hooks rather than patching core behavior.
- Deterministic validation and conformance tests for extension contracts.
- Versioned public surface with compatibility within a major line.

## What TaskRail should deliberately NOT copy

- WordPress-style global mutable state.
- A large plugin runtime loaded into every execution.
- Laravel-scale dependency injection/container complexity.
- Airflow's database/scheduler/worker architecture.
- n8n's central workflow execution engine.
- Semantic/vector infrastructure in the runtime hot path.

## Architecture conclusion

TaskRail should become an **AI-first automation SDK + control plane**, not a central automation runtime.

Components should be deliberately small, deterministic, dependency-light, locally callable, and maintained only by TaskRail releases. Capabilities should remain the growing ecosystem layer, but creation must pass a registry governance check that prevents semantic duplication.

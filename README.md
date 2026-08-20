# Lightweight Automation Framework v1

Tiny TypeScript/Node.js framework for building and safely operating automations.

Core ideas:
- CLI first.
- Small core, optional adapters.
- Validate before deploy.
- Backup before replace.
- Health check after deploy.
- Roll back on failure.
- Keep agent instructions local to each managed project.

This repo is the public framework shell. It does not include organization-specific logic.

## Lifecycle

`create -> check -> test -> build -> deploy -> verify -> run`

## v1 scope

- manifest
- project layout
- lifecycle
- config contract
- structured logging
- validation
- plugin interface
- CLI
- templates
- health-check contract
- safe deployment
- backup
- rollback
- `AGENTS.md` contract

## Excluded from v1

- Redis
- PostgreSQL
- Docker
- queue runtime
- daemon runtime
- dashboard
- AI framework
- org-specific adapters

## Commands

- `laf init`
- `laf check`
- `laf test`
- `laf build`
- `laf deploy`
- `laf verify`
- `laf run`
- `laf rollback`

## Suggested repo name

`lightweight-automation-framework`

# Architecture

## Layers

- `core`: types, lifecycle, validation, logging, deployment contracts
- `cli`: command surface and enforcement
- `templates`: starter project shapes
- `adapters`: optional integrations

## Proposed workspace shape

- `packages/core`
- `packages/cli`
- `templates/base`
- `templates/systemd`
- `docs/`

## Contract

Managed projects keep a local `AGENTS.md` and an `automation.json` manifest.
The framework uses that manifest to decide how to validate, build, deploy, and verify.

## v1 flow

`doctor -> source change -> gate -> verify-change -> plan -> deploy -> health`

Deployment is always:

`validate -> test -> build candidate -> backup -> atomic deploy -> health check -> keep OR rollback`

## Notes

- Core stays generic.
- SMG-specific modules belong outside the public core.
- Other frameworks can sit inside an automation later.

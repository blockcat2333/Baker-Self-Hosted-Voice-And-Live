# Decisions

## M1 Service Boundary Decision

Decision:

- keep `apps/api`, `apps/gateway`, and `apps/media` separate from the start

Why:

- prevents durable CRUD, realtime routing, and media orchestration from collapsing into one service

Alternatives rejected:

- one backend app for everything
- deeper microservice split in M1

Impact:

- clearer boundaries now
- slightly more workspace/setup overhead

Reference:

- `docs/adr/0001-service-boundaries.md`

## M1 Validation Baseline Decision

Decision:

- M1 is only accepted when `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass

Why:

- later milestones depend on a stable baseline
- type-only or test-only acceptance would hide integration issues

Alternatives rejected:

- postponing type issues to M2
- weakening lint or test requirements

Impact:

- slightly more dependency setup in M1
- much lower risk of dragging broken scaffolding into feature work

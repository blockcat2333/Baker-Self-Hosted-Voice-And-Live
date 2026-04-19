# ADR 0001: Initial Service Boundaries

## Status

Accepted

## Context

The product needs text chat, realtime state, voice, and room livestreaming, but first release scope is mid-scale and engineering-readability-first. We do not want to bind product logic to any single SFU or overload the HTTP API with realtime concerns.

## Decision

Use three backend apps from the start:

- `apps/api`
- `apps/gateway`
- `apps/media`

Use shared packages for:

- protocol
- sdk
- client
- shared utilities
- database schema

## Consequences

Positive:

- REST and WebSocket responsibilities stay clear
- media backend can change without rewriting guild/message services
- Web and Desktop share one app package

Negative:

- more workspace packages to maintain from day one
- a bit more setup complexity in M1

## Rejected Alternatives

- Single backend app for everything
  This would make M3/M4 refactors more expensive and blur product logic with media logic.

- Deep microservice split from the first milestone
  This is unnecessary for current scale and team size.

# Baker Architecture Overview

## Service Layout

`Milestone 1` uses a small-service monorepo, but not premature microservices.

- `apps/api` owns durable business APIs and PostgreSQL-backed workflows.
- `apps/gateway` owns realtime WebSocket connection management and event routing.
- `apps/media` owns media control-plane boundaries and future SFU integration points.
- `apps/web` and `apps/desktop` both consume `packages/client`.

## Layer Boundaries

### Client Layer

- React rendering
- app shell state
- future device control and WebRTC session managers
- no raw SDP or ICE logic in UI components

### Gateway / Realtime Layer

- WebSocket lifecycle
- future auth on socket upgrade
- event fanout
- future presence, typing, room state, and media signaling routing

### Application Layer

- currently represented by `apps/api` boundary
- future auth, guild, channel, message, membership, and permission flows

### Media Adapter Layer

- currently `NoopMediaAdapter`
- future abstraction point for `mediasoup` or another SFU
- must stay separate from guild/message business rules

### Data Layer

- PostgreSQL for durable state through `packages/db`
- Redis for ephemeral state and fanout coordination in later milestones

## Why This Layout

- It keeps chat/product business logic independent from media runtime choices.
- It keeps Web and Desktop on one UI stack.
- It prevents protocol drift by forcing shared contracts into `packages/protocol`.
- It keeps M1 small while preserving the shape required for M2-M6.

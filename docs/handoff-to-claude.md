# Handoff To Claude Code

## What This Project Builds

Baker is a Discord-like realtime communication product with:

- text chat
- low-latency voice channels
- low-latency room livestream / screen share
- Web client
- Windows desktop client
- backend services and deployment infrastructure

## Why The Repository Is Layered This Way

The repository keeps durable CRUD, realtime state, and media orchestration separate:

- `apps/api` owns durable business workflows and PostgreSQL writes
- `apps/gateway` owns realtime connections, presence, room state, and signaling relay
- `apps/media` owns the media adapter boundary
- `packages/protocol` prevents DTO/event drift
- `packages/db` keeps schema/repository logic out of service code

That layering matters even more now that voice and room streaming are implemented. Realtime state can evolve without pushing media/browser logic into the API, and future SFU work can stay behind `apps/media`.

## Current Code Status

What exists today:

- auth + text chat HTTP flows
- gateway auth, presence, message push, voice, and room stream signaling
- stream session schema and repository
- shared Web/Desktop client shell
- web auth/chat/voice/stream integration
- media session bootstrap endpoint returning ICE config

What does not exist yet:

- real SFU/media backend
- recording/replay
- CDN/HLS distribution
- multi-broadcaster streams
- mobile-specific stream behavior

## Most Recent Completed Stages

### Milestone 3 Voice MVP

What landed:

- gateway voice room runtime and signaling relay
- media session bootstrap path
- shared WebRTC manager
- client voice store and sidebar panel
- working remote audio playback and local speaking indicator

### Milestone 4 Room Livestream / Screen Share MVP

What landed:

- stream protocol contracts and stream-specific error codes
- `stream_sessions` repository wiring
- gateway `StreamRoomManager`
- `stream.start`, `stream.stop`, `stream.watch`, `stream.unwatch`
- authoritative `stream.state.updated` snapshot flow
- relay validation for both voice and stream session modes
- `WebRtcManager.handleRecvOnlyOffer()` for viewers
- client `stream-store` with capture-first host flow and recv-only viewer flow
- `StreamPanel` plus `ChatShell` / `ChannelList` / `gateway-store` integration

Important locked behavior that is now implemented:

- host capture happens before `stream.start`
- `stream.state.updated` is authoritative for room stream state
- stream teardown is idempotent on the client
- `media.signal.*` relay is validated against active voice or stream session membership

## Current Most Important TODO

The next task is not a new feature milestone. The next task is hardening.

Recommended scope:

- manual browser validation for M4
- TURN / media-adapter hardening
- reconnect, disconnect, and UX polish around voice + stream
- Desktop/Electron validation

## Placeholder Implementations

These still exist and should not be mistaken for production-ready media:

- `apps/media` uses `NoopMediaAdapter`
- voice and stream rooms are in-memory only
- stream viewing is P2P and intended for small rooms only

## High-Probability Future Refactors

- real media adapter behind `apps/media`
- Redis-backed room registries for multi-instance deployments
- richer user display data in voice/stream participant UI
- explicit guild/channel creation flows replacing starter-workspace onboarding

## Boundaries That Must Still Be Respected

- keep `packages/protocol` as the single source of truth
- keep durable writes in `apps/api`
- keep realtime connection logic and signaling in `apps/gateway`
- keep browser capture/WebRTC logic in the client/sdk layer
- keep media-adapter concerns behind `apps/media`
- do not expand into recording, replay, CDN/HLS, multi-broadcaster rooms, typing, read receipts, notifications, offline sync, upload, search, or complex permissions unless explicitly requested

## Important Reality Check

Older docs in this repo described pre-M3 or pre-M4 states. Treat this handoff set plus `CLAUDE.md`, `docs/current-status.md`, and `docs/repo-state-summary.md` as the current source of truth.

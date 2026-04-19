# Baker Project Overview

## Goal

Baker is a Discord-like realtime social communication product. The target scope is:

- text chat
- low-latency voice channels
- low-latency room livestream / screen share
- Web client
- Windows desktop client
- backend services and deployment infrastructure
- server-side administrative control plane

## Current Milestone

Current milestone: `Milestone 5` stability, quality, and deployment hardening after the Milestone 4 multi-stream redesign, with revised stability/UX scope complete (per-user voice link quality fanout, non-joined voice roster visibility, bitrate+1440p stream quality, auth/bootstrap and gateway reconnect hardening, startup-script governance) plus follow-up security fixes for media-internal auth, session-backed token validation, logout revocation, browser-storage hardening, and a smoke-tested Docker Compose self-hosted deployment path that now uses a canonical self-contained `baker` runtime image with Docker-Desktop-friendly default host ports.

Current validated state:

- `Milestone 1` complete
- `Milestone 2` complete
- `Milestone 3` complete
- `Milestone 4` redesign complete
- `Milestone 5` slice 1 complete
- `Milestone 5` slice 2 complete
- `Milestone 5` slice 3 complete
- Phase 1 stability cleanup complete
- Phase 2 slice 1 account/profile UX complete
- Phase 2 slice 2 voice/audio controls complete
- Phase 2 slice 3 stream audio/controls complete
- livestream quality controls for resolution/frame-rate/bitrate and best-effort codec selection complete
- server control panel baseline complete
- revised M5 stability/UX slice complete (server RTT/roster visibility/bitrate/auth recovery/startup governance)
- revised M5.2 slice complete (per-user voice network snapshots, close/handshake reconnect hardening, voice/stream layout fixes)
- self-hosted Docker Compose baseline complete
- prebuilt-image Docker Compose quick-start complete
- protocol compatibility, gateway runtime, stream-session repository, client-state migration, and gallery UI stages are complete
- `pnpm typecheck` passes
- `pnpm lint` passes
- `pnpm test` passes
- `pnpm audit --prod` passes
- `docker compose --project-name baker-smoke -f docker-compose.yml -f docker-compose.build.yml up -d --build` self-hosted smoke test passes with healthy `api`, `gateway`, `media`, and `proxy`, plus working `http://localhost:3000` (Web) and `http://localhost:3001` (Admin) entrypoints
- public-facing repo docs now include an English-first `README.md`, a linked `README.zh-CN.md`, plus baseline contribution, security, conduct, and issue/PR templates

## Tech Stack

- Monorepo: `pnpm workspace` + `turbo`
- Language: TypeScript with `strict`
- Web: React + Vite
- Desktop: Electron + React
- API: Fastify
- Realtime gateway: Fastify WebSocket
- Self-hosted runtime: Docker Compose + Caddy
- Data: PostgreSQL + Redis
- Schema: Drizzle ORM
- Validation / protocol schema: Zod
- Tests: Vitest

## Repository Structure

- `apps/api`: durable HTTP API boundary
- `apps/gateway`: realtime WebSocket boundary
- `apps/media`: media control-plane placeholder and adapter boundary
- `apps/web`: end-user browser app
- `apps/admin`: server control panel browser app
- `apps/desktop`: Electron shell
- `packages/client`: shared React UI/app shell
- `packages/protocol`: shared DTO / WS / signaling contracts
- `packages/sdk`: client transport wrappers and WebRTC helpers
- `packages/shared`: env/logger/result helpers
- `packages/db`: DB client, schema, and repositories
- `docker`: self-hosted proxy configuration
- `docs`: architecture, history, status, decisions
- root collaboration docs: `README.md`, `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `.github/*`, `.env.selfhost.example`, `Dockerfile`, `docker-compose.yml`, `docker-compose.build.yml`

## Module Responsibilities

- REST handles durable CRUD, public config, and admin control-plane APIs.
- WebSocket handles realtime events, room state fanout, and signaling relay.
- Browser capture and WebRTC peer logic live in the client/sdk layer.
- Media adapter and future SFU work stay behind `apps/media`.
- The admin panel manages durable server/workspace settings, not realtime room orchestration.
- Docker Compose packages the default self-hosted topology, with a canonical self-contained published `baker` runtime image for bootstrap/migration/API/gateway/media, local source-build overrides for contributors, and Caddy as the public edge for web/admin/API/gateway routes.

## Real Runtime Scope

Implemented today:

- auth + chat HTTP flows
- authenticated username update through `PATCH /v1/auth/me`
- public server-config fetch for login/client gating
- admin HTTP control-plane routes for settings, managed account creation, and managed channel creation/update
- authenticated logout with durable session + refresh-token revocation
- gateway auth, presence, message push, voice, and room stream signaling
- multi-stream gateway runtime keyed by `streamId`
- `stream_sessions` schema and multi-stream repository query contract
- `server_settings` schema and repository for singleton server configuration
- client multi-stream stream-store with owned publish state + watched streams keyed by `streamId`
- watched livestream viewing through real browser popup windows while the main window retains runtime ownership
- watched livestream popup viewers now try autoplay with audio when stream audio exists, fall back to muted autoplay only when the browser blocks autoplay-with-audio, and retry audible playback if audio tracks arrive after the initial attach
- late voice joiners now receive current room stream snapshots and explicit voice leave now reconciles same-channel stream participation server-side
- web auth/chat/voice/stream integration
- standalone admin-panel web app protected by a management password
- in-app voice audio controls for mic input, global playback volume, and per-participant playback volume
- livestream capture now includes camera audio and updated screen-share audio constraints that keep browser echo/noise/gain hints without forcing local playback suppression
- livestream start now supports user-selected resolution/frame-rate capture presets persisted as stream-session metadata
- livestream quality now includes fixed bitrate presets plus `1440p`, and publish senders apply best-effort WebRTC max-bitrate parameters
- watched livestream popup viewers now include a live WebRTC stats panel (codec/resolution/fps/bitrate/loss/jitter/dropped frames)
- screen-share publish tracks now set `contentHint='detail'`, publish offers also apply sender `degradationPreference`, and pre-publish controls expose a best-effort codec selector (`Browser Default` / `H.264` / `VP8` / `VP9` / `AV1`)
- broadcasters now get a live `Your Stream` health panel showing target/send fps, bitrate, resolution, preferred-vs-negotiated codec, active peers, and browser limitation reason to help spot local encoder pressure
- voice link quality is now per-user: gateway publishes per-connection `GW RTT/GW Loss` and clients publish local `Media Loss`, merged into `voice.network.updated`
- voice channel roster visibility now works even when the user has not joined voice (gateway roster snapshots + channel-list rendering)
- voice reconnect now preserves the user's mute intent across gateway drops and resyncs that mute state after rejoin
- voice panel now renders `GW RTT/GW Loss/Media Loss` per participant and always displays zero values (`0ms/0%`)
- login bootstrap now attempts `me -> refresh -> me` before entering chat/gateway auth to avoid stale-token authentication stalls
- server name display in the client header and login surface
- media session bootstrap endpoint returning ICE config
- media internal routes now require a shared service secret and are intended only for gateway/internal callers
- API/gateway access-token acceptance now depends on the backing auth session still being live, not just JWT signature/expiry
- browser auth tokens now stay in `sessionStorage` instead of `localStorage`
- the admin panel no longer persists the management password in browser storage
- HTTPS dev proxy upstream selection is now runtime-port aware (`runtime-ports.json` + Vite log parsing) to avoid stale `:80` routing that can break external domain voice connectivity
- dev startup now performs Docker engine readiness checks (best-effort Docker Desktop auto-start + wait), and if Docker backend is stuck in `starting` it performs one automatic recovery attempt (`restart Docker Desktop + wsl --shutdown`) before failing
- dev startup now reports Docker daemon last-error details and exits early when Docker backend is stuck in `starting`, with explicit `wsl --shutdown` recovery guidance
- TURN startup now enforces public relay IP correctness for public domains (resolves from `TurnHost` DNS and rejects private `TURN_EXTERNAL_IP`), preventing "signaling works but media path fails" regressions for internet clients
- Docker Compose now ships as the first-party self-hosted path: Postgres, Redis, schema migration, API, gateway, media boundary, and a Caddy edge proxy for web/admin
- the default public path now uses a canonical self-contained `baker` runtime image plus a first-boot `bootstrap` container that persists generated runtime secrets and prints the initial admin password
- the shipped Caddy proxy still serves the user app on container port `:80` and the admin panel on container port `:8080`, while the default host bindings are now `:3000` (Web) and `:3001` (Admin) for easier local Docker startup
- Postgres and Redis stay bound to `127.0.0.1` by default in the compose topology so the public surface remains the proxy tier
- optional bundled coturn remains available behind the `turn` compose profile for harder NAT / internet voice-stream deployments

Still placeholders or deferred:

- real media backend / SFU
- recording / replay
- CDN/HLS stream distribution
- mobile-specific behavior
- complex permissions / RBAC
- automatic process restart/orchestration after admin port changes

Partially migrated:

- final stream gallery UI is now integrated into the shared client shell with separate `Your Stream`, `Watching`, and `Available Streams` sections
- temporary compatibility fallback remains for old single-stream `stream.watch` / `stream.unwatch` flows when the room shape is unambiguous
- channel `voiceQuality` is persisted and admin-managed, but it is not yet wired into actual voice media quality behavior

## Current Recommended Next Task

Recommended next work:

1. Deployment finish: configure Docker Hub mirroring secrets and publish the self-contained runtime images so Baker becomes directly searchable in Docker Desktop
2. Quick hardening: replace the shared admin password model with explicit admin identities / revocable admin sessions
3. Medium feature work: decide whether refresh-token handling should move from browser storage to `HttpOnly` cookies while preserving self-hosted simplicity
4. Larger architecture/product work: TURN / real media-adapter hardening after the current internal-route secret gate

## Temporary Product Behavior

- `POST /v1/auth/register` still auto-creates a starter guild and a `general` text channel
- when public registration is disabled, web and future desktop clients are intended to expose login-only auth surfaces while account creation moves to the admin control panel
- this remains a temporary onboarding behavior until explicit guild/channel creation or join flows exist

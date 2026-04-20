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

Current milestone: `Milestone 5` stability, quality, and deployment hardening after the Milestone 4 multi-stream redesign, with revised stability/UX scope complete (per-user voice link quality fanout, non-joined voice roster visibility, bitrate+1440p stream quality, auth/bootstrap and gateway reconnect hardening, startup-script governance) plus follow-up security fixes for media-internal auth, session-backed token validation, logout revocation, browser-storage hardening, and a smoke-tested single-image self-hosted deployment story built around `blockcat233/baker`.

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
- mobile web tabbed UI and joined-voice usability pass complete
- all-in-one Docker quick-start complete
- protocol compatibility, gateway runtime, stream-session repository, client-state migration, and gallery UI stages are complete
- `pnpm typecheck` passes
- `pnpm lint` passes
- `pnpm test` passes
- `pnpm audit --prod` passes
- `docker run -d -p 3000:80 -p 3001:8080 -v baker-data:/var/lib/baker blockcat233/baker:latest` now starts a validated all-in-one Baker instance with persisted secrets/data and optional bundled TURN
- public-facing repo docs now include an English-first `README.md`, a linked `README.zh-CN.md`, plus baseline contribution, security, conduct, and issue/PR templates; the homepage leads with the one-container path, calls out browser-only game/screen sharing plus the HTTPS requirement, and keeps auxiliary assets/examples under `docs/` instead of cluttering the root

## Tech Stack

- Monorepo: `pnpm workspace` + `turbo`
- Language: TypeScript with `strict`
- Web: React + Vite
- Desktop: Electron + React
- API: Fastify
- Realtime gateway: Fastify WebSocket
- Self-hosted runtime: one-container Docker image
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
- `docker`: container runtime and local infrastructure support files
- `docs`: architecture, history, status, decisions, example configs, and landing-page assets
- root collaboration docs: `README.md`, `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `.github/*`, `Dockerfile`, `docker-compose.yml`

## Module Responsibilities

- REST handles durable CRUD, public config, and admin control-plane APIs.
- WebSocket handles realtime events, room state fanout, and signaling relay.
- Browser capture and WebRTC peer logic live in the client/sdk layer.
- Media adapter and future SFU work stay behind `apps/media`.
- The admin panel manages durable server/workspace settings, not realtime room orchestration.
- the primary self-hosted path is the published all-in-one `baker` image, which bundles the current service topology into one container with one data root at `/var/lib/baker`
- `docker-compose.yml` is now only a development-support file for local Postgres/Redis/TURN infra

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
- Baker now ships as a validated all-in-one Docker image for the simplest public self-hosted path: one container, one data root (`/var/lib/baker`), bundled Postgres/Redis/Caddy, and optional bundled TURN
- the shipped container serves the user app on container port `:80` and the admin panel on container port `:8080`, while the recommended host bindings are `:3000` (Web) and `:3001` (Admin)
- the all-in-one image can bundle coturn behind `TURN_ENABLED=true` for harder NAT / internet voice-stream deployments

Still placeholders or deferred:

- real media backend / SFU
- recording / replay
- CDN/HLS stream distribution
- deeper mobile-specific media polish
- complex permissions / RBAC
- automatic process restart/orchestration after admin port changes

Partially migrated:

- final stream gallery UI is now integrated into the shared client shell with separate `Your Stream`, `Watching`, and `Available Streams` sections
- temporary compatibility fallback remains for old single-stream `stream.watch` / `stream.unwatch` flows when the room shape is unambiguous
- channel `voiceQuality` is persisted and admin-managed, but it is not yet wired into actual voice media quality behavior

## Current Recommended Next Task

Recommended next work:

1. Quick hardening: replace the shared admin password model with explicit admin identities / revocable admin sessions
2. Medium feature work: decide whether refresh-token handling should move from browser storage to `HttpOnly` cookies while preserving self-hosted simplicity
3. Medium feature work: harden TURN/public-relay guidance further now that the one-container image is the public entry path
4. Larger architecture/product work: TURN / real media-adapter hardening after the current internal-route secret gate

## Temporary Product Behavior

- `POST /v1/auth/register` still auto-creates a starter guild and a `general` text channel
- when public registration is disabled, web and future desktop clients are intended to expose login-only auth surfaces while account creation moves to the admin control panel
- this remains a temporary onboarding behavior until explicit guild/channel creation or join flows exist

# Repository State Summary

## Main Module Tree

```text
apps/
  api/
    src/
      lib/
      plugins/
      routes/
      testing/
  gateway/
    src/
      lib/
      routes/
      ws/
  media/
    src/
      adapters/
      routes/
  web/
  admin/
  desktop/
packages/
  client/
    src/
      app/
      features/
        auth/
        chat/
        gateway/
        session/
        stream/
        voice/
      platform/
  protocol/
    src/
      http/
      media/
      ws/
  sdk/
    src/
      http/
      webrtc/
      ws/
  shared/
    src/
  db/
    migrations/
    src/
      repositories/
      schema/
docs/
  architecture/
  adr/
  milestones/
docker/
.github/
  ISSUE_TEMPLATE/
LICENSE
```

## Key Protocol Files

- `packages/protocol/src/errors.ts`
  - shared error code definitions, including stream-specific errors
- `packages/protocol/src/http/guild.ts`
  - shared guild/channel DTOs, now including persisted channel `voiceQuality`
- `packages/protocol/src/http/auth.ts`
  - auth DTOs, including the authenticated logout response contract
- `packages/protocol/src/http/system.ts`
  - public server-config and admin control-plane DTOs
- `packages/protocol/src/ws/events.ts`
  - gateway commands/events for chat, voice, and stream, including `voice.roster.updated`, `voice.network.self_report`, `voice.network.updated`, and livestream quality settings (`resolution`/`frameRate`/`bitrateKbps`) on `stream.start`
- `packages/protocol/src/ws/envelope.ts`
  - WS envelope schemas and helpers
- `packages/protocol/src/media/signaling.ts`
  - shared media signaling contracts and session modes

## Key Schema And Repository Files

Schema:

- `packages/db/src/schema/users.ts`
- `packages/db/src/schema/auth.ts`
- `packages/db/src/schema/guilds.ts`
- `packages/db/src/schema/channels.ts`
  - stores channel type plus persisted admin-managed `voiceQuality`
- `packages/db/src/schema/messages.ts`
- `packages/db/src/schema/streams.ts`
- `packages/db/src/schema/server-settings.ts`

Repositories:

- `packages/db/src/repositories/messages-repository.ts`
- `packages/db/src/repositories/stream-sessions-repository.ts`
  - multi-stream active-session queries with compatibility fallback for old singular lookup callers
- `packages/db/src/repositories/server-settings-repository.ts`
  - singleton server-configuration persistence for the admin control panel
- `packages/db/src/repositories/users-repository.ts`
  - supports authenticated username updates through `update(id, { username })`
- `packages/db/src/repositories/auth-sessions-repository.ts`
  - durable auth-session lookup and revocation used by API/gateway auth enforcement
- `packages/db/src/repositories/refresh-tokens-repository.ts`
  - refresh-token persistence plus session-scoped revocation on logout
- `packages/db/src/repositories/types.ts`
- `packages/db/src/repositories/index.ts`

Migration state:

- `packages/db/migrations/0000_adorable_nomad.sql`
- `packages/db/migrations/0001_rainy_invaders.sql`
- `packages/db/migrations/meta/0000_snapshot.json`
- `packages/db/migrations/meta/0001_snapshot.json`
- `packages/db/migrations/meta/_journal.json`

## Key Gateway Files

- `apps/gateway/src/app.ts`
  - bootstrap and disconnect cleanup for presence, voice, and stream; injects the media internal secret into runtime bootstrap
- `apps/gateway/src/app-runtime.ts`
  - connection registry, presence manager, voice room manager, stream room manager, Redis fanout, media session creation, voice-roster snapshot/broadcast helpers, and per-user voice-network snapshot fanout; media session creation now authenticates to `apps/media` with the internal secret
- `apps/gateway/src/ws/connection-manager.ts`
  - authenticated connection registry, cached guild visibility for roster fanout, heartbeat quality sampling state (`gatewayRttMs/gatewayLossPct/mediaSelfLossPct`), and `system.ready` payload
- `apps/gateway/src/ws/voice-room-manager.ts`
  - in-memory voice room state plus targeted `voice.roster.updated` broadcast support
- `apps/gateway/src/ws/stream-room-manager.ts`
  - in-memory multi-publication stream room state keyed by `streamId`
- `apps/gateway/src/ws/event-router.ts`
  - auth, subscriptions, voice commands, voice self-network reporting, multi-stream commands, late-join stream snapshot replay, voice-leave stream cleanup, voice-roster/network fanout hooks, quality metadata persistence on `stream.start`, validated `streamId`-scoped signaling relay, and auth-session-backed websocket authentication
- `apps/gateway/src/ws/event-router.test.ts`
  - router coverage for auth/chat/voice/stream flows including multi-publisher, publish+watch coexistence, late-join stream discovery, voice-leave stream cleanup, and livestream quality metadata persistence

## Key API Files

- `apps/api/src/routes/auth.ts`
  - register/login/refresh/me/logout routes plus authenticated username update through `PATCH /v1/auth/me`, with logout revoking the durable session and its refresh tokens
- `apps/api/src/plugins/auth.ts`
  - bearer-token authentication that now requires a live, non-revoked backing auth session
- `apps/api/src/routes/system.ts`
  - public server-config, admin password verification, admin settings, admin-managed user creation, and admin-managed channel management
- `apps/api/src/lib/server-settings.ts`
  - singleton server-settings bootstrap, admin-password verification, and workspace-name sync helpers
- `apps/api/src/testing/create-in-memory-data-access.ts`
  - in-memory repository behavior for auth/chat/admin tests, including username update support, server settings, and channel `voiceQuality`
- `apps/api/src/app.test.ts`
  - API coverage for auth flows, username updates, and admin-managed server settings/account/channel flows

## Key Admin App Files

- `apps/admin/src/AdminApp.tsx`
  - management-password gate plus admin dashboard for server settings, managed user creation, and managed channel creation/update; the management password now stays in memory only instead of browser storage
- `apps/admin/src/admin.css`
  - dedicated control-panel styling
- `apps/admin/vite.config.ts`
  - separate admin dev server, defaulting to port `5180`, with a `/v1` + `/health` proxy to the API for same-origin browser requests

## Key Client Files

- `packages/client/src/app/AppRoot.tsx`
  - resolves API base URL (explicit `apiBaseUrl` override; browser same-origin by default; non-http fallback to legacy `:3001`), then loads public server-config (with fallback + surfaced bootstrap errors) and gates Web-enabled state before rendering login/chat
- `packages/client/src/app/derive-default-urls.ts`
  - derives default API + gateway URLs for LAN-friendly hostnames and non-http origins (Electron `file://` production)
- `packages/sdk/src/http/api-client.ts`
  - HTTP client wrapper; now surfaces empty/non-JSON responses as clear errors instead of raw `response.json()` parse failures and exposes authenticated logout
- `packages/sdk/src/ws/gateway-client.ts`
  - browser websocket client wrapper; queues outbound commands while the socket is CONNECTING to prevent early-send failures during login/voice join
- `packages/shared/src/env.ts`
  - server env parsing; `MEDIA_INTERNAL_URL` derives from `MEDIA_PORT` when unset to keep gateway -> media session creation working when ports are overridden, and production rejects insecure default secrets/passwords
- `packages/client/src/features/gateway/gateway-store.ts`
  - gateway lifecycle, reconnect behavior, close/error/handshake-timeout reconnect hardening, event routing, popup cleanup on explicit disconnect (reconnect preserves voice/stream state), and per-channel voice roster/network state
- `packages/client/src/features/gateway/gateway-store.test.ts`
  - regression coverage for popup cleanup, reconnect-error handling, `0ms` RTT path, and `voice.roster.updated` store updates
- `packages/client/src/features/auth/LoginView.tsx`
  - sign-in/create-account UI with registration password confirmation, server-name branding, and login-only mode when public registration is disabled
- `packages/client/src/features/auth/AccountPanel.tsx`
  - signed-in account surface for viewing email and editing username, with truncation-safe identity layout for long IDs/emails
- `packages/client/src/features/auth/auth-store.ts`
  - auth session lifecycle plus authenticated username update wiring and bootstrap recovery (`me -> refresh -> me`); browser tokens now use `sessionStorage`, and logout can revoke the active server session
- `packages/client/src/features/voice/voice-store.ts`
  - voice session lifecycle plus local mic gain, global playback volume, per-participant playback volume controls, reconnect hardening (`restart_ice` + auto rejoin after gateway reconnect), preserved mute intent across reconnect, gateway-ready join guard, local media-loss aggregation/self-report, and join/leave/mute/unmute sound cues
- `packages/client/src/features/voice/voice-sfx.ts`
  - synthesized Web Audio cue playback for mute/unmute and self/peer join/leave
- `packages/client/src/features/stream/stream-store.ts`
  - owned publish state, watched streams keyed by `streamId`, authoritative snapshot reconciliation, per-stream teardown, remote-ended watch preservation, reconnect hardening (`restart_ice` + auto re-watch after gateway reconnect), screen-share `contentHint='detail'`, live watched-stream stats sampling, broadcaster-side sender diagnostics sampling, and best-effort publish sender bitrate + degradation-preference + codec-preference application
- `packages/client/src/features/stream/stream-media.ts`
  - stream capture/playback helpers including audio-enabled camera capture, screen-share audio constraints, popup playback startup (prefer audio when available, muted fallback when autoplay-with-audio is blocked), playback-volume clamping, quality-based capture presets (`480p/720p/1080p/1440p` + fixed bitrate options), and broadcaster codec preference options
- `packages/client/src/features/stream/stream-media.test.ts`
  - helper coverage for stream playback-volume, stream capture constraint behavior, and quality-based capture presets
- `packages/client/src/features/voice/VoicePanel.tsx`
  - voice controls, participant list, two-row participant metadata layout, and per-user network metric rendering (`GW RTT/GW Loss/Media Loss`)
- `packages/client/src/features/chat/ChannelList.tsx`
  - text/voice channel rendering plus non-joined voice-channel member roster visibility
- `packages/client/src/features/voice/voice-audio.ts`
  - voice-audio clamp/effective-volume helpers used by the voice store and panel
- `packages/client/src/features/voice/voice-audio.test.ts`
  - helper coverage for voice volume normalization behavior
- `packages/client/src/features/stream/StreamPanel.tsx`
  - main-window stream control/status surface with `Your Stream`, `Watching`, and `Available Streams` sections plus pre-publish quality selectors (resolution/fps/bitrate/codec) and broadcaster health diagnostics
- `packages/sdk/src/webrtc/webrtc-manager.ts`
  - peer-connection helper with optional offer-time sender bitrate/degradation-preference application via `RTCRtpSender.setParameters`, best-effort publish codec-preference ordering via `setCodecPreferences`, peer sample stats, inbound video receive stats, and outbound sample stats for voice self-loss plus broadcaster diagnostics
- `packages/client/src/features/stream/StreamPopupHost.tsx`
  - popup-window view renderer for watched-stream playback, audio, volume, live WebRTC stats, ended-state UI, stream-audio guidance, and retrying audible playback when remote audio tracks arrive after initial attach
- `packages/client/src/features/stream/stream-popup-controller.ts`
  - `window.open` popup registry keyed by `streamId`, duplicate-prevention, and popup-close cleanup
- `packages/client/src/features/chat/ChatShell.tsx`
  - top-level chat/sidebar composition plus server-name header and popup host mount point; sign-out now uses the authenticated logout path
- `apps/media/src/app.ts`
  - media service bootstrap; internal routes no longer expose permissive CORS and now reject unauthorized callers
- `apps/media/src/lib/internal-auth.ts`
  - timing-safe shared-secret authorization for gateway/internal media requests
- `apps/media/src/routes/sessions.ts`
  - internal media-session creation guarded by the shared internal secret
- `apps/media/src/app.test.ts`
  - coverage for internal-route authorization
- `packages/client/src/app/app.css`
  - chat, voice, stream, and auth/control-panel-adjacent styling

## Self-Hosted Deployment Files

- `docker-compose.yml`
  - registry-first self-hosted stack for bootstrap, Postgres, Redis, migration, API, gateway, media boundary, proxy, and optional TURN, with default host bindings on `3000` (Web) and `3001` (Admin)
- `docker-compose.build.yml`
  - local source-build override for contributors and validation, keeping the public compose path pull-first
- `Dockerfile`
  - multi-stage build for service runtimes plus static web/admin proxy runtime
- `.env.selfhost.example`
  - optional advanced override template for fixed secrets, custom ports, TURN, and alternate image registries
- `docker/Caddyfile`
  - Caddy edge config serving the user app on `:80`, the admin panel on `:8080`, `/v1` + `/health` through the API, and `/ws` through the gateway
- `docker/runtime/*`
  - first-boot bootstrap + runtime env loading scripts that are baked into the published runtime images for the prebuilt-image compose path
- `.github/workflows/publish-images.yml`
  - GitHub Actions workflow for publishing runtime images to GHCR and optionally Docker Hub for searchable Docker Desktop discovery
- `packages/shared/package.json`
- `packages/protocol/package.json`
- `packages/db/package.json`
- `packages/sdk/package.json`
- `packages/client/package.json`
  - the repo keeps local-dev-friendly source entrypoints, while the Docker runtime rewrites the required workspace package manifests to built `dist/*` files inside the image so production Node processes do not try to execute `.ts` sources directly

Scripts:

- `scripts/auth-smoke.mjs`
  - Playwright smoke script to register -> logout -> login through the web UI (validates auth fetch end-to-end)
- `scripts/dev-up.ps1`
  - stops leftover dev servers (by ports + saved PIDs) and starts infra + services with logs; auto-picks usable ports when Windows excludes `3001-3003`; honors persisted `webPort` from `/v1/meta/public-config` on restart; proactively ensures Docker engine readiness (best-effort auto-start Docker Desktop + wait), emits live daemon-error diagnostics, performs one automatic stuck-start recovery attempt (`restart Docker Desktop + wsl --shutdown`), and fails fast if Docker remains unhealthy; forwards `STUN_URLS`/`TURN_*` from `.env` into services for WebRTC reliability tuning; writes resolved runtime ports to `output/dev/runtime-ports.json`; `-EnableTurn -TurnHost <host>` starts the local compose TURN relay, validates that `baker-turn` is actually healthy, writes effective TURN runtime details to `output/dev/turn-runtime.json`, enforces public TURN_EXTERNAL_IP for public hosts (no silent LAN fallback), and prints an open-port/protocol checklist
- `docs/dev-test-personal-config.md`
  - personal launcher configuration guidance and port/protocol checklist for local one-click startup
- `dev-test.local.env.example`
  - local-only starter template for one-click launcher personal settings
- `scripts/dev-https.ps1`
  - starts Caddy HTTPS reverse proxy for the web dev server (secure context for mobile mic/voice) and now resolves upstream from runtime metadata/Vite logs before fallback ports to avoid stale `:80` proxying
- `scripts/dev-reset-db.ps1`
  - deletes local Docker volumes to clear Postgres/Redis, reapplies schema, and resets the admin password in DB (requires `-Force` or interactive confirmation)

## Current Runtime Reality

Community and release metadata:

- `README.md`
  - public-facing bilingual project introduction for GitHub visitors
- `CONTRIBUTING.md`
  - contributor workflow, validation loop, boundaries, and privacy expectations
- `SECURITY.md`
  - baseline vulnerability-reporting guidance
- `CODE_OF_CONDUCT.md`
  - contributor behavior expectations
- `.github/ISSUE_TEMPLATE/*`
  - default bug-report and feature-request templates
- `.github/pull_request_template.md`
  - standard validation/docs/privacy checklist for incoming PRs
- public release note:
  - the public GitHub repository now exists with AGPL licensing and a bilingual landing page
  - the existing local development history is still not suitable for direct publication because commit author metadata includes personal information; any future public-history refresh should continue to use a fresh initial commit
- self-hosted release note:
  - GitHub visitors now have a Docker-first deployment path documented in `README.md`
  - the shipped compose stack has been smoke-tested with healthy `api`, `gateway`, `media`, and `proxy`
  - the default public compose path is now pull-first (`docker compose up -d`) and no longer requires manual secret editing before the first boot
  - the public compose path now uses self-contained images instead of bind-mounted runtime scripts, which is required for true registry-first deployment

- local agent/tool residue that was previously committed (`.claude/worktrees/*`, `.claude/settings.local.json`, `.npm-cache/*`, `.playwright-cli/*`, `__codex_patch_test__.txt`) is being removed from the repo working set and is now ignored where appropriate
- ad-hoc local artifact directories from prior tool runs (`download/`, `scripts/sidebar-screenshots/`, `test-results/`, local Codex/Claude logs/caches) were cleaned from the workspace; `output/dev` remains partially present only because the current live processes still hold open runtime logs and `caddy.exe`
- Docker Compose is now the primary self-hosted runtime path for public users:
  - `bootstrap` auto-generates/persists runtime secrets and prints the initial admin password
  - Caddy serves the user web app on container `:80` / host `:3000`
  - Caddy serves the admin panel on container `:8080` / host `:3001`
  - `/v1` and `/health` proxy to the API
  - `/ws` proxies to the gateway
- Postgres and Redis remain host-local (`127.0.0.1`) in the compose topology so the exposed surface is the reverse proxy rather than raw infra ports
- API auth and text-chat HTTP flows are implemented
- authenticated username updates now persist through the existing auth API/session flow
- public server-config is now served by the API and consumed by the client before auth UI renders
- the server control panel is now a separate web app protected by a shared management password; that password is no longer persisted in browser storage
- administrators can create users and create/update shared-workspace channels through API-backed admin routes
- server name, public-registration flag, Web enablement, and configured web/app ports are durable singleton settings
- gateway auth, presence, message push, voice, and room stream signaling are implemented
- API and gateway now both require the backing durable auth session to still be live before accepting an access token
- authenticated logout now revokes the current auth session and its refresh tokens
- gateway now also maintains and pushes per-channel voice roster snapshots for non-joined channel visibility
- gateway roster fanout now uses cached per-connection guild visibility instead of per-update membership lookups on the hot voice path
- `stream.state.updated` is the authoritative room stream snapshot and now supports multi-stream `streams[]`
- media relay validation is enforced for active voice or `streamId`-scoped stream sessions
- media runtime is still a placeholder bootstrap boundary, but its internal routes now require the shared `MEDIA_INTERNAL_SECRET`
- web client stream runtime now supports owned publish + watched-by-`streamId` state, with watched playback rendered into popup windows owned by the main client runtime
- web client stream capture now requests camera audio and uses browser echo/noise/gain constraints for stream-audio hardening without forcing local-playback suppression
- web client publish flow now supports selecting livestream resolution and frame rate before capture, and the requested quality is persisted as stream-session metadata
- web client publish flow now supports fixed bitrate presets, `1440p`, best-effort codec selection, applies screen-share `contentHint='detail'`, and applies best-effort sender bitrate/degradation-preference hints during publish WebRTC negotiation
- watched popup viewers now surface live WebRTC receiver stats (codec/resolution/fps/bitrate/loss/jitter/dropped frames) from the active watch runtime
- broadcasters now surface local sender diagnostics (target/send fps, bitrate, resolution, preferred-vs-negotiated codec, active peers, limitation reason) from the active publish runtime
- web client voice runtime now supports local mic gain, app-level playback volume, and per-participant playback volume adjustments without protocol changes
- web client voice panel latency now uses a unified local-to-server RTT metric sampled from gateway `ping`/`pong` and explicitly renders `0ms`
- web client now receives per-user voice network snapshots (`GW RTT/GW Loss/Media Loss`) via gateway fanout; local media-loss is computed in-browser and self-reported
- web client now preserves local mute intent across gateway reconnect/rejoin so roster state, UI state, and preserved audio tracks stay aligned
- auth bootstrap now refreshes expired sessions before entering chat/gateway auth (`me -> refresh -> me`) to avoid stale-token auth loops
- web auth tokens now persist in `sessionStorage` instead of `localStorage`
- web login hides registration when public registration is disabled, and the main client header shows the configured server name
- late voice joiners now receive current stream room snapshots, and voice leave reconciles same-channel stream runtime on the server even if client cleanup did not happen first
- desktop reuses the shared client shell but is not separately validated end-to-end
- channel `voiceQuality` is now persisted/admin-managed, but it is not yet applied to actual live voice media behavior

Temporary compatibility layer:

- protocol and gateway still emit/accept legacy single-stream fallback behavior when a room has exactly one active stream
- this fallback should be removed once old single-stream clients no longer need compatibility behavior


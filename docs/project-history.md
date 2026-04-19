# Project History

## 2026-04-18

### Prebuilt Docker image delivery pass

What changed:

- split the self-hosted Docker path into:
  - `docker-compose.yml` for pulling published images
  - `docker-compose.build.yml` for local source builds
- added a `bootstrap` container and `docker/runtime/*` scripts so the default first boot auto-generates strong persisted secrets and prints the admin password once through compose logs
- baked the runtime helper scripts into the shipped Baker runtime image so the default public path no longer requires bind-mounted repo scripts at runtime for bootstrap/migration/API/gateway/media
- consolidated the application-side published images into one canonical `baker` runtime image plus one `baker-proxy` image so Docker Hub search no longer needs to lead with separate `baker-api` / `baker-media` style app repositories
- switched Postgres back to the official upstream image while preserving first-boot runtime secret loading through the compose bootstrap volume
- changed the default host ports to `3000` (Web) and `3001` (Admin) so local Docker Desktop startup avoids the common `:80` bind conflict
- changed the quick-start path so public users no longer need to copy `.env` and hand-edit secrets before the first startup
- added `.github/workflows/publish-images.yml` so GitHub Actions can publish the runtime images to GHCR on `main`/tag pushes and optionally mirror them to Docker Hub when repo secrets are configured
- updated `.env.selfhost.example` so it now documents optional fixed-secret/image overrides instead of mandatory first-run secret editing

Why:

- public self-hosted users should not need a local build toolchain for the default deployment path
- "docker compose up -d" is materially easier to explain and closer to true one-click deployment than "copy env, edit secrets, then build"
- self-contained images are required before the app can realistically be pulled and started from registry-discovery surfaces such as Docker Desktop
- Docker Hub mirroring is the piece that makes those images directly searchable in Docker Desktop

## 2026-04-18

### Self-hosted Docker Compose baseline

What changed:

- expanded `docker-compose.yml` into a real self-hosted stack with:
  - `postgres`
  - `redis`
  - `migrate`
  - `api`
  - `gateway`
  - `media`
  - `proxy`
  - optional `turn`
- added `.env.selfhost.example` as a deployment-focused template with production-secret placeholders
- added a multi-stage `Dockerfile` for:
  - Node service builds/runtime
  - static web/admin build + Caddy runtime
- added `docker/Caddyfile` so the stack now serves the user app on `:80`, the admin panel on `:8080`, `/v1` and `/health` through the API, and `/ws` through the gateway
- bound Postgres and Redis host ports to `127.0.0.1` by default so the public surface is the proxy tier instead of raw infra containers
- fixed real self-hosted blockers discovered during smoke testing:
  - gateway/media production envs were missing required secrets
  - workspace packages intentionally remain source-first in the repo, so the Docker runtime now rewrites the required package entrypoints to built `dist/*` files inside the image
  - Docker BuildKit hit snapshot conflicts when multiple services exported to the same image tag during `docker compose up --build`
  - Caddy SPA fallback initially intercepted `/health`, so route order was locked explicitly
- updated `README.md` so the first deployment path shown to public users is now Docker-first instead of local-dev-first

Why:

- the previous compose file only covered infrastructure dependencies and did not provide a true "clone and deploy" path for open-source users
- production smoke testing surfaced issues that local dev startup did not catch, especially around ESM runtime entrypoints, production secret guards, image-export concurrency, and reverse-proxy routing order
- shipping a tested first-party compose stack materially lowers the barrier for self-hosted evaluation and matches the product direction of deployment-friendly private instances

### Open-source publication prep

What changed:

- audited the tracked repository contents for personal identifiers, local-only artifacts, and public-release blockers
- replaced personal-looking example values with neutral placeholders such as `demo.example.com` and `long.username@example.com`
- rewrote the root `README.md` into an English-first public-facing project introduction and added a linked `README.zh-CN.md` for Simplified Chinese readers
- selected `AGPL-3.0` as the open-source license and added the Baker name-origin note to `README.md`
- added baseline open-source collaboration files:
  - `CONTRIBUTING.md`
  - `SECURITY.md`
  - `CODE_OF_CONDUCT.md`
  - `.github/ISSUE_TEMPLATE/*`
  - `.github/pull_request_template.md`
- confirmed the tracked working tree is clean enough for a public snapshot
- identified that the existing local git history should not be published directly because commit author metadata includes a personal email address

Why:

- making the repo public safely is not only about `.env` files; example addresses, personal domains, and commit history can also leak identifying information
- the previous repo state was still optimized for a private development workspace, not a public open-source landing page
- publishing from a fresh initial commit is the safest way to avoid leaking local author metadata while preserving the current code state

### Popup livestream audio playback fix

What changed:

- changed popup livestream playback startup so viewers now try to start playback with audio when the watched stream already has a live audio track
- if the browser blocks autoplay-with-audio, popup playback now falls back to muted autoplay so video still renders while the existing manual "Start Playback" recovery path remains available
- popup playback now retries audible startup when audio tracks arrive after the initial video attach, instead of staying silently muted forever
- added focused regression coverage for:
  - popup playback preferring audio when audio tracks exist
  - muted fallback when autoplay-with-audio is blocked
  - video-only popup playback still using muted autoplay

Why:

- the latest livestream issue was not that screen-share system audio failed to capture; it was that the popup viewer path muted the `<video>` element up front and never retried audible playback
- remote WebRTC tracks can also arrive in stages (video first, audio a moment later), so a one-time muted attach was not reliable for livestream audio
- this fix stays entirely inside the client popup playback layer, preserving the current protocol/gateway/media boundaries while restoring expected stream audio behavior

### Security hardening pass (media internal auth + session-backed auth validation)

What changed:

- added a shared internal-secret gate for `apps/media` internal routes so media session bootstrap and capability/health endpoints are no longer anonymously callable
- updated gateway media-session creation to send the internal secret on requests to the media service
- added production env guards that now fail startup when insecure bootstrap defaults are still in use for:
  - `ADMIN_PANEL_PASSWORD`
  - `JWT_ACCESS_SECRET`
  - `JWT_REFRESH_SECRET`
  - `MEDIA_INTERNAL_SECRET`
- changed API auth validation to require a live, non-revoked `auth_session` behind each access token
- changed gateway websocket authentication to reject access tokens whose backing `auth_session` is missing or revoked
- added authenticated `POST /v1/auth/logout` to revoke the current session and all refresh tokens tied to it
- changed browser auth persistence so access/refresh tokens now live in `sessionStorage` instead of `localStorage`
- removed admin password persistence from the control panel; the password now stays in memory only for the active page lifetime
- upgraded `fastify` and `drizzle-orm` to patched versions and confirmed `pnpm audit --prod` reports no known production vulnerabilities
- added/updated regression coverage for:
  - media internal-route authorization
  - API logout + session revocation
  - gateway rejection of revoked sessions
  - production env default-secret guard
  - SDK logout request wiring

Why:

- the previous media boundary exposed internal session bootstrap and ICE/TURN configuration without service-to-service authentication, which was too permissive for a self-hosted deployment surface
- the previous auth model let signed access tokens remain usable until expiry even if the durable session had been revoked, which weakened logout and incident response
- persisting user tokens and the admin management password in browser `localStorage` made XSS/browser-compromise fallout worse than necessary
- rejecting unsafe production defaults up front is the smallest reliable guardrail for self-hosted operators before deeper auth/control-plane work lands

### Screen-share audio Windows mute hotfix

What changed:

- removed `suppressLocalAudioPlayback` from the shared screen-capture constraints used by livestream publish startup
- kept the existing screen-share audio browser hints (`echoCancellation`, `noiseSuppression`, `autoGainControl`) and updated regression coverage so screen-share capture no longer requests local playback suppression

Why:

- on Windows, starting a livestream with shared system audio could immediately mute the broadcaster's own system playback
- Electron/browser code was not explicitly muting Windows audio anywhere else; the regression mapped directly to the `getDisplayMedia` request that forced local playback suppression
- removing only this constraint is the smallest safe fix that preserves the current client-owned capture architecture and avoids protocol/gateway churn

### Voice reconnect / roster fanout hardening

What changed:

- `voice-store` reconnect now preserves the user's pre-drop mute state instead of resetting to `false` on successful rejoin
- after reconnect rejoin, the client reapplies that local mute intent to the preserved outbound audio tracks and resends `voice.speaking.updated { isMuted: true, isSpeaking: false }` when needed so gateway roster state matches the preserved local media state
- `peer_join` sound cues were decoupled from the offer-initiator branch, so all existing room participants now hear the join cue for a newly arrived peer
- gateway roster fanout now uses guild visibility cached on the authenticated connection rather than issuing one `guildMembers.findMembership(...)` lookup per active connection during every voice join/leave/mute update
- added gateway/runtime and client regression tests covering cached roster fanout, reconnect mute preservation, and peer-join cue behavior

Why:

- reconnect was preserving local media resources correctly, but it could leave the UI and gateway out of sync for muted users: the client state flipped back to unmuted while the preserved local track was still disabled
- `peer_join` audio feedback was only firing for the half of participants that also happened to be the offer initiator, which made the cue inconsistent in real rooms
- per-connection membership lookups on every roster fanout put unnecessary database work on the realtime voice path and worked against the repo's stability-first direction

### Workspace residue cleanup

What changed:

- removed tracked local-tool residue that had been accidentally committed into the repo:
  - `.claude/settings.local.json`
  - `.claude/worktrees/*`
  - `.npm-cache/*`
  - `.playwright-cli/*`
  - `__codex_patch_test__.txt`
- expanded `.gitignore` so local-only Codex/Claude residue stays out of Git in future runs:
  - `.claude/settings.local.json`
  - `.playwright`
  - `__codex_patch_test__.txt`
- deleted local workspace residue from prior agent/tool runs:
  - `.claude/worktrees`
  - `.npm-cache`
  - `.playwright`
  - `.playwright-cli`
  - `.codex-dev*.log`
  - `download/`
  - `scripts/sidebar-screenshots/`
  - `test-results/`
- attempted to remove `output/`; historical removable artifacts were deleted, but the active `output/dev` runtime directory remained partially locked by currently running processes

Why:

- the repo had accumulated real local-tool residue inside the tracked working set, including cache files, local settings, worktree copies, and patch-test artifacts
- these files do not belong to the product, create noisy Git status output, and work against deployment-friendly repository hygiene
- the remaining `output/dev` files are runtime locks rather than intentional keepers; they can be removed once the current dev processes stop

### UI hardening pass — account panel overflow fix + layout hardening + i18n

What changed:

**Primary fix (sidebar footer / account panel overflow):**
- `.account-panel` switched from `display: grid` to `display: flex; flex-direction: column` with `min-width: 0; overflow: hidden`
- `.account-panel-edit-btn` removed rigid `min-width: 72px`, replaced with `white-space: nowrap`
- `.account-panel-header` given `min-width: 0` so flex children truncate properly
- mobile breakpoint `min-width: 48px` on `.account-panel-edit-btn` removed
- reproduced and verified via Playwright at 700/768/820/900/1280px in EN and ZH — all 10 combinations show Edit button contained within account panel bounds

**Additional layout hardening:**
- added `min-width: 0` to `.stream-watch-row-summary > div:first-child` and `.stream-section-header > div:first-child` (prevents long usernames from overflowing stream watch rows)

**i18n completeness:**
- localized hardcoded English "Text" / "Voice" channel section headers in `ChannelList.tsx` with new i18n keys `chat.section_text` / `chat.section_voice` (EN: "Text" / "Voice", ZH: "文字" / "语音")
- localized hardcoded voice network diagnostic labels in `VoicePanel.tsx` with new i18n keys `voice.net_label_gw_rtt`, `voice.net_label_gw_loss`, `voice.net_label_media_loss`, `voice.net_label_stale`, `voice.net_label_local` (EN: "GW RTT" / "GW Loss" / "Media Loss" / "stale" / "local", ZH: "网关延迟" / "网关丢包" / "媒体丢包" / "过期" / "本地")
- added `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` to `chat-main-title` so long server names truncate instead of pushing the header layout
- added `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` to `stream-card-title` and `stream-card-subtitle` so long usernames/quality labels truncate safely
- added `min-width: 0` to the title container inside `stream-card-header` so flex children with overflow handling truncate properly

Why:

- **primary bug**: the Edit button in the sidebar account panel was pushed completely outside the sidebar bounds and overlapped the message area when the user had a long username/email (e.g. `long.username@example.com`). Root cause was `display: grid` with no explicit column template + `min-width: 72px` on the Edit button, allowing grid auto-sizing to exceed the 248px sidebar width
- channel section headers "Text" / "Voice" were hardcoded English, not using i18n — Chinese users saw English labels mixed into an otherwise fully translated UI
- voice network labels "GW RTT", "GW Loss", "Media Loss" were hardcoded English — same mixed-language regression
- long server names, usernames, and stream quality labels had no overflow protection and could push layouts, misalign controls, or cause horizontal scroll

## 2026-04-16

### Stream viewer stats + screen-share send preferences

What changed:

- `StreamPopupHost` now renders a live WebRTC viewer-stats panel below the popup volume control, sourced from the active recv-only watch session
- the viewer panel now surfaces codec, resolution, frame rate, bitrate, packet loss, jitter, and dropped-frame data without moving this high-frequency telemetry into shared persisted client state
- screen-share capture now sets `contentHint = 'detail'` on outbound video tracks
- publish offers now apply sender `degradationPreference` alongside the existing best-effort `maxBitrate`; screen-share publishing currently defaults to `balanced`
- `StreamPanel` now shows broadcaster-side health diagnostics for the active publish session, including send fps/bitrate/resolution, preferred-vs-negotiated codec, active peers, browser quality-limitation reason, and a best-effort local encoder-limited indicator
- pre-publish stream controls now expose a best-effort codec preference selector (`Browser Default`, `H.264`, `VP8`, `VP9`, `AV1`) that reorders publish transceiver codec preferences when the browser supports it
- added client regression coverage for screen-share `contentHint` application, sender preference wiring, codec preference propagation, and broadcaster diagnostics stats aggregation

Why:

- livestream viewers needed first-class in-product diagnostics to confirm what the browser is actually receiving instead of guessing from perceived smoothness
- screen-share publishing needed browser hints that better match text/detail-heavy content without redesigning the current P2P livestream architecture
- broadcasters also needed sender-side diagnostics to distinguish local encoding pressure from bandwidth pressure, and a low-risk way to trial different browser codecs before committing to deeper media-backend work

### TURN external-IP hardening for public-domain media relay

What changed:

- `scripts/dev-up.ps1` now treats public `-TurnHost` as a strict public relay scenario:
  - added DNS-based public IPv4 resolution from `TurnHost` (`A` record lookup) before external-IP API fallback
  - rejects private `TURN_EXTERNAL_IP` values when `TurnHost` is public, with an actionable startup error
  - changed generated `TURN_URLS` ordering to prefer hostname endpoints first in public deployments
- removed the previous silent fallback path that could set `TURN_EXTERNAL_IP` to LAN IP for public-domain runs.

Why:

- latest logs showed signaling success (`/ws` authenticated, voice/stream join acks) while audio/video media paths failed.
- runtime TURN metadata showed `externalIp` set to private LAN address (`10.x.x.x`) for a public domain, which makes relay candidates unreachable for internet peers.
- failing fast with explicit public-IP resolution avoids this recurring hidden failure mode.

### dev-up Docker "starting loop" diagnostics hardening

What changed:

- `scripts/dev-up.ps1` Docker readiness checks now surface the last daemon error while waiting.
- startup now detects repeated Docker backend stuck-start signatures (`context deadline exceeded`, `_ping` 500/API-version route errors), performs one automatic recovery attempt (`restart Docker Desktop + wsl --shutdown`), then exits with explicit remediation guidance if still unhealthy.
- access-denied daemon-pipe failures now return a clear permission-focused message instead of generic timeout-only output.

Why:

- latest startup failures were not simple "Docker not opened" cases: Docker Desktop process existed but backend stayed in `starting` for extended periods.
- users saw long waits with low-signal output, which made root-cause triage slow and ambiguous.
- this change turns that class of failure into an actionable, high-signal error path.

### M5.2 Revised Plan: Per-User Voice Link Quality + Connection/UI Fixes

What changed:

- protocol/gateway:
  - added `voice.network.self_report` command and `voice.network.updated` event
  - gateway now samples each websocket connection for rolling `gatewayRttMs/gatewayLossPct`
  - gateway now accepts per-user local media-loss self reports and broadcasts merged per-user snapshots to the same voice channel
  - `voice.network.updated` fanout now runs on join/leave/mute/disconnect plus self-report updates
- connection hardening:
  - client gateway store now handles websocket `close` and handshake-timeout fallback through the reconnect path, reducing long-lived `connecting` stalls
  - voice join now has a gateway-ready guard and returns `not_connected` immediately when realtime is unavailable
- client UI:
  - voice panel now renders per-user network metrics on line 2:
    - `GW RTT xxms · GW Loss yy% · Media Loss zz%`
    - zero values (`0ms/0%`) are rendered explicitly
  - voice-channel roster in the channel list now uses a contained visual surface (background/border/radius/padding) instead of raw text spillover
  - stream quality controls switched to vertical single-column layout to avoid horizontal crowding
  - participant volume sliders were constrained with `min-width: 0` safeguards to prevent overflow
- tests:
  - added router coverage for `voice.network.self_report` accept/reject paths
  - updated client and gateway tests to cover new gateway close wiring and voice-network event handling

Why:

- external-network testing exposed intermittent gateway readiness issues (`connecting` + `voice unavailable`)
- voice quality display needed to be per-user, not a single shared metric
- channel roster and stream-quality controls had concrete layout regressions under real content density

### M5 Revised Stability + UX Slice

What changed:

- protocol/gateway:
  - added `voice.roster.updated` event schema/type and gateway broadcast/snapshot wiring
  - gateway now emits roster updates after join/leave/mute/disconnect and sends roster snapshots on auth
  - stream quality schema now includes `bitrateKbps` and `1440p`
  - stream quality metadata persistence now includes bitrate
- client:
  - gateway store now tracks `gatewayRttMs` from `ping`/`pong` and channel roster state (`voiceRosterByChannel`)
  - voice panel now shows the same server RTT for all participants, supports explicit `0ms`, and moves latency to a second row under the name
  - channel list now renders live voice-member rosters even when not joined to voice
  - added voice SFX for mute/unmute and self/peer join/leave events
  - stream panel now supports `1440p` and fixed bitrate options (`2000/4000/6000/10000/16000 kbps`)
  - stream publish path now best-effort applies sender bitrate with `RTCRtpSender.setParameters().encodings[].maxBitrate`
  - auth bootstrap now performs `me -> refresh -> me` before entering chat/gateway auth, avoiding expired-token auth stalls
- UX/layout hardening:
  - fixed voice participant slider overflow and crowding in the voice panel
  - widened desktop sidebar and hardened account-panel truncation so long IDs no longer push edit controls out of view
- startup/docs:
  - `scripts/dev-up.ps1` now prints a required open-port checklist with protocol mode (TCP/UDP/TCP+UDP), including TURN relay ranges
  - added `docs/dev-test-personal-config.md` + `dev-test.local.env.example` to move personal launcher values out of scripts

Why:

- users reported voice-panel crowding, hidden/ambiguous latency display, missing non-joined voice-member visibility, and startup script config hygiene issues
- users also reported auth stalls after token expiry (`authenticating...` + invalid/expired token) requiring manual logout/login
- livestream quality needed fixed bitrate control and `1440p` support end-to-end

## 2026-04-15

### Cross-Network Voice/Stream TURN Runtime Fix

What changed:

- `docker-compose.yml`: reworked `turn` startup from an interpolation-sensitive inline command to a stable `/bin/sh -ec` startup script with escaped runtime env usage (`$$TURN_*`), explicit TURN env pass-through, and optional `TURN_EXTERNAL_IP` argument handling
- `scripts/dev-up.ps1`: `TURN_EXTERNAL_IP` auto-default now depends on `-TurnHost` type:
  - public host -> prefer detected public IPv4 (for internet clients)
  - local/private host -> keep LAN IP default (for local/LAN tests)
- `scripts/dev-up.ps1`: added TURN container post-start health checks; startup now warns and tails `docker logs` when `baker-turn` cannot stay running
- `scripts/dev-up.ps1`: writes `output/dev/turn-runtime.json` with effective host/port/relay range/runtime TURN URLs when TURN starts successfully
- `scripts/dev-up.ps1`: fixed a startup regression where helper parameter name `host` collided with read-only automatic variable `$Host`, causing `dev-test.bat` startup to abort during TURN setup

Why:

- latest external-domain test (`https://demo.example.com`) showed signaling success (channel join + speaking indicator) but no media path (no voice audio, stream watch failed)
- runtime logs and container state showed `baker-turn` stuck in restart loop due command truncation (`[: 1: Syntax error: end of file unexpected (expecting "then")`), so TURN relay was never actually available
- with internet clients, advertising a LAN-only `TURN_EXTERNAL_IP` is also insufficient; coturn must advertise a public-reachable relay IP (or explicit override) for cross-network media to succeed

### WebRTC / Voice No-Audio Root-Cause Fix

What changed:

- `docker-compose.yml`: removed `--no-loopback-peers` from coturn — was silently blocking relay to loopback-range addresses
- `scripts/dev-up.ps1`: `TURN_EXTERNAL_IP` now defaults to the LAN IP (`$primaryIp`) instead of the public IP, so coturn advertises relay ports that local peers can reach without NAT hairpinning; also prepends `turn:${primaryIp}:${turnPort}` entries to `TURN_URLS` so LAN peers try the direct path before the external hostname
- `voice-store.ts`: remote `Audio` elements are now appended to `document.body` (hidden) before `play()` — Chrome's autoplay policy blocks play on detached elements; all teardown paths now call `detachRemoteAudio()` which also removes the element from the DOM
- `voice-store.ts`: added try/catch around `addIceCandidate` and `handleAnswer` in `handleMediaSignal` to surface WebRTC errors instead of silently swallowing them
- `voice-store.ts`: `onPeerConnectionStateChange` now writes the `RTCPeerConnectionState` into `peerNetwork[userId].connectionState`
- `VoicePanel.tsx`: appends `[state]` to the RTT/loss label when a peer's connection state is not `connected`, giving in-UI diagnostic visibility into ICE progress

Why:

- both users showed `latency: — / packet loss: —` because the peer connection never reached `connected` — the audio pipeline never started
- TURN relay was reported as active (`hasTurn: true`) but silently failing: the public-IP relay addresses that coturn was advertising required NAT hairpinning from inside the LAN, which most home routers do not support; using the LAN IP as `TURN_EXTERNAL_IP` eliminates the hairpin requirement
- `--no-loopback-peers` compounded same-machine testing failures
- Chrome's autoplay policy rejected `Audio.play()` calls on audio elements not in the document, so audio was blocked even when ICE would have connected
- no try/catch on ICE/answer paths meant any SDP or ICE error was invisible without browser devtools

### Mobile Voice Bug Fix + UI Polish Stage 3

What changed:

- fixed mobile voice-channel silent failure: `VoicePanel` now renders a visible error card (localized) for `insecure_context`, `mic_denied`, and `not_connected` states; `ChatShell` now mounts `VoicePanel` for `status === 'error'`
- added `getMicUnavailableReason()` guard in voice-store to immediately catch cases where `navigator.mediaDevices` is absent (HTTP on mobile)
- added `clearError()` to voice store; five new i18n keys added in EN and ZH
- removed always-visible hint text from `AccountPanel` non-edit view; sidebar-bottom on mobile went from 232px → 71px (chat area grew from 432px → 681px, +58%)
- `sidebar-footer` changed to flex-column with `sidebar-footer-actions` inner row — language switcher and sign-out are now inline at all sizes
- `btn-ghost` global `width` changed from `100%` to `auto`; full-width restored only for login form buttons
- channel list now groups into Text / Voice sections with labeled headers (hidden in mobile chip layout)
- voice channel icon changed from 'V' to '◉'
- message grouping: consecutive same-author messages within 5 minutes suppress the author+timestamp header on follow-up items; hover highlight per item replaces fixed inter-item gaps
- `message-panel` min-width changed from `360px` to `0` (fixes horizontal scroll on narrow mobile)
- `scripts/ui-audit.mjs` added: Playwright-based audit capturing screenshots across desktop/tablet/mobile with layout measurements and auth injection fallback

Why:

- voice join on mobile HTTP was silently failing — users saw nothing, no error, no UI feedback; the root cause was `VoicePanel` returning null for error state
- the sidebar was consuming 232px (28%) of an 812px mobile screen in the previous layout, leaving less than half the height for actual chat content
- desktop/tablet sidebar footer buttons were full-width and stacked vertically; a compact horizontal row with correct sizing is the standard pattern for persistent controls
- grouped message display is standard for chat products and significantly reduces visual noise in active channels

### Auth Bootstrap Base-URL Fix (Blocking)

What changed:

- changed `AppRoot` to default to same-origin API calls in browsers (reverse-proxy friendly) while keeping explicit override via `apiBaseUrl` / `VITE_API_BASE_URL`; non-http origins (Electron `file://`) fall back to the legacy `:3001` / `:3002` defaults
- extracted URL derivation into `packages/client/src/app/derive-default-urls.ts` and added a unit test covering `file://` (Electron production), `http` (LAN), and `https` (wss) cases
- hardened `packages/sdk` JSON parsing so empty/non-JSON responses produce clear errors instead of `Unexpected end of JSON input`
- made the login UI surface bootstrap errors inline (public-config fetch failures), so misrouted API requests show a concrete cause instead of only `Failed to fetch`
- added a Vite dev-server proxy for `/v1` + `/health` (targets `API_HOST`/`API_PORT`) so local dev can use same-origin API calls
- changed the default gateway websocket URL derivation to prefer same-origin `/ws` in browsers, and added a Vite dev proxy for `/ws` to the gateway (HTTPS/proxy friendly; avoids mixed-content when the page is served over HTTPS)
- fixed `GatewayClient` to queue outbound commands while the websocket is CONNECTING (prevents `WebSocket.send` CONNECTING-state errors when users click voice quickly after login)
- added `scripts/auth-smoke.mjs` (Playwright) to register → logout → login for quick local validation
- added `scripts/dev-https.ps1` to run an HTTPS reverse proxy (Caddy) in front of the web dev server so mobile mic/voice works under a secure context
- added `scripts/dev-up.ps1` (stop old dev servers then start infra + services) and `scripts/dev-reset-db.ps1` (delete Docker volumes and reapply schema)
- improved WebRTC ICE defaults and observability: `STUN_URLS` now defaults to multiple endpoints; media logs ICE config; gateway logs whether TURN is present; `scripts/dev-up.ps1` forwards `STUN_URLS`/`TURN_*` from `.env` so dev deployments can enable TURN for cross-region reliability
- added optional TURN relay infra: `docker-compose.yml` now includes `baker-turn` (coturn); `scripts/dev-up.ps1 -EnableTurn` starts it and auto-picks a usable `TURN_PORT` on Windows where `3478` can be excluded/reserved
- improved flaky-network behavior: on gateway reconnect, the client now attempts to rejoin the active voice channel and re-watch active streams; peers also request `restart_ice` when connections enter `disconnected/failed`
- fixed server env parsing so `MEDIA_INTERNAL_URL` derives from `MEDIA_PORT` when unset (prevents gateway voice-join failures when only the media port changes)
- fixed the admin panel dev bootstrap to use same-origin `/v1/*` calls (via a Vite proxy) instead of assuming `http://localhost:3001` (prevents `Failed to fetch` when the API port is auto-shifted)
- `scripts/dev-up.ps1` now honors the persisted `webPort` from `/v1/meta/public-config` on restart, so changing the web port in the control panel takes effect after the next dev-up run

Why:

- in common deploy/dev setups (reverse proxy serving `/v1/*` on the same origin as the web UI, or Vite dev without an API proxy), the client can send auth/bootstrap requests to the wrong origin and surface a generic `Failed to fetch` (or JSON parse errors on HTML)

## 2026-04-12

### Milestone 1 Skeleton Created

What changed:

- created the `pnpm workspace` monorepo
- added `api`, `gateway`, `media`, `web`, and `desktop` apps
- added `client`, `protocol`, `sdk`, `shared`, and `db` packages
- added Docker Compose for PostgreSQL and Redis
- added the initial architecture and milestone docs

Why:

- M1 needed a runnable, typed skeleton before any product features
- service and package boundaries had to be fixed before realtime/media work

### Milestone 2 Slice 1 Auth + HTTP Chat Backend

What changed:

- added schema, migrations, and repositories for auth, guild, channel, and message data
- added HTTP auth and chat routes
- implemented stable message pagination
- added in-memory API test data access

Why:

- durable auth and message persistence had to land before realtime fanout

### Milestone 2 Slice 2 Gateway Presence + Message Push

What changed:

- added gateway auth, presence, and channel subscription flows
- added Redis-backed message push and presence fanout
- added minimal API publish hook after durable message creation

Why:

- M2 needed a realtime vertical slice after the durable HTTP foundation

### Milestone 2 Slice 3 Web Client Integration

What changed:

- wired auth, chat, and gateway flows through `packages/client` and `packages/sdk`
- added login/chat UI and end-to-end WebSocket auth/subscribe/push wiring

Why:

- the repo needed a usable end-to-end chat slice before entering voice work

## 2026-04-13

### Milestone 2 Slice 4 Chat Reliability + UX Hardening

What changed:

- added reconnect back-off
- added older-message pagination UI
- added presence rendering and gateway status feedback

Why:

- the chat slice needed recovery and history access before voice/stream work

### Milestone 3 Voice MVP

What changed:

- added voice protocol contracts and media session bootstrap
- added gateway voice room runtime and media signal relay
- added client voice store, panel, and WebRTC peer lifecycle
- fixed remote audio playback and local speaking indicator behavior

Why:

- Baker needed a real room-based voice baseline before room streaming

Important tradeoffs:

- voice is P2P and small-room only
- `apps/media` is still `NoopMediaAdapter`
- voice room state is in-memory only in the gateway

### Post-M3 Fix Chat Message Author Display

What changed:

- added `authorUsername` to HTTP and WS message payloads
- updated DB/API/client paths so all message surfaces render usernames instead of truncated IDs

Why:

- manual testing exposed a message-author display regression after voice work

### Milestone 4 Room Livestream / Screen Share MVP

What changed:

- finalized stream protocol contracts and stream-specific error codes
- wired `stream_sessions` into `DatabaseAccess`
- added gateway `StreamRoomManager`
- added `stream.start`, `stream.stop`, `stream.watch`, and `stream.unwatch`
- made `stream.state.updated` the authoritative room snapshot
- tightened `media.signal.*` validation for both voice and stream session modes
- added `WebRtcManager.handleRecvOnlyOffer()` for stream viewers
- added client `stream-store` and `StreamPanel`
- integrated stream routing into `gateway-store`, `ChatShell`, `ChannelList`, and `VoicePanel`

Why:

- M4 needed a single-host, low-latency room stream MVP without changing the approved architecture
- authoritative snapshots were required so failed or terminated sessions tear down cleanly
- gateway relay validation was required before exposing the stream signaling path in the browser

Important tradeoffs:

- room streaming is P2P and intended for small rooms only
- stream state is in-memory in the gateway runtime
- `apps/media` still provides bootstrap only, not a real media backend
- manual browser validation is still recommended even though automated validation is green

### Milestone 4 Redesign Stage 1 Protocol Compatibility Layer

What changed:

- added additive multi-stream protocol contracts around `streamId`
- extended `stream.state.updated` to support `streams[]` room snapshots
- preserved temporary single-stream compatibility fields `session` and `viewers`
- added new stream error codes needed for the migration

Why:

- the approved redesign moved Baker from a single-broadcaster room model to a Discord-like multi-stream room model
- protocol compatibility had to land first so gateway/client migration could happen incrementally

### Milestone 4 Redesign Stage 2 Gateway Multi-Stream Runtime

What changed:

- replaced single-host stream runtime state with multi-publication room state keyed by `streamId`
- enforced one publisher stream per user per voice channel
- allowed one user to publish and also watch other streams in the same channel
- updated `media.signal.*` validation to be `streamId`-scoped
- added gateway tests for multiple publishers, `streamId`-targeted watch behavior, and publish+watch coexistence

Why:

- the runtime layer had to stop assuming one active stream per voice channel before the client gallery work could happen
- `streamId`-scoped validation was required to keep signaling safe once multiple streams coexist in one room

### Milestone 4 Redesign Stage 3 Stream Session Repository Upgrade

What changed:

- upgraded `streamSessions` repository APIs from singular active-channel lookup to multi-stream list/query patterns
- added `listActiveByChannel(channelId)` and `findActiveByChannelAndHostUser(channelId, hostUserId)`
- kept `findActiveByChannel(channelId)` as a temporary compatibility helper derived from the list query
- updated in-memory API test data access to mirror the new repository contract

Why:

- durable stream session access could no longer assume one active stream per channel
- the gateway redesign needed persistence APIs that match publisher-owned stream sessions even before the client migration finishes

### Milestone 4 Redesign Stage 4 Client Stream State Migration

What changed:

- replaced the single-role/single-session client stream store with split state for:
  - one owned publish session
  - many watched streams keyed by `streamId`
- made `streamId` the primary client identity for watch runtime, teardown, and reconciliation
- updated per-stream media signal routing so host publish state and watched recv-only state no longer conflict
- updated the existing stream panel and voice-channel live badge to work with the new state shape without attempting the final gallery redesign

Why:

- the approved redesign required publish/watch coexistence and per-stream teardown before the final gallery UI could be built safely
- client runtime still assumed one stream role at a time, which would have broken multi-stream watch behavior even though protocol/gateway already supported it

### Milestone 4 Redesign Stage 5 Gallery UI Integration

What changed:

- moved the shared stream gallery out of the narrow left sidebar and into the main chat area beside messages
- updated `StreamPanel` to render three simple sections: `Your Stream`, `Watching`, and `Available Streams`
- made the watching surface render one large main tile for a single watched stream and a responsive grid for multiple watched streams
- kept watch and unwatch controls scoped to `streamId` so stopping one watch only removes the targeted tile
- preserved Stage 4 runtime behavior so stopping your own stream no longer tears down active watched tiles

Why:

- Stage 4 had already separated owned publish state from watched-by-`streamId` state, so the final approved gallery could now be added without refactoring the runtime model
- the previous transitional panel was too constrained to represent a Discord-like multi-stream room in a stable, simple way

### Milestone 5 Slice 1 Livestream Audio Playback + Echo Prevention

What changed:

- added client-side stream audio helpers for watched-stream playback volume and browser capture constraints
- updated watched livestream tiles to apply in-app playback volume directly on the remote media element
- added a per-stream playback volume slider in `StreamPanel` for livestream output volume control
- changed screen-share capture requests to prefer browser-side local audio playback suppression for included display audio
- changed camera stream capture to video-only so livestreaming does not duplicate the active voice microphone path
- added focused tests for stream playback-volume and capture-constraint helpers

Why:

- Milestone 5 hardening needed livestream audio playback to behave predictably for viewers before broader UI polish
- viewers needed an in-app speaker/output volume control that does not rely on OS master volume
- browser-level echo prevention had to be applied at capture time to reduce feedback risk when screen audio is shared alongside live voice

### Milestone 5 Slice 2 Stream Viewing Surface + Gallery UX

What changed:

- reorganized `StreamPanel` so `Watching` is the primary viewing surface and `Your Stream` plus `Available Streams` sit in a secondary sidebar column
- made the single-stream watching state render as a featured large tile with a much larger default video area
- made the multi-stream watching state render in a roomier gallery grid with larger minimum tile sizes for readable controls and labels
- added simple bounded desktop resizing for the stream viewing pane without redesigning the overall app shell
- added desktop min-width protection for the message panel so chat readability does not collapse too aggressively when the stream pane grows

Why:

- Slice 2 needed the viewing experience to feel closer to a Discord-like watch surface without changing the approved Stage 4/5 stream model
- one watched stream needed to feel large enough by default to justify watching inside the current shell
- multi-stream viewing needed better default density and readability while keeping `Your Stream` and `Available Streams` clearly secondary

### Milestone 5 Slice 3 Popup-Window Livestream Viewing

What changed:

- moved watched-stream playback out of the main page and into real browser popup windows opened via `window.open`
- kept the main window as the single owner of stream store state, gateway connection, watched stream runtime state, and `MediaStream` objects
- changed the main stream panel into a control/status surface with popup focus and per-stream stop actions instead of inline watched playback
- added popup-window UI rendering for video playback, stream audio playback, volume control, and basic stream metadata
- kept watched popup identity keyed by `streamId` so duplicate watch actions focus the existing popup instead of opening a duplicate
- changed remote-ended watched streams to stay visible as a clear ended state until the user closes that specific viewer

Why:

- the approved product direction moved livestream viewing into dedicated popup windows without creating a second app runtime
- keeping the main window as the sole runtime owner avoids a second gateway/store/media lifecycle while still giving watched streams a larger dedicated surface

### Phase 1 Stability Cleanup After Milestone 5 Popup Viewing

What changed:

- fixed late-join stream discovery so users who join a voice room after streams are already live receive the current authoritative `stream.state.updated` snapshot immediately
- fixed gateway-side voice-leave cleanup so leaving a voice channel removes same-channel hosted streams and watched viewer memberships even if the client-side cleanup path did not run first
- fixed popup lifecycle cleanup so gateway disconnect and explicit gateway teardown close all watched-stream popup windows instead of leaving orphaned viewers behind
- fixed gateway presence reconciliation so login snapshots and disconnect cleanup use current authenticated connections instead of stale Redis counters
- added stale-presence pruning during snapshot reconciliation so old users no longer come back in the online list after reconnects or process restarts
- added focused regression coverage in gateway and client tests for these cases

Why:

- manual and code-path investigation showed Phase 1 still had real runtime desync risks around late joins, voice-leave cleanup, and popup disconnect handling
- these were stability bugs in the current app, so they were fixed before starting any new product feature slices

### Phase 2 Slice 1 Account / Profile UX

What changed:

- added password confirmation to the web registration flow so new accounts must enter matching passwords before submit
- added authenticated username editing through `PATCH /v1/auth/me`
- extended the users repository and in-memory test data access to support username updates
- added a shared `AccountPanel` in the client shell so signed-in users can rename themselves later
- updated the client auth store and gateway presence cache so the current user's new username is reflected immediately after save
- added API coverage verifying that username updates persist and are returned by `GET /v1/auth/me`

Why:

- the next approved Phase 2 slice started with low-risk account/profile UX instead of more realtime-heavy media work
- registration needed a basic password-confirmation guard to prevent obvious account-creation mistakes
- users needed a minimal way to change usernames later without introducing a larger profile system yet

### Phase 2 Slice 2 Voice / Audio Controls

What changed:

- added client-side voice audio helpers for input/playback volume clamping and effective per-user playback volume computation
- upgraded `voice-store` to support:
  - local microphone input gain control
  - app-level playback/output volume control for remote voice audio
  - per-participant playback volume overrides keyed by participant user ID
- updated remote voice audio handling so volume updates apply to active detached `<audio>` elements without requiring reconnect
- updated `VoicePanel` with:
  - mic input slider
  - playback slider
  - participant-local volume controls
- kept voice signaling/session flow unchanged and limited this slice to local client behavior
- added `voice-audio.test.ts` coverage for clamp/effective volume math

Why:

- this was the approved next Phase 2 slice after account/profile and had to stay low risk for existing voice/stream runtime behavior
- users needed practical in-app control over mic level and playback loudness without relying on OS-level controls
- per-participant audio balancing is essential in small-room P2P voice where individual loudness can vary significantly

### Phase 2 Slice 3 Stream Audio / Controls

What changed:

- updated livestream capture helpers so camera sharing now requests audio capture instead of forcing video-only
- kept screen-share capture audio enabled and updated the capture constraints to prefer browser echo/noise/audio-gain processing while retaining local playback suppression
- preserved existing per-stream watched playback volume controls in popup viewers
- updated popup stream guidance copy to match current runtime behavior where camera streams now carry captured audio
- updated `stream-media.test.ts` to validate the new camera/screen capture constraint behavior

Why:

- this slice closes the gap where camera livestreams could be live but silent
- stream audio quality and feedback risk needed safer browser-level defaults without changing gateway/protocol architecture
- this remains an incremental client-only media capture/control upgrade aligned with the approved Phase 2 order

### Popup Playback Hotfixes

What changed:

- added a bounded startup timeout around popup `play()` bootstrap so watcher UI no longer hangs indefinitely on `Starting livestream video...`
- preserved the existing `Start Playback` recovery path
- hardened popup playback recovery for paused elements and added muted fallback behavior so real motion keeps rendering in Chrome autoplay-restricted cases
- removed automatic unmute retry loops that were re-triggering browser pauses and causing one-frame black-screen behavior

Why:

- manual testing reported real popup playback failures after the popup-window redesign
- runtime inspection showed the issue was browser autoplay/pause behavior in the popup, not missing WebRTC tracks, so the fix stayed local to the popup playback client path

## 2026-04-14

### Livestream Quality Controls

What changed:

- extended the shared stream protocol so `stream.start` can carry optional quality settings for resolution and frame rate
- updated stream-session persistence helpers so requested quality can be stored in `stream_sessions.metadata`
- updated gateway `stream.start` handling to persist requested quality while keeping capture and WebRTC logic in the browser/client layers
- updated client stream capture helpers to translate quality presets into browser video constraints for screen-share and camera capture
- added a minimal `StreamPanel` UI for choosing resolution and frame rate before starting a stream, and surfaced the selected quality on the active owned-stream card
- added focused client and gateway tests for quality-aware capture constraints, `stream.start` payloads, and quality metadata persistence

Why:

- manual follow-up requested user-selectable livestream resolution and frame rate without expanding the approved architecture
- the quality choice had to flow end-to-end through the protocol contract so session state and persistence match what the broadcaster requested
- keeping gateway/runtime responsibilities narrow required quality to stay a client capture concern, with gateway limited to orchestration and metadata persistence

### Voice Participant Inline Volume Sliders

What changed:

- updated `VoicePanel` so every remote participant in the joined voice channel now shows a local playback-volume slider directly under their display name
- kept the existing `voice-store` per-participant volume state and effective-volume application logic unchanged

Why:

- the requested UX was to adjust each joined participant's volume directly from the voice roster without extra clicks
- the existing runtime already supported per-user local playback volume, so this change could stay a minimal UI-only upgrade

### Voice Mute Speaking-State Fix

What changed:

- updated voice speaking detection to monitor the actual outbound send stream before considering the raw microphone capture stream
- added an explicit mute guard so muted clients stop emitting local `voice.speaking.updated` activity
- muting now immediately clears the local speaking state instead of waiting for the next analyser transition
- added focused client regression coverage for mute preventing further `speaking=true` reports

Why:

- manual testing showed muted users could still light the speaking indicator because the analyser was still observing raw captured audio
- mute in the current client is expected to stop outbound voice activity, so local speaking state needed to align with the actual send path

### Phase 1 Bug-Hunt Pass 2

What changed:

- fixed voice channel switching: `joinVoiceChannel` now sends `end` signals to all current WebRTC peers and a best-effort `voice.leave` to the gateway for the old channel before starting the new join sequence 鈥?mirrors `leaveVoiceChannel` behavior that was already correct
- fixed popup watch cancel race: removed `cancelledWatchRequests.delete(streamId)` from `unwatchStream`'s `finally` block so the cancel flag persists until `watchStream` detects it after its ACK arrives 鈥?the previous code could clear the flag between the unwatch completing and the watch ACK resuming, causing an orphaned WebRTC runtime with no UI state
- added cancel-flag cleanup to the `stream.watch` ACK failure and null-userId paths in `watchStream` to prevent stale entries when watchStream fails before reaching the cancel check
- added regression test for voice channel switch (end signals + voice.leave for old channel)
- added regression test for the popup watch cancel race scenario

Why:

- code inspection confirmed voice channel switching never sent `voice.leave` to the gateway; users were left as ghost participants in the old channel and old peers never received `end` signals
- the cancel race was a real narrow window: if `stream.unwatch` ACK arrived faster than `stream.watch` ACK (both through the same gateway, but not guaranteed), the cancel flag would be cleared and `watchStream` would proceed to create an orphaned runtime 鈥?a resource leak with potential for stale signal routing

### Phase 1 Bug-Hunt Pass 1

What changed:

- added `handleGatewayDisconnected()` to the voice store so gateway disconnects and explicit logouts now tear down the mic capture stream, audio contexts, and WebRTC peer connections correctly instead of leaking them
- wired `useVoiceStore.getState().handleGatewayDisconnected()` into both the `onError` reconnect path and the explicit `disconnect()` path in the gateway store
- added regression coverage in `gateway-store.test.ts` for both voice-reset paths
- fixed admin auto-login `useEffect` to clear the stored password when auth verification fails, preventing silent pre-fill with an invalid credential
- fixed admin `handleLogin` to surface `loadDashboard` errors as visible feedback instead of swallowing them

Why:

- code inspection found that the gateway store already reset the stream store on disconnect but never reset the voice store 鈥?a real resource leak (mic still open after logout) and a stale-UI bug (voice panel showing "active" after reconnect with dead WebRTC)
- the admin auto-login silently failed when a stored password was rotated, leaving the form pre-filled with an unusable credential and no explanation

### Server Control Panel Baseline

What changed:

- added a new `apps/admin` web app running on a separate admin port (default `5180`) and protected by a management password
- added `server_settings` persistence plus helper logic for:
  - server name
  - public-registration enable/disable
  - web enable/disable
  - stored web/app ports
  - management-password hash
- added public/admin system routes for:
  - public server config
  - admin password verification
  - admin settings read/update
  - admin-managed user creation
  - admin-managed channel creation and update
- changed public registration to respect the persisted `allowPublicRegistration` setting
- changed the web client to load public server config up front, hide registration when disabled, and show the configured server name in the client shell
- changed the web dev default port to `80`
- added persisted per-channel `voiceQuality` so the admin panel can manage voice quality settings alongside channel names
- added API coverage for the new admin-managed settings/account/channel flows
- changed the bootstrap default management password to `admin`
- added compatibility migration so untouched legacy default-password hashes are upgraded to the new default on first server-settings access

Why:

- the requested product change introduced a server-side control plane for administrators without redesigning the existing chat/voice/stream runtime
- public/self-service account creation needed to become an administrator-controlled deployment setting
- server naming, channel creation, and channel settings needed a single durable source of truth outside the end-user client

Important tradeoffs:

- the admin panel currently authenticates with one shared management password rather than admin user accounts or granular permissions
- stored web/app port changes update configuration and manifests, but they do not restart running frontend processes automatically
- channel `voiceQuality` is currently a persisted/admin-facing channel setting only; it does not yet change the live P2P voice media pipeline


### Bilingual UI (Stages 1–4: foundation + client + admin)

What changed:

- added `i18next` + `react-i18next` infrastructure to the shared client shell (`packages/client`) and the admin panel (`apps/admin`)
- added in-UI language switchers (EN / 中文) in the web client user area and the admin top header
- language selection persists via `localStorage` key `baker_language` and prefers the stored value over browser language after manual switching
- translated web client UI across auth, chat, voice, and stream (including popup viewer UI) into English and Simplified Chinese
- translated the admin panel login + dashboard UI into English and Simplified Chinese
- documented a terminology baseline in `docs/i18n.md`

Why:

- the product requires bilingual UI support (English + 简体中文) with language switching and persistence

## 2026-04-14

### Web UI Polish Stage 1 (Web client)

What changed:

- introduced a small CSS token system in `packages/client/src/app/app.css` for surfaces, borders, text, radii, and focus ring
- normalized `:focus-visible` and disabled control styling for clearer keyboard/navigation affordances
- added visible pressed styling for `aria-pressed` controls (language switcher)
- fixed chat sidebar composition so the channel list is the scroll region and presence/voice/footer stay pinned in a stable bottom stack
- minimally restructured channel rows to align icon/name/badge and make active/live states clearer

Why:

- the web client needed calmer, more coherent visual hierarchy without changing any runtime behavior or product logic

### Mobile Web Load Fix (LAN access)

What changed:

- changed the web client default API and gateway URLs to derive from `window.location.hostname` (instead of hard-coded `localhost`) so mobile browsers loading the UI from another device resolve requests to the correct server host

Why:

- iOS/Safari reports cross-device fetch failures as `Load failed`, which surfaced in the UI when the client attempted to talk to `localhost` on the phone rather than the server running Baker

### Web UI Polish Stage 2 (Desktop + Mobile)

What changed:

- made mobile navigation first-class:
  - guild list becomes a horizontal top rail on narrow screens
  - channel list becomes horizontal scrollable chips with larger touch targets
  - presence/voice/account controls become a horizontal scroll rail so chat keeps vertical space
- calmed and unified voice + stream panel surfaces to better match the shared token system (reduced chroma and border noise)

Why:

- the web client needed to be genuinely usable on phones/tablets, not just accessible, while preserving all existing chat/voice/stream behavior

## 2026-04-16

### HTTPS domain voice-connectivity hotfix

What changed:

- `scripts/dev-up.ps1` now writes `output/dev/runtime-ports.json` containing resolved runtime ports (web/api/gateway/media/admin).
- `scripts/dev-https.ps1` now resolves upstream using runtime metadata first, then Vite web log parsing (`Local: http://localhost:<port>`), then PID listener inspection, and only then `.env` fallback.

Why:

- latest logs showed HTTPS reverse proxy routing to `127.0.0.1:80`, which could point at a stale dev server process injecting old `VITE_GATEWAY_URL=ws://<LAN-IP>:3102/ws`.
- external users loading the domain then failed gateway/voice connectivity (stuck at connecting / voice unavailable), while local access could appear partially functional.
- pinning Caddy upstream to the active web runtime port removes this stale-process trap and restores same-origin `wss` gateway behavior behind HTTPS.

### dev-up Docker startup resilience

What changed:

- `scripts/dev-up.ps1` now checks Docker engine readiness before `pnpm infra:up`.
- when Docker engine is not ready, the script will best-effort auto-start Docker Desktop (if found in common install paths) and wait up to 120 seconds for engine readiness.
- stale saved PIDs that are already gone are now logged as skip messages instead of noisy warnings.

Why:

- startup frequently failed with `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine` when Docker Desktop was not yet running.
- users interpreted stale-PID warnings as fatal errors even though they are harmless in normal restarts.

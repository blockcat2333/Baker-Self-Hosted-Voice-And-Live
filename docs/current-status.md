# Current Status

## Branch Goal

Milestone 5 quality hardening plus a first real security-hardening and self-hosted deployment pass for the new server control plane and media boundary, with multi-stream livestreaming stable, quality controls implemented, per-user voice link quality fanout in place, admin-managed server/workspace settings available, and a smoke-tested Docker Compose deployment path now in place.

## Milestone State

- `Milestone 1`: complete and validated
- `Milestone 2` slice 1: complete and validated
- `Milestone 2` slice 2: complete and validated
- `Milestone 2` slice 3: complete and validated
- `Milestone 2` slice 4: complete and validated
- `Milestone 3`: complete and validated
- `Milestone 4`: redesign complete and validated
- `Milestone 5` Phase 1 stability cleanup: complete and validated
- `Milestone 5` Phase 2 slice 1 account/profile UX: complete and validated
- `Milestone 5` Phase 2 slice 2 voice/audio controls: complete and validated
- `Milestone 5` Phase 2 slice 3 stream audio/controls: complete and validated
- livestream quality controls: complete and validated
- server control panel baseline: complete and validated
- M5 revised stability/UX slice (server RTT + voice roster visibility + bitrate + auth recovery): complete and validated
- M5.2 revised slice (per-user voice network quality + connection/UI fixes): complete and validated
- self-hosted Docker Compose baseline: complete and validated
- prebuilt-image self-hosted Docker path: complete and validated

## Recently Completed

### 2026-04-18 Self-Hosted Docker Compose Baseline

- expanded `docker-compose.yml` from infra-only services into a first-party self-hosted stack covering:
  - `postgres`
  - `redis`
  - `migrate`
  - `api`
  - `gateway`
  - `media`
  - `proxy`
  - optional `turn`
- added `.env.selfhost.example` so public users have a deploy-focused env template instead of reverse-engineering local dev settings
- added a multi-stage `Dockerfile` that:
  - builds the Node services into a shared runtime target
  - builds the web and admin frontends into a Caddy-served proxy target
- added `docker/Caddyfile` so the shipped stack serves:
  - user Web UI on port `80`
  - admin panel on port `8080`
  - `/v1` and `/health` through the API
  - `/ws` through the gateway
- changed Postgres and Redis host bindings to `127.0.0.1` by default so the public-facing surface is the proxy, not raw infra ports
- fixed compose/runtime blockers discovered by real container smoke tests:
  - `gateway` and `media` were missing production secret env vars required by shared env parsing
  - workspace packages still use source-first entrypoints in the repo for local DX, so the Docker runtime now rewrites the needed package manifests to built `dist/*` files inside the image
  - Docker `up --build` was exporting multiple services to the same image tag, which caused BuildKit snapshot conflicts on Windows
  - Caddy route ordering initially let SPA fallback swallow `/health`, so route handling was locked with explicit `route` blocks
- updated the public `README.md` so GitHub visitors now see a real Docker-first self-hosted quick-start before local dev instructions

### 2026-04-19 Prebuilt Docker Image Delivery Pass

- split the self-hosted compose story into:
  - `docker-compose.yml` for pulling published runtime images
  - `docker-compose.build.yml` for local source builds
- added a `bootstrap` service plus `docker/runtime/*` scripts so first boot now:
  - auto-generates strong persisted runtime secrets
  - auto-generates an admin-panel password
  - prints the admin URL/password through `docker compose logs bootstrap`
- moved the runtime helper scripts into the shipped images themselves so the public compose path no longer depends on bind-mounting repo files into `bootstrap`, Postgres, migration, API, gateway, or media containers
- changed the default host ports to:
  - Web on `3000`
  - Admin on `3001`
  so Docker Desktop / local-machine startup avoids common `:80` bind failures
- removed the old "copy `.env` and manually fill secrets before startup" requirement for the default quick-start path
- added `.github/workflows/publish-images.yml` so GitHub Actions can publish the runtime images to GHCR automatically and optionally to Docker Hub when repo secrets are configured
- updated `.env.selfhost.example` and `README.md` so public users now see:
  - `docker compose up -d` as the fastest path
  - `.env` as an optional advanced override, not a mandatory first-run step
  - Docker Hub mirroring as the searchable-image path for Docker Desktop discovery

### 2026-04-18 Open-Source Publication Prep

- audited the tracked repository contents for personal identifiers, local-only artifacts, and public-release blockers
- replaced personal-looking example values with neutral placeholders such as `demo.example.com` and `long.username@example.com`
- rewrote the root `README.md` into a public-facing bilingual introduction (English + Simplified Chinese)
- selected `AGPL-3.0` for the public release and added the Baker name-origin note to the bilingual `README.md`
- added open-source collaboration docs and GitHub defaults:
  - `CONTRIBUTING.md`
  - `SECURITY.md`
  - `CODE_OF_CONDUCT.md`
  - `.github/ISSUE_TEMPLATE/*`
  - `.github/pull_request_template.md`
- confirmed that current tracked files do not contain the local git author email or workspace path
- identified one release blocker outside the working tree: the existing local git history contains personal author metadata, so public publication should use a fresh initial commit instead of pushing the current history directly

### 2026-04-18 Popup Livestream Audio Playback Fix

- fixed a popup livestream playback regression where watched streams could stay silent even when the broadcaster shared system audio successfully
- root cause: popup playback always started with `video.muted = true`, and if the remote audio track arrived after the initial video attach the popup stayed muted without retrying audible playback
- fix: popup viewers now try autoplay with audio first when a live audio track is present, fall back to muted autoplay only when the browser blocks autoplay-with-audio, and retry audible playback when audio tracks arrive later on an already-muted popup stream
- added regression coverage for:
  - popup autoplay preferring audio when an audio track exists
  - muted fallback when autoplay-with-audio is blocked
  - muted autoplay remaining the default for video-only popup playback

### 2026-04-18 Security Hardening Pass (media internal auth + session-backed auth validation)

- hardened the media control-plane boundary so `/v1/internal/media/*` routes now require a shared internal secret instead of being callable anonymously
- gateway-originated media session bootstrap now sends the internal secret explicitly when creating publish/watch sessions
- added production env guards that now reject unsafe bootstrap defaults for:
  - `ADMIN_PANEL_PASSWORD`
  - `JWT_ACCESS_SECRET`
  - `JWT_REFRESH_SECRET`
  - `MEDIA_INTERNAL_SECRET`
- API auth now validates that the referenced `auth_session` still exists and is not revoked, instead of trusting JWT signature/expiry alone
- gateway `system.authenticate` now also rejects access tokens whose backing `auth_session` is missing or revoked
- added authenticated `POST /v1/auth/logout` so logout revokes the durable auth session plus all refresh tokens tied to that session
- web auth tokens now persist in `sessionStorage` instead of `localStorage`
- the admin control panel no longer persists the management password in browser storage; it now stays in memory only for the active page session
- upgraded `fastify` and `drizzle-orm` to patched versions and re-ran dependency audit with no remaining production vulnerabilities
- validated the hardening with real browser checks:
  - user tokens are absent from `localStorage`
  - user tokens are cleared from `sessionStorage` after logout
  - page reload after logout stays unauthenticated
  - admin login no longer writes `baker_admin_password`
  - admin logout + reload returns to the password gate

### 2026-04-18 Screen-Share Audio Windows Mute Hotfix

- fixed a livestream regression where starting a screen share with shared system audio could immediately mute the broadcaster's Windows system output
- root cause: screen-share capture always requested `getDisplayMedia(...audio.suppressLocalAudioPlayback = true)`, which is intended as a browser-level feedback guard but, on Windows desktop capture, can suppress the host machine's own system playback entirely
- fix: removed forced local-playback suppression from screen-share capture constraints while keeping the existing browser echo/noise/gain audio hints
- added regression coverage so screen-share capture constraints no longer request `suppressLocalAudioPlayback`

### 2026-04-18 Voice Reconnect / Roster Fanout Hardening

- fixed a voice reconnect state regression where locally muted users could rejoin with UI/server state reset to `unmuted` even though their preserved local audio track stayed disabled
- voice reconnect now preserves the user's local mute intent, reapplies that mute state to the preserved mic/send tracks, and resyncs `voice.speaking.updated` to the gateway after rejoin so roster state and UI stay aligned
- fixed `peer_join` sound cues so all existing room participants hear a join cue when a new peer appears, not just the side that also happens to initiate the new WebRTC offer
- hardened gateway voice-roster fanout by caching authenticated guild visibility on each connection and using that cache during `voice.roster.updated` broadcasts instead of doing per-connection membership DB lookups on join/leave/mute
- added regression coverage for:
  - preserved mute state across gateway reconnect
  - peer join cue behavior when this client is not the offer initiator
  - roster fanout using cached guild visibility instead of per-connection membership lookups

### 2026-04-18 Workspace Residue Cleanup (Codex / Claude local artifacts)

- removed tracked local-tool residue from the repo working set:
  - `.claude/settings.local.json`
  - `.claude/worktrees/*`
  - `.npm-cache/*`
  - `.playwright-cli/*`
  - `__codex_patch_test__.txt`
- expanded `.gitignore` to keep local-only agent residue out of Git:
  - `.claude/settings.local.json`
  - `.playwright`
  - `__codex_patch_test__.txt`
- deleted local workspace residue directories produced during prior agent/tool runs:
  - `.claude/worktrees`
  - `.npm-cache`
  - `.playwright`
  - `.playwright-cli`
  - `.codex-dev*.log`
  - `download/`
  - `scripts/sidebar-screenshots/`
  - `test-results/`
- attempted full `output/` cleanup; old removable artifacts were deleted, but `output/dev` still contains the current live run's logs and `caddy.exe`, which are locked by active processes and therefore not fully removable until those processes stop

### 2026-04-18 UI Hardening Pass — Account Panel Overflow Fix + Layout Hardening + i18n

**Primary fix — sidebar footer / account panel overflow (blocking visual bug):**
- the Edit button was pushed completely outside the sidebar and overlapping the message area when the username or email was long (e.g. `long.username@example.com`)
- root cause: `.account-panel` used `display: grid` with no explicit column template, and `.account-panel-edit-btn` had `min-width: 72px` + `flex-shrink: 0`, so grid auto-sizing let children exceed the container width
- fix: switched `.account-panel` to `display: flex; flex-direction: column` with `min-width: 0; overflow: hidden`, removed rigid `min-width: 72px` from Edit button in favor of `white-space: nowrap`, added `min-width: 0` to `.account-panel-header`
- removed mobile breakpoint `min-width: 48px` on `.account-panel-edit-btn`
- verified via Playwright at 700/768/820/900/1280px in both EN and ZH — zero overflow warnings across all 10 viewport/language combinations
- screenshots captured to `scripts/sidebar-screenshots/` for evidence

**Additional layout hardening:**
- added `min-width: 0` to `.stream-watch-row-summary > div:first-child` and `.stream-section-header > div:first-child` to prevent long usernames from overflowing stream watch rows (same pattern as the existing `.stream-card-header > div:first-child` fix)

**i18n completeness fixes:**
- localized hardcoded English "Text" / "Voice" channel section headers in `ChannelList.tsx` using new `chat.section_text` / `chat.section_voice` i18n keys (EN + ZH)
- localized hardcoded voice network diagnostic labels ("GW RTT", "GW Loss", "Media Loss", "stale", "local") in `VoicePanel.tsx` using new `voice.net_label_*` i18n keys (EN + ZH)
- added overflow/truncation handling to `chat-main-title` (server name) to prevent long names from breaking the chat header
- added overflow/truncation handling to `stream-card-title` and `stream-card-subtitle` to prevent long usernames or quality labels from pushing stream card layouts
- added `min-width: 0` to the first child of `stream-card-header` so text truncation works within the flex container

### 2026-04-16 Stream Viewer Stats + Screen-Share Send Preferences

**Client / SDK (`packages/client`, `packages/sdk`)**

- popup livestream viewers now render a live WebRTC stats panel beneath the volume slider, showing codec, resolution, frame rate, bitrate, packet loss, jitter, and dropped frames from the active recv-only watch session
- watched-stream stats are sampled from the existing popup watch runtime without persisting high-frequency telemetry into shared client state
- screen-share capture now marks outbound video tracks with `contentHint = 'detail'`
- publish offers now apply sender `degradationPreference` in addition to the existing best-effort bitrate cap; the current default is `balanced`
- broadcasters now see a live health panel on `Your Stream`, including target/send FPS, bitrate, resolution, preferred codec, negotiated send codec, limitation reason, active peers, and a best-effort local encoder-limited indicator
- pre-publish livestream controls now include a best-effort codec preference selector (`Browser Default`, `H.264`, `VP8`, `VP9`, `AV1`) that feeds publish-time WebRTC codec preference ordering without changing protocol/gateway contracts
- added regression coverage for screen-share `contentHint`, sender-offer preference wiring, codec preference plumbing, and broadcaster diagnostics stats aggregation

### 2026-04-16 Follow-up Hotfix (External Voice/Stream Media Path)

**Scripts**
- `scripts/dev-up.ps1` TURN external-IP resolution is now hardened for public-domain deployments:
  - resolves public relay IP from `-TurnHost` DNS first, then falls back to public-IP detection
  - rejects private `TURN_EXTERNAL_IP` when `-TurnHost` is public (fails fast instead of silently using LAN IP)
  - orders generated `TURN_URLS` with public hostname first to prevent external clients preferring LAN-only relay endpoints
- this removes the previous silent failure mode where signaling succeeded but media (voice audio / stream watch) failed because TURN advertised private relay addresses to internet clients.

### Startup Reliability Hardening (Docker readiness)

**Scripts**
- `scripts/dev-up.ps1` now validates Docker engine readiness before infra startup.
- when engine is unavailable, it now best-effort launches Docker Desktop and waits (up to 120s) before failing with a clear action message.
- when Docker Desktop is alive but backend stays in `starting` (`_ping` timeout / API-version route 500), startup now triggers one automatic recovery attempt (`restart Docker Desktop + wsl --shutdown`) before failing with explicit remediation.
- stale saved PID cleanup now prints a non-fatal skip line when a process is already gone (instead of warning noise).

### M5.2 Revised Slice (Per-User Voice Link Quality + Connection/UI Fixes)

**Protocol / Gateway (`packages/protocol`, `apps/gateway`)**

- added `voice.network.self_report` command and `voice.network.updated` event contracts
- gateway now tracks per-connection link quality (`gatewayRttMs`, rolling `gatewayLossPct`) from websocket heartbeat sampling
- clients now report local media self-loss to gateway; gateway merges and broadcasts per-user snapshots to same-channel participants
- gateway now emits `voice.network.updated` on voice join/leave/mute/disconnect and self-report updates
- websocket handling hardened with close-event reconnect path + handshake-timeout fallback to avoid sticky `connecting` states

**Client (`packages/client`, `packages/sdk`)**

- `WebRtcManager` now provides local outbound stats sampling for media self-loss computation
- voice store now computes local media loss periodically, throttles `voice.network.self_report`, and blocks `voice.join` when gateway is not `ready`
- voice panel now renders per-user second-line network metrics:
  - `GW RTT xxms · GW Loss yy% · Media Loss zz%`
  - `0ms/0%` is always shown when value is zero
- voice channel roster UI is now containerized (background/border/radius/padding/clip) instead of bare text
- stream quality controls are now single-column vertical to avoid cramped horizontal controls
- participant slider overflow protection hardened (`min-width: 0`) to avoid controls spilling outside the voice panel

### M5 Revised Stability + UX Slice (RTT, voice roster visibility, bitrate, auth recovery)

**Protocol / Gateway (`packages/protocol`, `apps/gateway`)**

- added `voice.roster.updated` event contract and gateway broadcast/snapshot paths
- gateway now pushes voice roster snapshots at auth time and after voice join/leave/mute/disconnect changes so non-joined users can still see who is in each voice channel
- stream quality contract now includes fixed `bitrateKbps` values and `1440p`
- stream-start quality metadata persistence now includes bitrate

**Client (`packages/client`, `packages/sdk`)**

- unified voice latency display to one metric: local-to-server RTT from gateway `ping`/`pong`, shown for all participants
- `0ms` is now rendered explicitly (not hidden)
- voice participant rows are now two-line (name/status on line 1, latency on line 2) to avoid long-ID squeezing
- fixed voice participant volume slider overflow with layout constraints (`min-width: 0`, slider width/overflow fixes)
- voice channel list now renders live full member rosters even when the user has not joined that voice channel
- added voice sound cues for mute/unmute and self/peer join/leave
- stream panel now includes fixed bitrate selector and `1440p`; owned stream quality label now shows resolution + fps + bitrate
- publish path now best-effort applies bitrate to sender parameters via `RTCRtpSender.setParameters().encodings[].maxBitrate`
- added auth bootstrap guard (`me -> refresh -> me`) before entering chat/gateway auth to avoid "authenticating..." stalls with expired access tokens

**Startup scripts / docs**

- `scripts/dev-up.ps1` now prints a clear open-port checklist with protocol type (TCP / UDP / TCP+UDP), including TURN entry and relay ranges
- personal one-click startup values are now documented in `docs/dev-test-personal-config.md` and template file `dev-test.local.env.example`

### Cross-Network Voice/Stream TURN Runtime Fix (dev-test)

**Infrastructure (`docker-compose.yml`, `scripts/dev-up.ps1`)**

- fixed a TURN startup bug in `docker-compose.yml`: the coturn startup command was being tokenized/truncated by Compose variable interpolation, leaving the container in a restart loop (`baker-turn` never became healthy)
- switched TURN container startup to a robust `/bin/sh -ec` script with escaped runtime env variables (`$$TURN_*`), explicit env pass-through, and safe optional `TURN_EXTERNAL_IP` handling
- updated `scripts/dev-up.ps1` TURN external-IP defaulting: when `-TurnHost` looks public (e.g. `demo.example.com`) it now auto-detects and uses the public IPv4 for `TURN_EXTERNAL_IP`; local/LAN hosts still default to LAN IP
- added TURN container readiness checks in `scripts/dev-up.ps1`; if coturn cannot stay running, startup now emits a warning and tails recent `docker logs` instead of silently continuing
- added `output/dev/turn-runtime.json` output on successful TURN startup so the active relay host/port/range are explicit for ops and troubleshooting
- fixed a PowerShell runtime regression in `dev-up.ps1`: helper function parameter used `host`, which collides with read-only automatic variable `$Host`; this caused `dev-test.bat` startup to fail right after TURN config logging

### WebRTC / Voice No-Audio Root-Cause Fix (M5 Bug Hunt)

**Infrastructure (`docker-compose.yml`, `scripts/dev-up.ps1`)**

- removed `--no-loopback-peers` from the coturn command in `docker-compose.yml` — this flag was silently blocking relay to loopback-range addresses during same-machine local testing
- changed `TURN_EXTERNAL_IP` auto-detection in `dev-up.ps1` from the public IP to the LAN IP (`$primaryIp`): coturn running in local Docker now advertises relay ports at the LAN IP, which local browsers can reach without NAT hairpinning; the old public-IP default caused TURN relay to silently fail on home/LAN networks that do not support hairpin NAT
- prepended `turn:${primaryIp}:${turnPort}` entries to `TURN_URLS` when `-TurnHost` is provided: local peers now try the LAN IP first (direct path, no hairpin needed) before falling back to the external hostname; this unblocks voice/stream on same-machine and same-LAN tests where coturn was reachable via the LAN IP but not via the public hostname

**Client (`packages/client`)**

- fixed audio autoplay blocking: `new Audio()` elements for remote voice peers are now attached to `document.body` (hidden) before `play()` is called; Chrome's autoplay policy blocks `play()` on detached audio elements, so previously the remote audio would silently fail even when ICE connected
- added `detachRemoteAudio()` helper that pauses, clears `srcObject`, and removes the element from the DOM — used in all teardown paths (`teardown`, `teardownPeersForReconnect`, per-peer cleanup in `handleVoiceStateUpdated`, and the `end` signal in `handleMediaSignal`)
- added try/catch around `addIceCandidate` and `handleAnswer` calls in `handleMediaSignal` — these were inside a `void (async () => {})()` IIFE with no error handling, so failures silently swallowed WebRTC errors that would have revealed ICE/SDP issues in devtools
- added per-peer `connectionState` tracking: `onPeerConnectionStateChange` now writes the state into `peerNetwork[userId].connectionState`; `VoicePanel` appends `[state]` after the RTT/loss label when the connection is not `connected`, giving immediate in-UI visibility into ICE negotiation progress/failures

### Auth Bootstrap Base-URL Fix (Blocking)

**Client (`packages/client`)**

- fixed a blocking auth bootstrap/origin mismatch where the browser client could end up sending `/v1/*` requests to the web origin (Vite HTML) or an incorrect default host/port, surfacing generic `Failed to fetch` / JSON parse errors during login/register
- `AppRoot` now defaults to same-origin API calls in browsers (reverse-proxy friendly) while keeping explicit override via `apiBaseUrl` / `VITE_API_BASE_URL`; non-http origins (Electron `file://`) fall back to the legacy `:3001` / `:3002` defaults
- hardened the SDK HTTP client JSON parsing so empty/non-JSON responses surface as actionable errors (e.g. `Empty response from server` or `Invalid JSON response ... content-type: text/html`) instead of `Unexpected end of JSON input`
- `LoginView` now surfaces bootstrap errors (public-config fetch failures) inline, so misrouted auth requests show a concrete cause instead of only `Failed to fetch`
- added a Vite dev-server proxy for `/v1` and `/health` (targets `API_HOST`/`API_PORT`) so local web dev can use same-origin API calls without CORS or incorrect-origin issues
- changed the default gateway websocket URL derivation to prefer same-origin `/ws` in browsers, and added a Vite dev proxy for `/ws` to the gateway (HTTPS/proxy friendly; avoids mixed-content when the page is served over HTTPS)
- added `scripts/dev-https.ps1` to run an HTTPS reverse proxy (Caddy) in front of the web dev server so mobile mic/voice works under a secure context
- fixed `GatewayClient` to queue outbound commands while the websocket is CONNECTING (prevents `WebSocket.send` CONNECTING-state errors when users click voice quickly after login)
- added a regression unit test for default URL derivation plus `scripts/auth-smoke.mjs` for quick local register → logout → login validation
- hardened `scripts/dev-up.ps1` to auto-pick usable `API_PORT`/`GATEWAY_PORT`/`MEDIA_PORT` when Windows has `3001–3003` in the excluded port range (prevents `listen EACCES` and downstream auth failures)
- hardened server env parsing so `MEDIA_INTERNAL_URL` derives from `MEDIA_PORT` when unset (prevents gateway voice-join failures when only the media port changes)
- fixed the admin control panel (`apps/admin`) dev bootstrap so it no longer assumes `http://localhost:3001`; it now uses same-origin `/v1/*` calls with a Vite proxy (prevents `Failed to fetch` when the API port is auto-shifted to `31xx`)
- `scripts/dev-up.ps1` now reads the persisted `webPort` from `/v1/meta/public-config` after the API is healthy and starts the web dev server on that port (makes admin port changes effective after a restart)
- improved WebRTC ICE defaults and visibility: default `STUN_URLS` now includes multiple endpoints, media logs the loaded ICE config, gateway logs whether TURN is present; `scripts/dev-up.ps1` now forwards `STUN_URLS`/`TURN_*` from `.env` into dev services so cross-network voice/stream can be stabilized with a TURN relay
- added an optional local TURN relay to `docker-compose.yml` (`baker-turn`, coturn) and added `scripts/dev-up.ps1 -EnableTurn -TurnHost <public-host>` to start it; the script auto-selects a usable `TURN_PORT` on Windows where `3478` may be excluded/reserved
- voice participants now show best-effort network stats (RTT + packet loss) inline (derived from `RTCPeerConnection.getStats()`)
- hardened realtime recovery on flaky networks: gateway reconnect now keeps voice/stream UI state and attempts to rejoin/re-watch automatically after re-auth; WebRTC peers request `restart_ice` on `disconnected/failed` to recover without a full leave/join

### Mobile Voice Bug Fix + UI Polish Stage 3

**Client (`packages/client`)**

**Voice error visibility (blocking bug — now fixed):**
- voice join failures (insecure HTTPS context on mobile HTTP, mic denied, gateway not connected) previously set `status: 'error'` silently — `VoicePanel` returned `null` for error state and `ChatShell` didn't mount `VoicePanel` for error state, so users got no feedback
- added `getMicUnavailableReason()` guard before `getUserMedia` to immediately surface `insecure_context` error when `navigator.mediaDevices` is unavailable (HTTP on mobile)
- `VoicePanel` now renders a visible error card with localized message and dismiss button for all three failure modes: insecure context, mic denied, not connected
- `ChatShell` now mounts `VoicePanel` for `status === 'error'` so the error state is always visible
- added `clearError()` to voice store to dismiss the error card and return to idle
- added five new i18n keys for voice error messages in English and Simplified Chinese

**Mobile layout (sidebar strip down from 232px → 71px):**
- removed the always-visible `account.username_change_hint` paragraph from `AccountPanel` non-edit view
- `sidebar-footer` is now a flex column with a `sidebar-footer-actions` inner row grouping language switcher + sign-out horizontally at all screen sizes
- mobile sidebar-bottom: full horizontal scroll rail, all controls compact; channel section labels hidden in chip layout
- chat area height on mobile went from 432px (y=380) to 681px (y=131) — 58% more vertical space for messages

**Desktop/tablet sidebar footer:**
- language switcher and sign-out button now share a compact horizontal row (no longer full-width stacked)
- `btn-ghost` global width changed from `100%` to `auto`; full-width restored only where needed (login form)
- `sidebar-footer` uses flex-column layout with `sidebar-footer-actions` as the inner row

**Channel list section headers:**
- channels now split into Text / Voice groups with labeled section headers in the desktop/tablet sidebar
- section labels are hidden in mobile chip layout
- voice channel icon changed from 'V' to '◉' to better differentiate from text channels

**Message grouping:**
- consecutive messages from the same author within 5 minutes are now grouped — repeated author+timestamp header is suppressed for follow-up messages
- message items use tighter row padding with hover highlight instead of fixed gaps between all items
- `message-panel` min-width changed from `360px` to `0` (fixes horizontal scroll on narrow mobile)

**Playwright visual audit:**
- `scripts/ui-audit.mjs` captures screenshots across 5 device sizes with layout measurements
- auth injection fallback for offline API validation

### Web UI Polish Stage 1 (Web client)

**Client (`packages/client`)**
- introduced a small CSS token system in `app.css` (surfaces/borders/text/radii/focus)
- normalized `:focus-visible`, disabled, and pressed (`aria-pressed`) UI states for clearer keyboard and control feedback
- fixed sidebar composition so channels are the scrollable region and presence/voice/footer stay pinned as a stable bottom stack
- aligned channel rows (icon/name/badge) and improved active/live state clarity without changing runtime behavior

### Mobile Web Load Fix (LAN access)

**Client (`packages/client`)**
- fixed the default API + gateway base URLs to derive from `window.location.hostname` instead of hard-coded `localhost` so opening the web client from a phone/tablet on the LAN no longer fails with a generic `Load failed` fetch error

### Web UI Polish Stage 2 (Desktop + Mobile)

**Client (`packages/client`)**
- improved small-screen layout: guild list becomes a top rail and channels become horizontal chips for touch-friendly navigation
- prevented sidebar bottom surfaces (presence/voice/account controls) from pushing chat off-screen by turning them into a horizontal scroll rail on mobile
- calmed and unified voice/stream surfaces to better match the shared token system without changing runtime behavior

### Phase 1 Bug-Hunt Pass 2

**Voice channel switch without leaving old channel (ghost participant + orphaned WebRTC)**

**Client (`packages/client`)**
- fixed `joinVoiceChannel` so switching voice channels while already active now sends `end` signals to all current peers before teardown (mirrors `leaveVoiceChannel` behavior)
- added a best-effort `voice.leave` for the old channel to the gateway before starting mic capture for the new channel — prevents ghost participants and stale room state from persisting on the gateway side
- added `voice-store.test.ts` regression coverage verifying that switching channels sends `end` to peers and `voice.leave` for the old channel

**Popup watch lifecycle cancel race (orphaned WebRTC runtime)**

**Client (`packages/client`)**
- fixed a race in `unwatchStream` where `cancelledWatchRequests.delete(streamId)` ran in the `finally` block after the `stream.unwatch` ACK, which could clear the cancel flag before the in-flight `stream.watch` ACK resumed and checked it — the gap allowed `watchStream` to complete normally and create an orphaned runtime with no UI state
- removed `cancelledWatchRequests.delete(streamId)` from `unwatchStream`'s `finally` block so the cancel flag remains until `watchStream` detects and consumes it
- added `cancelledWatchRequests.delete(streamId)` to the `stream.watch` ACK failure path and the null-userId path in `watchStream` to prevent stale entries on the rare early-exit cases
- added `stream-store.test.ts` regression coverage for the race scenario where unwatch completes before the watch ACK arrives

### Phase 1 Bug-Hunt Pass 1

**Voice store lifecycle on gateway disconnect (resource leak + stale UI)**

**Client (`packages/client`)**
- added `handleGatewayDisconnected()` to the voice store interface and implementation — calls the existing `teardown()` helper then resets all runtime state to `idle`, preserving local user preferences (inputVolume, playbackVolume, participantPlaybackVolume)
- gateway store now calls `useVoiceStore.getState().handleGatewayDisconnected()` in both the explicit `disconnect()` path (logout) and the `onError` reconnect path (network drop)
- before this fix, logging out or losing the network connection while in a voice channel left the mic capture stream running, audio contexts open, and WebRTC peer connections alive — a real resource leak — and after reconnect the voice panel still showed the user as "active" in the channel with dead connections
- added two regression tests to `gateway-store.test.ts` verifying the voice store is reset on explicit disconnect and on connection error

**Admin app auto-login error handling (AdminApp.tsx)**
- separated auth verification failure from dashboard load failure in the auto-login `useEffect`
- when the stored password fails auth verification (e.g., admin rotated the password), the invalid password is now cleared from localStorage and the input is reset so the login form does not silently pre-fill with a broken credential
- when auth succeeds but `loadDashboard()` fails (e.g., API temporarily unavailable), the user remains authenticated and the error is surfaced in the dashboard error area instead of being swallowed
- applied the same error separation to the `handleLogin()` form submission path so auth failure and dashboard failure show distinct, correct feedback

### Popup Playback Hotfixes

**Client (`packages/client`)**
- popup livestream startup now falls back out of indefinite `Starting livestream video...` waits
- popup autoplay now uses pause recovery and muted fallback so live video keeps rendering under browser autoplay restrictions
- automatic unmute retry loops were removed so Chrome no longer pauses the popup video repeatedly before user gesture

### Livestream Quality Controls

**Protocol / Gateway / DB**
- `stream.start` now accepts optional quality settings for resolution, frame rate, and bitrate
- gateway persists requested quality into `stream_sessions.metadata`
- repository and in-memory test paths now preserve quality metadata instead of dropping it

**Client (`packages/client`)**
- `StreamPanel` now lets the broadcaster choose `480p` / `720p` / `1080p` / `1440p`, `15` / `30` / `60` fps, fixed bitrate presets, and a best-effort codec preference before starting screen or camera capture
- selected quality flows into browser capture constraints and is reflected on the active owned-stream card; codec preference remains client-local and feeds publish-time WebRTC negotiation only

### Voice Participant Inline Volume Sliders

**Client (`packages/client`)**
- each remote voice participant now shows an inline local playback-volume slider under the display name
- this reuses the existing per-participant local volume state and does not change voice protocol or gateway behavior

### Voice Mute Speaking-State Fix

**Client (`packages/client`)**
- voice mute now stops local speaking detection from continuing to report `speaking=true`
- speaking detection now prefers the actual outbound send stream instead of the raw capture stream
- muting immediately clears the local speaking indicator and prevents muted clients from re-lighting their speaking state while still muted

### Server Control Panel Baseline

**Protocol / API / DB**
- added public/admin system HTTP contracts for:
  - public server config
  - admin password verification
  - server settings read/update
  - admin-managed user creation
  - admin-managed channel creation/update
- added durable `server_settings` storage for:
  - server name
  - public registration enabled/disabled
  - web enabled/disabled
  - configured web/app ports
  - hashed management password
- added persisted `voiceQuality` on channels so the control panel can manage per-channel voice quality settings
- public registration now respects the persisted server setting and returns `403` when self-registration is disabled

**Web / Client**
- the web client now loads public server config before rendering auth/chat
- the login screen hides registration when public registration is disabled
- the shared chat shell now shows the admin-configured server name in the top header
- the web client default dev port is now `80`

**Admin Panel (`apps/admin`)**
- added a dedicated admin-only web app on a separate port (`ADMIN_PORT`, default `5180`)
- the control panel requires the management password before loading server settings
- the bootstrap default management password is now `admin`, and untouched legacy default hashes are auto-migrated on first access
- admins can:
  - change server name
  - enable/disable public registration
  - enable/disable the web client
  - update stored web/app port settings
  - rotate the management password
  - create users when self-registration is disabled
  - create text/voice channels
  - rename channels
  - set per-channel voice quality

**Current Runtime Boundary**
- channel `voiceQuality` is currently an admin-managed persisted channel setting and is exposed through channel data
- it does not yet change live voice media bitrate/codec behavior in the current P2P voice runtime

### Bilingual UI (English + 简体中文)

**Client + Admin**
- added i18n infrastructure plus in-UI language switchers
- translated web client UI and server control panel UI between English and Simplified Chinese
- language selection persists in `localStorage` (`baker_language`)

## Validation

Latest full validation run:

- `pnpm typecheck` pass
- `pnpm lint` pass
- `pnpm test` pass (93 tests)
- `pnpm audit --prod` pass
- Docker self-hosted smoke validation pass:
  - `docker compose --env-file output/selfhost-smoke.env up -d --build`
  - `docker compose --env-file output/selfhost-smoke.env ps`
  - host checks passed for `http://127.0.0.1:18080/`, `http://127.0.0.1:18081/`, and proxied `/health`
- real browser validation pass:
  - web auth storage + logout behavior
  - admin password storage + logout behavior

Open-source publication prep validation:

- targeted tracked-file scan for email addresses, local user paths, private keys, token-like strings, and custom domains: pass after placeholder cleanup
- existing tracked working tree is suitable for a public snapshot
- existing local git history is not suitable for direct publication because it includes personal author metadata

## Current Blockers

- workspace residue cleanup is complete except for the currently locked `output/dev` runtime files held open by active processes
- the local private development history is still not suitable for direct publication because it contains personal author metadata; any future public-history refresh should continue to use a fresh initial commit
- searchable Docker Desktop deployment is still pending Docker Hub credentials/secrets so `.github/workflows/publish-images.yml` can mirror the runtime images there

## Known Gaps

- `apps/media` is still `NoopMediaAdapter`; there is no real SFU/media backend
- voice and stream rooms are in-memory only, so multi-instance support is deferred
- room streaming is P2P and intentionally small-room only
- desktop/Electron is still not validated end-to-end
- admin-configured web/app ports are persisted and surfaced through the API/control panel, but changing them does not hot-restart services automatically
- channel `voiceQuality` is stored and manageable from the control panel, but it is not yet wired into actual voice media quality controls
- the admin panel still uses one shared management password rather than per-admin identities or RBAC

## TODO

- admin-account / RBAC design to replace the current shared management password model
- cookie-based refresh-token storage if/when the product is ready to tighten browser session handling further
- TURN / media-adapter hardening beyond the current internal-secret gate
- explicit guild/channel lifecycle beyond the current shared starter workspace
- Desktop shell end-to-end validation

## Next Recommendation

A Git snapshot is recommended after this bug-hunt pass.

Recommended next work:

1. Deployment finish: configure Docker Hub mirroring secrets and publish the self-contained runtime images so Baker becomes directly searchable in Docker Desktop
2. Quick hardening: replace the shared admin password model with explicit admin identities / revocable sessions
3. Medium feature work: move refresh-token handling toward `HttpOnly` cookies while keeping deployment simplicity
4. Larger architecture/product work: TURN / real media-adapter hardening beyond the current internal-route secret gate

## Risk List

- `apps/media` is still a placeholder boundary
- room registries are in-memory only
- stream and voice remain P2P instead of SFU-backed
- screen-share audio behavior still depends on browser-specific `getDisplayMedia` system-audio handling; local playback suppression is intentionally not requested because it muted Windows system output during livestream start
- popup creation can still be blocked by browser popup policies if the watch action is not treated as a direct user gesture
- temporary single-stream compatibility fallback still remains at the protocol/gateway boundary until old clients are no longer needed
- starter guild + `general` onboarding behavior remains temporary technical debt
- admin panel authentication is hardened but still uses a shared management password rather than per-admin user accounts or RBAC

## 2026-04-16 Hotfix: External Voice Connectivity via HTTPS Domain

- Root cause: `scripts/dev-https.ps1` could fall back to `127.0.0.1:80` when it could not infer the real web dev port from `pids.json` (which stores `cmd.exe` wrapper PIDs, not the actual Vite listener). In this failure mode, Caddy proxied to a stale web instance that still injected `VITE_GATEWAY_URL=ws://<LAN-IP>:3102/ws`, causing external users to stay in `connecting` and fail voice join.
- Fix: `scripts/dev-up.ps1` now writes `output/dev/runtime-ports.json` (resolved runtime ports), and `scripts/dev-https.ps1` now resolves upstream in this order:
  - `runtime-ports.json` `webPort`
  - web stdout log (`Local: http://localhost:<port>`) from `pids.json`
  - PID listener inspection
  - `.env` fallback
- Expected result: HTTPS reverse proxy now tracks the active Vite port (for example `3233`) and serves a client that uses same-origin gateway defaults (`wss://<domain>/ws`) instead of stale LAN `ws://` values.

# Baker Architecture

## Layering

### Client

- React rendering and UI state shared between Web and Desktop through `packages/client`
- auth, chat, gateway, voice, and stream stores live here
- the Web client now loads a public server-config document before rendering auth/chat so registration and branding can be gated by server settings
- browser capture and WebRTC peer logic stay in the client/sdk layer
- stream client state is now split between owned publish state and watched stream state keyed by `streamId`
- watched-stream popup windows are additional view documents rendered by the main React tree, not separate app/store/gateway runtimes
- popup livestream playback stays client-local: popup viewers now try autoplay with audio when the watched stream already has audio, fall back to muted autoplay only when the browser blocks audio autoplay, and retry audible playback if audio tracks arrive later
- voice audio controls (mic input gain, global playback volume, per-participant playback volume) are local client-state concerns and do not change protocol or gateway contracts
- stream audio capture controls are also client-local: camera streams now request audio capture and screen-share capture keeps browser echo/noise/gain constraints without forcing local-playback suppression, with no protocol or gateway contract changes
- stream quality selection is also client-owned: the broadcaster chooses resolution/frame-rate presets in the client, capture constraints are applied in-browser, and the chosen settings only travel through protocol/session metadata for orchestration and visibility
- stream quality selection now includes fixed bitrate presets plus a best-effort codec preference selector, and publish setup applies best-effort sender `maxBitrate`, sender `degradationPreference`, and publish-time codec ordering through browser WebRTC APIs
- watched-stream popup viewers now read live WebRTC receiver stats from the active watch runtime and render them locally in the popup UI; this telemetry is not persisted through protocol/gateway state
- broadcaster-side publish diagnostics also stay client-local: the `Your Stream` panel samples active sender stats in-browser and does not persist this telemetry through protocol/gateway state
- gateway RTT sampling (`ping`/`pong`) is maintained in client gateway state and used as the unified voice latency metric in UI
- voice link quality is now per-user: gateway computes websocket-link RTT/loss per connection, clients self-report local media-loss, and UI renders merged snapshots per participant
- voice-channel roster visibility outside active join state is shared client/gateway orchestration: gateway emits roster snapshots and client stores/render per-channel membership
- a separate `apps/admin` browser app provides the server control panel; it is a dedicated admin UI, not part of the end-user chat shell
- end-user browser auth tokens now live in `sessionStorage` instead of `localStorage`, and explicit sign-out revokes the active server-side auth session
- the admin control panel keeps the management password in memory only for the active page session; it is no longer persisted in browser storage

### API

- Fastify HTTP boundary
- owns durable business CRUD
- currently implements auth, guild, channel, message, public server-config, and admin control-plane flows
- access-token auth is session-backed: bearer-token acceptance now depends on the referenced durable `auth_session` still existing and not being revoked

### Gateway

- Fastify WebSocket boundary
- owns auth-on-connect, presence, subscriptions, message push, voice room state, stream room state, and signaling relay
- owns websocket heartbeat sampling and per-voice-participant network snapshot fanout (`voice.network.updated`)
- keeps runtime orchestration in managers rather than embedding business logic in raw socket handlers
- websocket authentication is also session-backed: `system.authenticate` rejects tokens whose backing durable session is missing or revoked

### Media

- media control-plane boundary
- currently still a `NoopMediaAdapter`
- intended future SFU integration point
- internal media routes are service-to-service only and now require `MEDIA_INTERNAL_SECRET`; they are not intended to be browser-accessible control-plane APIs

### Data

- PostgreSQL for durable data through `packages/db`
- Redis for presence/message fanout
- `stream_sessions` stores publisher-owned room stream session history/status
- `server_settings` stores singleton server-level configuration such as server name, public-registration flag, web/app ports, web-enabled flag, and the management-password hash
- `channels.voiceQuality` stores an admin-managed per-channel voice-quality setting

### Deployment Topology

- the primary newcomer deployment path is now the all-in-one `blockcat233/baker` image
- the all-in-one image bundles:
  - web/admin static assets
  - API, gateway, and media runtimes
  - PostgreSQL
  - Redis
  - Caddy
  - optional coturn
- the all-in-one container persists runtime secrets plus service data under `/var/lib/baker`
- Docker Compose remains the advanced self-hosted runtime topology
- the shipped advanced compose topology is:
  - `bootstrap`
  - `postgres`
  - `redis`
  - `migrate`
  - `api`
  - `gateway`
  - `media`
  - `proxy`
  - optional `turn`
- Caddy is the public edge in the default topology:
  - `:80` serves the user web app
  - `:8080` serves the admin panel
  - `/v1` and `/health` proxy to `apps/api`
  - `/ws` proxies to `apps/gateway`
- the default host bindings are now `:3000 -> :80` for Web and `:3001 -> :8080` for Admin so local Docker Desktop startup avoids common port-80 collisions; operators can still override them through `.env`
- Postgres and Redis bind to `127.0.0.1` on the host by default so the exposed surface is the proxy tier rather than raw infra ports
- the default `docker-compose.yml` is now registry-first and pulls `baker-runtime` plus `baker-proxy`; `docker-compose.build.yml` re-enables local source builds for contributors and validation, and the standalone `baker-runtime` image now prints a Compose-first hint when launched by itself
- first boot now runs a dedicated `bootstrap` container that writes persisted runtime secrets/admin credentials into a Docker volume consumed by the service containers
- the image publish workflow targets GHCR by default and can optionally mirror `baker`, `baker-runtime`, and `baker-proxy` to Docker Hub for Docker Desktop search/discovery
- the all-in-one image keeps TURN disabled by default and only starts coturn when `TURN_ENABLED=true`; the advanced compose topology still keeps coturn behind the `turn` profile to avoid forcing relay ports on every small/local deployment

## Protocol Design

`packages/protocol` is the single source of truth for:

- HTTP DTOs
- WebSocket envelopes
- event names
- command names
- error codes
- media signaling payloads

This avoids duplicated front-end and back-end types.

## Media Boundary

- WebRTC is the intended client media transport
- Baker does not implement RTP / ICE / NAT traversal itself
- STUN / TURN come from environment variables
- production startup now rejects insecure default values for admin password, JWT secrets, and media internal secret
- React components must not own gateway/API business logic
- `apps/media` exists so future SFU work does not leak into the API or gateway

## Request And Realtime Flow

Durable flow:

- auth, guild, channel, and message HTTP requests go through `apps/api`
- public server config and admin control-plane changes also go through `apps/api`
- auth logout revokes the caller's durable session and refresh tokens through `apps/api`
- data persists through `packages/db` into PostgreSQL

Realtime flow:

- `apps/gateway` authenticates WebSocket connections
- presence and message fanout go through gateway + Redis
- voice and room stream commands update gateway in-memory room state and relay validated signaling messages
- gateway also emits `voice.roster.updated` snapshots so clients can render voice-channel membership without joining voice
- gateway also emits `voice.network.updated` snapshots so joined participants can render per-user `GW RTT/GW Loss/Media Loss`
- gateway caches authenticated guild visibility on each connection so `voice.roster.updated` fanout stays off the hot DB path during voice join/leave/mute churn

Room stream flow:

- host capture occurs in the browser before `stream.start`
- a voice channel may contain multiple concurrent publisher-owned stream sessions
- `streamId` is the primary identity for watch/unwatch/render/reconcile and signaling validation
- `stream.start` may include requested quality settings for resolution/frame rate/bitrate
- gateway creates a publish or watch media session by authenticating to the media service with `MEDIA_INTERNAL_SECRET`, persists the publisher-owned stream session plus requested quality metadata, and broadcasts `stream.state.updated`
- `voice.join` replays the current authoritative stream snapshot to late joiners when the room already has live streams
- `voice.leave` and disconnect cleanup remove the caller's same-channel stream participation before broadcasting reconciled room state
- viewers use `stream.watch` to join recv-only for a specific `streamId`
- screen-share publishers mark outbound video tracks with `contentHint='detail'`
- publishers apply best-effort sender bitrate caps (`maxBitrate`), sender `degradationPreference`, and optional codec-preference ordering during publish offer setup
- `stream.state.updated` is the authoritative room snapshot for client reconciliation
- client teardown is per-stream for watched sessions and separate from owned publish teardown
- the main client shell renders separate `Your Stream`, `Watching`, and `Available Streams` control/status sections from that state model
- watched-stream playback renders into `window.open` popup windows while the main window keeps ownership of the runtime and `MediaStream` objects
- gateway disconnect on the client also clears popup viewers so reconnect/logout does not leave orphaned viewer windows behind
- temporary compatibility fields remain in the snapshot while legacy single-stream fallback behavior still exists

Admin control-plane flow:

- a browser opens `apps/admin` on its own admin port
- the control panel verifies a shared management password through `POST /v1/admin/auth/verify`
- the management password remains in-memory on the page and is cleared on sign-out/reload; it is not stored in browser persistence
- after authentication, the panel reads and updates durable server settings through admin HTTP routes
- admin-managed user creation goes through the API and then joins the shared starter workspace using the current configured server name
- admin-managed channel creation/update uses the same durable channel repository path as the end-user client data model
- public clients read `/v1/meta/public-config` so login/register UI can reflect the authoritative server settings

## Why This Shape

- keeps durable CRUD, realtime orchestration, and media concerns separate
- prevents Web/Desktop UI divergence
- prevents protocol drift
- keeps media backend decisions reversible
- allows voice and room stream MVPs without collapsing browser WebRTC logic into backend services
- keeps server configuration/admin control separate from realtime gateway runtime

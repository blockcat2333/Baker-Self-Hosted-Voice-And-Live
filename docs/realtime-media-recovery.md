# Realtime Media Recovery Operations Guide

## Scope

This guide applies to Baker server `1.1.5`, Baker Desktop `1.1.5a`, and the
shared Web client shipped by the `blockcat233/baker:1.1.5` all-in-one image. It
covers transient Gateway, P2P, SFU, voice, livestream, and shared-music
failures. It does not replace correct HTTPS, TURN, SFU port, DNS, reverse proxy,
or regional media-profile configuration.

## What Changed In 1.1.5

- A replacement WebSocket can take over a stale same-user voice membership in
  the same channel. Gateway reconnect no longer fails repeatedly with
  `VOICE_ALREADY_JOINED` while the previous socket is waiting to be cleaned up.
- Socket-close cleanup is connection-owned for voice, livestream, and music
  records. A delayed close from an old socket cannot remove media state already
  restored by its replacement.
- The 1.1.4 recovery protocol and client behavior remain available unchanged:

- The client keeps a unified recovery incident for Gateway, voice, stream
  publication/viewing, and music publication/listening failures.
- Retries use exponential backoff with 20 percent jitter, capped at 30 seconds.
  The nominal delays are 1, 2, 4, 8, 16, and 30 seconds.
- After five failed attempts the UI exposes the incident, last error, retry
  count, **Retry now**, and **Abandon**. Automatic retries continue until the
  operation succeeds or the user abandons it.
- Gateway connections detect handshake timeouts and half-open sockets. The
  browser-side latency probe reconnects after three missing Pongs; the server
  terminates stale sockets after six heartbeat misses.
- Server `1.1.4` and newer accept authenticated `media.session.reconnect`
  commands. The Gateway
  verifies that the caller owns the active logical session and recreates the
  media transport without removing channel membership or publication intent.
- `media.session.restarted` tells affected clients to rebuild the corresponding
  voice, stream, or music transport from the new session descriptor.
- Voice recovery preserves the local microphone track, mute state, volume, and
  target channel. It does not ask for microphone permission again merely to
  replace a failed transport.
- Livestream and music recovery preserve publication and listening intent.
  An ended screen-capture track is intentionally non-retryable and must be
  selected again by the user.
- The SFU advertises H.264 first and also supports VP8, VP9, and AV1 when the
  browser and mediasoup worker can negotiate them. Selected codec, bitrate,
  frame-rate, and degradation preference are applied to P2P and SFU senders.
- SFU viewers now report receiver-side bitrate, codec, resolution, frame rate,
  packet loss, jitter, and dropped-frame statistics.
- Speaking detection samples every 50 ms, activates after one sample, releases
  after five samples, and uses separate on/off thresholds to reduce flicker.

## Recovery Contract

`media.session.reconnect` carries the current session descriptor. A successful
acknowledgement returns the selected media mode, ICE servers, a replacement
session descriptor, and SFU router data when the session uses SFU. Gateway
rejects unauthenticated requests, stale sessions, sessions owned by another
user, and requests from a connection that no longer owns the logical session.

The server keeps logical room state while replacing transport state. For voice,
this means the user remains in the voice roster. For a stream or music share,
the publication remains discoverable while its transport is rebuilt. Other
participants receive `media.session.restarted` and reconnect their side of that
specific session.

Recovery operations are generation-guarded. Completion from an old, cancelled
attempt cannot overwrite a newer session. Duplicate recovery starts for the
same incident are coalesced. If a replacement WebSocket rejoins before the old
socket closes, the Gateway transfers the logical voice membership to the new
connection. Later cleanup from the old connection removes only records that it
still owns.

## Compatibility

| Client                | Server         | Behavior                                                                                                        |
| --------------------- | -------------- | --------------------------------------------------------------------------------------------------------------- |
| 1.1.5 Web/Desktop     | 1.1.5          | In-place recovery plus stale-WebSocket ownership transfer                                                       |
| 1.1.4 or 1.1.5 client | 1.1.4          | In-place media recovery is available; the stale same-channel rejoin race remains possible                       |
| 1.1.4 or newer client | 1.1.3 or older | Client detects the unsupported command and uses the existing leave/rejoin or republish fallback where available |
| 1.1.3 or older client | 1.1.5          | Existing commands remain available; the client does not use the new recovery protocol                           |

Upgrade the server and bundled Web client together by replacing the all-in-one
image. Update installed Desktop clients separately. Mixed versions remain
usable, but server 1.1.5 is required for stale-connection takeover protection.

## Desktop Multi-Server Behavior

Baker Desktop can save, edit, remove, probe, and switch among multiple Baker
servers. Before committing a switch it validates the target `/health`, public
server identity, and Gateway WebSocket. A failed validation leaves the current
server active. Concurrent switches are generation-guarded so a late response
cannot select the wrong server.

The registry is stored in Electron's user-data `server.json`. Existing
single-server configuration is migrated to registry schema version 2. Server
entries contain endpoint and display metadata only.

Authentication sessions are scoped by server ID and stored in
`server-sessions.json` only when Electron `safeStorage` encryption is available.
Without OS-backed encryption, sessions remain memory-only and users must sign
in again after restarting the app. Do not copy either file between user
profiles as a credential migration mechanism.

## Upgrade Procedure

1. Back up the persistent `/var/lib/baker` volume and record the current fixed
   image tag, published ports, mounts, and environment variables.
2. Run `supervisorctl status` and confirm PostgreSQL, Redis, API, Gateway,
   Media, Caddy, and enabled TURN processes are healthy before the change.
3. Pull `blockcat233/baker:1.1.5` or use the authenticated admin one-click
   updater. Do not deploy `latest` when deterministic rollback is required.
4. Preserve `/var/lib/baker`, `/var/run/docker.sock`, the container restart
   policy, and every TURN/SFU/HTTPS port binding.
5. Wait for Docker health to become healthy. Confirm `/health` reports
   `1.1.5` and `/v1/meta/public-config` reports the intended media mode.
6. Upgrade Windows clients to `1.1.5a`.

No manual database migration or data reset is required for 1.1.5. Never remove
the data volume as part of an image-only upgrade.

## Validation Matrix

Test with two authenticated users and, for dual-region deployments, repeat the
matrix through every public hostname:

1. Join the same voice channel, mute and unmute, and verify both roster and
   speaking indicators.
2. Interrupt the client network for at least 20 seconds, restore it, and verify
   Gateway and voice recover without duplicate roster members or a second
   microphone prompt.
3. Start a livestream, change quality, codec, bitrate, and frame-rate settings,
   then confirm sender and receiver statistics reflect the negotiated result.
4. Interrupt the viewer and publisher independently and verify watch/publication
   intent returns after connectivity is restored.
5. Start shared music, interrupt each side, and verify listener volume and
   publication state are preserved.
6. Stop screen capture from the browser or operating-system capture control.
   Confirm Baker does not retry an ended track indefinitely.
7. For SFU, verify the browser's selected remote candidate uses the announced
   address and published RTC range for that hostname. Verify TURN fallback from
   a restrictive network.

## Incident Response

When recovery escalates after attempt five, record the incident kind and exact
last error before pressing **Retry now**. Then check these layers in order:

1. `/health`, container health, and `supervisorctl status`.
2. Browser HTTPS trust, WebSocket upgrade, and reverse-proxy timeouts.
3. Every external watchdog and health probe. Its URL scheme, host, port, and
   expected status must match the live public endpoint. After an HTTP-to-HTTPS
   migration, an obsolete HTTP probe can repeatedly restart an otherwise
   healthy relay. Test the exact probe manually and observe several complete
   monitor intervals before declaring the migration stable.
4. Gateway logs for authentication, heartbeat, ownership, or stale-session
   rejection.
5. Media logs for router, transport, producer, consumer, ICE, or DTLS failures.
6. Public TURN/SFU reachability for both TCP and UDP and the exact announced
   ports returned to the browser.
7. `MEDIA_REGION_PROFILES` host matching when different public hostnames must
   use different media routes.

Do not treat a successful Web page load as media-path proof. HTTPS, WSS, TURN,
and SFU RTC candidates are independent network paths.

## Rollback

Recreate the container with the previous fixed image and the same
`/var/lib/baker` mount, environment, and published ports. If an installed
Desktop client must also be rolled back, uninstall it and install the matching
lettered client release. Preserve the Electron user-data directory unless the
problem is specifically isolated to its registry; deleting it signs users out
and removes saved server entries.

After rollback, repeat health, voice, livestream, music, and regional-route
validation. Versions before 1.1.4 do not provide in-place recovery; server
versions before 1.1.5 do not provide stale-connection takeover protection.

## Security Boundaries

- Never put TURN passwords, DNS API keys, admin passwords, or access tokens in
  issue reports, diagnostics, screenshots, or repository files.
- Use HTTPS for browser media permissions and WSS authentication.
- Treat Docker socket access as host-level administrative capability.
- Use least-privilege DNS credentials and persist certificate state under the
  Baker data volume.
- Expose the Web and required media ports only; keep the admin panel private.

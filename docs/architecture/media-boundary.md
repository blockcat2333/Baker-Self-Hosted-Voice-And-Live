# Media Boundary

## Current State

`apps/media` owns the server-side media boundary for Baker. It supports two runtime modes:

- `p2p`: media sessions return ICE servers and let browsers negotiate directly.
- `sfu`: media sessions also expose mediasoup router and transport data so voice, music share, and livestream tracks flow through the backend.

The rest of the system should treat Media as the only owner of ICE/TURN/SFU details. Gateway creates media sessions and forwards SFU commands, but it does not build RTC candidates itself.

## Session Flow

1. The browser opens the web app and connects to Gateway over `/ws`.
2. Gateway records the request host from `X-Forwarded-Host`, `Host`, and `Origin`.
3. When the user joins voice, publishes music, starts a livestream, or watches a livestream, Gateway creates an internal Media session.
4. Media returns ICE servers and, in SFU mode, the mediasoup session metadata.
5. Gateway relays the session payload to the browser.
6. Browser WebRTC code negotiates P2P or SFU transports using the returned data.

## Region Selection

Multi-region deployments use `MEDIA_REGION_PROFILES`. Gateway matches the WebSocket request host to a profile and stores the selected `mediaRegionId` on the connection. Every later media session created from that connection carries the same `mediaRegionId`.

Media resolves that id before returning ICE servers or creating SFU transports:

- STUN/TURN URLs come from the selected profile, falling back to global values when a profile omits them.
- SFU `announcedAddress`, TCP enablement, and RTC port range come from the selected profile.
- All SFU transports for one profile share a single mediasoup `WebRtcServer` and fixed UDP/TCP port. Different profiles reserve different ports.
- Unknown profile ids are rejected instead of silently falling back to the default route.

This makes the web entry and media entry align: users who open the Hong Kong hostname receive Hong Kong TURN/SFU candidates, while users who open the mainland hostname receive mainland candidates.

## Port Invariants

SFU candidates include explicit ports. Any reverse proxy, NAT, or frp mapping must make those exact ports reachable from the browser.

The configured RTC range is a regional listener pool, not a per-user capacity limit. Baker reserves one port for each media region that creates an SFU transport. The union of all configured ranges must therefore contain at least as many distinct ports as the maximum number of regions that can be active at the same time. User concurrency does not consume additional listening ports.

Valid:

- profile announces `23335-23400`
- public relay exposes `23335-23400`
- forwarding maps `23335-23400 -> Baker:23335-23400`

Invalid:

- profile announces `50000-50100`
- public relay exposes `23335-23400`
- forwarding maps `23335-23400 -> Baker:50000-50100`

In the invalid case, browsers still try to connect to `50000-50100`, so negotiation fails even though the relay has open ports.

## Runtime Ownership

In the all-in-one image, Docker env values are first-run seeds. After `/var/lib/baker/runtime/runtime.env` exists, the runtime file is authoritative. The admin API, update helper, and runtime watchdog coordinate against that file.

Public IP Automation only updates legacy global TURN/SFU values. `MEDIA_REGION_PROFILES` is treated as explicit operator-managed routing because a profile may point to a different relay region or fixed hostname.

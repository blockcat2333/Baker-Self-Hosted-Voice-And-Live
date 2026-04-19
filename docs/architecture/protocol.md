# Protocol Notes

## Single Source Of Truth

All DTOs, WebSocket envelopes, event names, command names, signaling payloads, and error codes live in `packages/protocol`.

## HTTP

Current protocol modules:

- `http/auth.ts`
- `http/guild.ts`
- `http/chat.ts`
- `http/system.ts`

Implemented M1 routes:

- `GET /health`
- `GET /v1/meta/services`
- `GET /v1/internal/media/capabilities`

Auth, guild, and chat DTOs are defined early so M2 can implement them without duplicating types.

## WebSocket

Envelope shape:

- `event`
- `command`
- `ack`
- `error`
- `ping`
- `pong`

Design rules:

- envelopes are versioned with `v`
- event names are stable strings
- command names are stable strings
- transport wrappers parse all incoming payloads against schema

## Media Signaling

Media signaling stays protocolized even before a real SFU is wired in.

- session descriptor
- signal type
- ICE candidate payload
- media capabilities

This allows the client and media service to evolve together without hiding signaling behind ad hoc JSON.

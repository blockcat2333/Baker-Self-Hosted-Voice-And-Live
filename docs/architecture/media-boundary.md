# Media Boundary

## Current State

`apps/media` exposes a `NoopMediaAdapter` in Milestone 1.

That means:

- no RTP logic
- no SFU dependency yet
- no transport negotiation implementation
- media capability and session boundary are still explicit

## Why A Separate Adapter Exists Now

- voice and streaming arrive after chat
- the repo still needs a stable place for media session orchestration code
- WebSocket and React layers should not grow direct media backend dependencies

## Planned Contract

The future adapter will own:

- media session preparation
- producer / consumer mapping
- ICE / transport lifecycle orchestration
- metrics hooks
- future bitrate and simulcast hooks

The rest of the system should only depend on the adapter interface and protocol payloads.

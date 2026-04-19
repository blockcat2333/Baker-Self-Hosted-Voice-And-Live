# Contributing to Baker

Thanks for helping improve Baker.

English and Simplified Chinese issues and pull requests are both welcome.

## What Helps Most

High-value contributions are usually:

- stability fixes for chat, voice, or stream lifecycle bugs
- reconnect, refresh, re-auth, and rejoin hardening
- stale roster, stale room state, or stale viewer-count fixes
- admin/settings persistence and propagation fixes
- deployment and self-hosted operability improvements

## Development Setup

1. Install dependencies with `pnpm install`.
2. Start local services with:
   `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-up.ps1`
3. Run the standard validation loop before opening a PR:
   - `pnpm typecheck`
   - `pnpm lint`
   - `pnpm test`

## Architecture Boundaries

Please keep the current module boundaries intact unless a real bug requires otherwise:

- `packages/protocol` is the single source of truth for shared contracts
- `apps/gateway` owns signaling and runtime orchestration only
- `apps/media` is the media adapter boundary
- browser WebRTC logic belongs in `packages/client` and `packages/sdk`

## Pull Request Expectations

- Keep the scope small and directly tied to the bug or improvement
- Add or update regression coverage when fixing real bugs
- Update documentation when repo reality changes:
  - `docs/current-status.md`
  - `docs/project-history.md`
  - `docs/project-overview.md` when milestone or repo reality changes
  - `docs/architecture.md` when boundaries or runtime assumptions change
  - `docs/repo-state-summary.md` when important modules/files change
- Do not commit secrets, tokens, personal config, private domains, or local-only artifacts

## Reporting Bugs

When possible, include:

- the commit or branch you tested
- browser or desktop runtime details
- deployment mode (local, LAN, reverse proxy, public domain)
- reproducible steps
- expected behavior
- actual behavior

Please redact personal information, hostnames, secrets, and credentials before posting logs or screenshots.

<p align="right">
  <a href="./README.zh-CN.md">
    <img alt="Chinese" src="https://img.shields.io/badge/%E4%B8%AD%E6%96%87-%E4%BB%8B%E7%BB%8D%E4%B8%8E%E9%83%A8%E7%BD%B2%E6%8C%87%E5%8D%97-0A66C2?style=for-the-badge">
  </a>
</p>

# Baker

Baker is a self-hosted, Discord-like realtime communication platform for private communities, game groups, and small teams.

The project name is inspired by Baker from Arknights: Endfield.

## Project Direction

- Self-hosted first, with deployment-friendly defaults
- Admin-controlled server settings and instance ownership
- Stable realtime chat, voice, and room streaming behavior
- Incremental delivery instead of platform-wide redesigns

## Current Status

- Validated through the current Milestone 5 hardening stage
- Monorepo includes the web client, desktop shell, admin panel, API, gateway, and media boundary services
- Auth, chat, presence, voice, livestream signaling, popup stream viewing, and server settings are implemented
- Standard validation loop is `pnpm typecheck`, `pnpm lint`, and `pnpm test`

## Docker Quick Start

The fastest way to run Baker is the published Docker Compose stack.

1. Start the full stack:
   `docker compose up -d`
2. Read the first-boot output once:
   `docker compose logs bootstrap`
3. Open:
   - Web: `http://localhost:3000`
   - Admin: `http://localhost:3001`
4. Use the admin password printed by `bootstrap`.
5. Optional TURN relay for internet/NAT-heavy voice or livestream usage:
   `docker compose --profile turn up -d`

### Images

The canonical public application image is:

- `blockcat233/baker`

The static edge image used by the Compose stack is:

- `blockcat233/baker-proxy`

The stack also uses official infrastructure images for PostgreSQL, Redis, and optional coturn. That is why Baker remains a one-command deployment through Docker Compose, not a single all-in-one container. The app still starts with `docker compose up -d`, but the Docker Hub search surface now has a clear main image instead of separate app-service images like `baker-api` and `baker-media`.

If Docker Hub still shows older service-specific repositories, those are legacy artifacts from earlier publishing runs. New releases are now centered on `baker` and `baker-proxy`.

If you run `docker run blockcat233/baker:latest` directly, the container now prints a short Compose-first help message and exits. That image is the shared Baker runtime used by multiple services inside the stack.

### Notes

- The default `docker-compose.yml` pulls published images instead of building locally.
- The `bootstrap` service auto-generates strong runtime secrets on first start and persists them in a Docker volume.
- The default host ports are `3000` for Web and `3001` for Admin to avoid common `:80` conflicts on local machines.
- If you want fixed ports, fixed secrets, or different image registries, copy [`.env.selfhost.example`](./.env.selfhost.example) to `.env` before first startup.
- To build from source locally instead of pulling published images:
  `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`
- By default, only the web/admin ports are exposed publicly; Postgres and Redis bind to `127.0.0.1`.

## Current Limits

- `apps/media` is still a placeholder adapter boundary; there is no real SFU backend yet
- Voice and stream room runtime state is still in-memory
- Voice and livestream are P2P and intended for small-room usage today
- Desktop/Electron is present but not yet validated end-to-end

## Monorepo Layout

```text
apps/
  admin/     Server control panel
  api/       Durable HTTP API
  desktop/   Electron shell
  gateway/   Realtime WebSocket gateway
  media/     Media adapter boundary
  web/       Browser client
packages/
  client/    Shared React UI and app shell
  db/        Drizzle schema and repositories
  protocol/  Shared DTO / WS / signaling contracts
  sdk/       Client transport and WebRTC helpers
  shared/    Env, logger, and shared utilities
docs/        Architecture, history, status, and decisions
```

## Local Development

1. Install dependencies with `pnpm install`.
2. Start local services with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-up.ps1`.
3. Optional HTTPS proxy for mobile mic/voice testing:
   `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-https.ps1`
4. Optional DB reset:
   `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-reset-db.ps1 -Force`
5. Start the desktop shell separately with `pnpm dev:desktop`.

## Validation

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`

## Documentation

- [Chinese Guide / 中文说明](./README.zh-CN.md)
- [Project Overview](docs/project-overview.md)
- [Current Status](docs/current-status.md)
- [Project History](docs/project-history.md)
- [Architecture](docs/architecture.md)
- [Repository State Summary](docs/repo-state-summary.md)

## Contributing

Issues and pull requests in English or Simplified Chinese are welcome.

Before contributing, please read:

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

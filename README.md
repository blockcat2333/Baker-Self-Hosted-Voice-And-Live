# Baker

Baker is a self-hosted, Discord-like realtime communication platform for private communities, game groups, and small teams.

Baker 是一个面向私有部署场景、体验方向接近 Discord 的实时通信平台，适合私有社区、游戏群组和小团队。

The project name is inspired by Baker from Arknights: Endfield.

项目名 Baker 取自《明日方舟：终末地》中的 Baker。

## Project Direction / 项目方向

- Self-hosted first, with deployment-friendly defaults
- Admin-controlled server settings and instance ownership
- Stable realtime chat, voice, and room streaming behavior
- Incremental delivery instead of platform-wide redesigns

- 自托管优先，尽量保持部署友好
- 强调实例所有权和管理员控制
- 优先保证聊天、语音和房间直播的实时稳定性
- 采用小步迭代，而不是整个平台级重构

## Current Status / 当前状态

- Validated through the current Milestone 5 hardening stage
- Monorepo includes web, desktop shell, admin panel, API, gateway, and media boundary services
- Auth, chat, presence, voice, livestream signaling, popup stream viewing, and server settings are implemented
- Standard validation loop is `pnpm typecheck`, `pnpm lint`, and `pnpm test`

- 当前已经完成并验证到 Milestone 5 的稳定性加固阶段
- 单仓库包含 Web、桌面壳层、管理后台、API、Gateway 与媒体边界服务
- 已实现认证、聊天、在线状态、语音、直播信令、弹窗观看和服务端设置管理
- 标准校验流程为 `pnpm typecheck`、`pnpm lint`、`pnpm test`

## Current Limits / 当前限制

- `apps/media` is still a placeholder adapter boundary; there is no real SFU backend yet
- Voice and stream room runtime state is still in-memory
- Voice and livestream are P2P and intended for small-room usage today
- Desktop/Electron is present but not yet validated end-to-end

- `apps/media` 目前仍是占位的适配层边界，还没有真正的 SFU 媒体后端
- 语音和直播房间的运行时状态目前仍以内存态为主
- 当前语音与直播仍是 P2P 方案，更适合小房间场景
- 桌面端/Electron 已接入，但尚未做完整的端到端验证

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

## Docker Deploy / Docker 部署

The fastest way to run Baker as a private self-hosted service is Docker Compose with prebuilt images.

Baker 当前最简单的私有部署方式是使用预构建镜像的 Docker Compose。

1. Start the full stack:
   `docker compose up -d`
2. Read the first-run bootstrap output once:
   `docker compose logs bootstrap`
3. Open:
   - Web: `http://localhost:3000`
   - Admin: `http://localhost:3001`
4. Use the admin password printed by `bootstrap` for the control panel.
5. Optional TURN relay for internet/NAT-heavy voice or livestream usage:
   `docker compose --profile turn up -d`

1. 启动完整栈：
   `docker compose up -d`
2. 第一次启动后查看一次 bootstrap 输出：
   `docker compose logs bootstrap`
3. 打开：
   - Web：`http://localhost:3000`
   - 管理后台：`http://localhost:3001`
4. 使用 `bootstrap` 打印出来的管理后台密码登录。
5. 如果是公网 / NAT 较复杂的语音或直播场景，可选启用 TURN：
   `docker compose --profile turn up -d`

Notes / 说明:

- The default `docker-compose.yml` now pulls published runtime images instead of building locally, so first-time startup is much faster and simpler.
- Those images are now self-contained: `bootstrap`, Postgres, migration, API, gateway, media, and proxy no longer depend on bind-mounted runtime scripts from the repo.
- The `bootstrap` service auto-generates strong runtime secrets on first start and persists them in a Docker volume.
- The default host ports are `3000` for Web and `3001` for Admin to avoid common `:80` bind conflicts on Docker Desktop / local machines.
- If you want fixed ports, fixed secrets, or different image registries, copy `.env.selfhost.example` to `.env` before the first startup.
- The publish workflow targets GHCR by default and can also mirror to Docker Hub, which is the path that makes Baker images searchable directly inside Docker Desktop.
- To build from source locally instead of pulling published images:
  `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`
- The Compose stack includes Postgres, Redis, schema migration, API, gateway, media boundary service, and a Caddy reverse proxy serving both the user web app and the admin panel.
- By default, only the web/admin ports are exposed publicly; Postgres and Redis bind to `127.0.0.1`.
- `apps/media` is still a placeholder media boundary, so voice and livestream are currently best suited for small-room P2P deployments.
- 默认 `docker-compose.yml` 现在优先拉取已发布镜像，而不是本地构建，因此首次启动更快、更适合公开用户。
- 这些镜像现在已经自包含：`bootstrap`、Postgres、迁移、API、gateway、media、proxy 不再依赖仓库里的运行时脚本挂载。
- `bootstrap` 服务会在第一次启动时自动生成强随机运行时密钥，并持久化到 Docker volume。
- 默认宿主机端口改成了 Web `3000` 和管理后台 `3001`，这样在 Docker Desktop / 本地机器上更不容易撞上 `80` 端口占用。
- 如果你想固定端口、固定密码/密钥，或切换镜像仓库，请在首次启动前把 `.env.selfhost.example` 复制为 `.env` 后再修改。
- 发布工作流默认推送到 GHCR，也可以镜像到 Docker Hub；接上 Docker Hub 后，用户就能在 Docker Desktop 里直接搜索到 Baker 镜像。
- 如果你想在本地从源码构建，而不是拉取预构建镜像：
  `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`
- Compose 栈包含 Postgres、Redis、数据库迁移、API、gateway、media 边界服务，以及同时承载用户 Web 与管理后台的 Caddy 反向代理。
- 默认只有 Web / Admin 端口对外暴露；Postgres 和 Redis 默认仅绑定到 `127.0.0.1`。
- `apps/media` 目前仍是占位的媒体边界，因此当前语音和直播更适合小房间的 P2P 自托管场景。

## Local Development / 本地开发

1. Install dependencies with `pnpm install`.
2. Start local services with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-up.ps1`.
3. Optional HTTPS proxy for mobile mic/voice testing:
   `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-https.ps1`
4. Optional DB reset:
   `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-reset-db.ps1 -Force`
5. Start the desktop shell separately with `pnpm dev:desktop`.

1. 先执行 `pnpm install` 安装依赖。
2. 使用 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-up.ps1` 启动本地服务。
3. 如果要在手机或 HTTPS 场景测试麦克风/语音，可额外运行：
   `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-https.ps1`
4. 如果需要重置数据库，可运行：
   `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-reset-db.ps1 -Force`
5. 桌面端需单独执行 `pnpm dev:desktop`。

## Validation / 校验

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`

## Documentation

- [Project Overview](docs/project-overview.md)
- [Current Status](docs/current-status.md)
- [Project History](docs/project-history.md)
- [Architecture](docs/architecture.md)
- [Repository State Summary](docs/repo-state-summary.md)

## Contributing / 参与贡献

Issues and pull requests in English or Simplified Chinese are welcome.

欢迎使用英文或简体中文提交 issue 和 pull request。

Before contributing, please read:

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

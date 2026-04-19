<p align="right">
  <a href="./README.md">
    <img alt="English" src="https://img.shields.io/badge/English-Guide-111827?style=for-the-badge">
  </a>
</p>

# Baker

Baker 是一个面向私有部署场景、体验方向接近 Discord 的实时通信平台，适合私有社区、游戏群组和小团队。

项目名 Baker 取自《明日方舟：终末地》中的 Baker。

## 项目方向

- 自托管优先，保持部署友好
- 强调实例所有权和管理员控制
- 优先保证聊天、语音和房间直播的实时稳定性
- 采用小步迭代，而不是整个平台级重构

## 当前状态

- 当前已经完成并验证到 Milestone 5 的稳定性与部署加固阶段
- 单仓库包含 Web、桌面壳层、管理后台、API、Gateway 和 Media 边界服务
- 已实现认证、聊天、在线状态、语音、直播信令、弹窗观看和服务端设置
- `blockcat233/baker` 现在是真正可直接运行的一体化镜像
- 进阶 Docker Compose 路径现在使用 `blockcat233/baker-runtime` 和 `blockcat233/baker-proxy`
- 标准校验流程为 `pnpm typecheck`、`pnpm lint`、`pnpm test`

## 快速开始：单容器

体验 Baker 最简单的方式是直接运行一个容器，并挂载一个持久化数据卷。

```bash
docker volume create baker-data

docker run -d \
  --name baker \
  -p 3000:80 \
  -p 3001:8080 \
  -v baker-data:/var/lib/baker \
  blockcat233/baker:latest

docker logs baker
```

打开：

- Web：`http://localhost:3000`
- 管理后台：`http://localhost:3001`

首次启动会打印一次管理后台密码。运行时密钥、Redis 数据和 PostgreSQL 数据都会保存在挂载卷里的 `/var/lib/baker` 下，因此后续直接 `docker restart baker` 就能保留实例状态。

## 可选：启用 TURN 中继

如果你要在公网、复杂 NAT、VPN、移动网络或跨地区环境下使用语音和直播，建议在同一个容器里启用内置 TURN，并映射中继端口：

```bash
docker rm -f baker

docker run -d \
  --name baker \
  -p 3000:80 \
  -p 3001:8080 \
  -p 3478:3478/tcp \
  -p 3478:3478/udp \
  -p 49160-49200:49160-49200/tcp \
  -p 49160-49200:49160-49200/udp \
  -e TURN_ENABLED=true \
  -e TURN_EXTERNAL_IP=203.0.113.10 \
  -e TURN_USERNAME=baker \
  -e TURN_PASSWORD=change-this \
  -v baker-data:/var/lib/baker \
  blockcat233/baker:latest
```

如果没有显式设置 `TURN_URLS`，Baker 会根据 `TURN_EXTERNAL_IP` 和 `TURN_PORT` 自动生成；如果你希望客户端拿到固定域名形式的 TURN 地址，也可以自己显式设置 `TURN_URLS`。

## 进阶 / 生产 Compose 部署

如果你更看重服务拆分、独立升级或自定义 Postgres / Redis / TURN，这条多服务 Compose 路径更适合生产环境。

```bash
docker compose up -d
docker compose logs bootstrap
```

打开：

- Web：`http://localhost:3000`
- 管理后台：`http://localhost:3001`

说明：

- `docker-compose.yml` 现在是 registry-first，会拉取 `blockcat233/baker-runtime` 和 `blockcat233/baker-proxy`
- [`.env.selfhost.example`](./.env.selfhost.example) 现在是进阶覆盖模板，用于固定密钥、自定义端口或切换镜像仓库
- 本地从源码构建并验证仍然可以使用：
  `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`
- 进阶栈里的可选 coturn 仍然可以通过：
  `docker compose --profile turn up -d`

## 镜像角色

- `blockcat233/baker`：最适合新手的一体化镜像，直接 `docker run` 即可
- `blockcat233/baker-runtime`：进阶 Compose 路径使用的运行时镜像，供 `bootstrap`、`migrate`、`api`、`gateway`、`media` 复用
- `blockcat233/baker-proxy`：进阶 Compose 路径的边缘代理镜像，负责 Web / Admin 以及 `/v1`、`/health`、`/ws`

之前那些 `baker-api`、`baker-media` 之类的服务级镜像仓库属于早期发布遗留物，已经不再是当前推荐的公开部署方式。

## 迁移说明

- `blockcat233/baker` 的含义已经变化：它现在是官方支持的一体化镜像，而不是 Compose 共享运行时
- 现有 Compose 用户应切换到 `blockcat233/baker-runtime`
- `blockcat233/baker-proxy` 仍然是进阶部署里的代理镜像
- 旧的 `baker-api` / `baker-media` / `baker-gateway` 风格仓库不再是主要公开接口

## 当前限制

- `apps/media` 目前仍是占位型适配边界，还没有真正的 SFU 后端
- 语音和直播房间运行时状态目前仍以内存态为主
- 当前语音与直播仍是 P2P 方案，更适合小房间场景
- 桌面端 Electron 已接入，但尚未完成完整的端到端验证

## Monorepo 结构

```text
apps/
  admin/     服务端管理后台
  api/       持久化 HTTP API
  desktop/   Electron 桌面壳层
  gateway/   实时 WebSocket 网关
  media/     媒体适配边界
  web/       浏览器客户端
packages/
  client/    共享 React UI 与应用壳层
  db/        Drizzle schema 与仓储
  protocol/  共享 DTO / WS / 信令协议
  sdk/       客户端传输与 WebRTC 辅助
  shared/    环境、日志与共享工具
docs/        架构、历史、状态与决策记录
```

## 本地开发

1. 先执行 `pnpm install` 安装依赖。
2. 使用 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-up.ps1` 启动本地服务。
3. 如果要在手机或 HTTPS 场景测试麦克风/语音，可额外运行：
   `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-https.ps1`
4. 如果需要重置数据库，可运行：
   `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-reset-db.ps1 -Force`
5. 桌面端需单独执行 `pnpm dev:desktop`。

## 校验

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`

## 文档

- [English Guide](./README.md)
- [项目概览](docs/project-overview.md)
- [当前状态](docs/current-status.md)
- [项目历史](docs/project-history.md)
- [架构说明](docs/architecture.md)
- [仓库状态摘要](docs/repo-state-summary.md)

## 参与贡献

欢迎使用英文或简体中文提交 issue 和 pull request。

开始前请先阅读：

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

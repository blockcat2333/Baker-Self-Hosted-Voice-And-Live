<p align="right">
  <a href="./README.md">
    <img alt="English" src="https://img.shields.io/badge/English-Guide-111827?style=for-the-badge">
  </a>
</p>

# Baker

Baker 是一个面向私有部署场景、体验方向接近 Discord 的实时通信平台，适合私有社区、游戏群组和小团队。

项目名 Baker 取自《明日方舟：终末地》中的 Baker。

## 项目方向

- 自托管优先，尽量保持部署友好
- 强调实例所有权和管理员控制
- 优先保证聊天、语音和房间直播的实时稳定性
- 采用小步迭代，而不是整个平台级重构

## 当前状态

- 当前已经完成并验证到 Milestone 5 的稳定性加固阶段
- 单仓库包含 Web、桌面壳层、管理后台、API、Gateway 与媒体边界服务
- 已实现认证、聊天、在线状态、语音、直播信令、弹窗观看和服务端设置管理
- 标准校验流程为 `pnpm typecheck`、`pnpm lint`、`pnpm test`

## Docker 快速部署

当前最简单的部署方式是使用已经发布好的 Docker Compose 栈。

1. 启动完整栈：
   `docker compose up -d`
2. 第一次启动后查看一次 `bootstrap` 输出：
   `docker compose logs bootstrap`
3. 打开：
   - Web：`http://localhost:3000`
   - 管理后台：`http://localhost:3001`
4. 使用 `bootstrap` 打印出来的管理后台密码登录。
5. 如果是公网 / NAT 较复杂的语音或直播场景，可选启用 TURN：
   `docker compose --profile turn up -d`

### 镜像说明

现在的主应用镜像是：

- `blockcat233/baker`

静态页面和反向代理镜像是：

- `blockcat233/baker-proxy`

同时 Compose 栈还会使用官方的 PostgreSQL、Redis，以及可选的 coturn 基础镜像。所以 Baker 更合适的交付形态是“一个命令拉起整个栈”，而不是把所有进程硬塞进单个容器。对用户来说，部署仍然是：

`docker compose up -d`

但 Docker Hub 搜索入口会更清晰，不再以 `baker-api`、`baker-media` 这种多个 Baker 子镜像为主。

如果你直接执行 `docker run blockcat233/baker:latest`，容器现在会打印一段简短提示，然后退出。因为这个镜像本质上是 Baker 多个服务共用的运行时镜像，不是单独就能完整工作的 all-in-one 容器。

### 补充说明

- 默认 `docker-compose.yml` 会直接拉取发布好的镜像，而不是本地构建。
- `bootstrap` 服务会在第一次启动时自动生成强随机运行时密钥，并持久化到 Docker volume。
- 默认宿主机端口是 Web `3000`、管理后台 `3001`，这样在本地机器上更不容易撞上 `:80`。
- 如果你想固定端口、固定密码/密钥，或切换镜像仓库，请在首次启动前把 [`.env.selfhost.example`](./.env.selfhost.example) 复制为 `.env` 后再修改。
- 如果你想在本地从源码构建，而不是拉取预构建镜像：
  `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`
- 默认只有 Web / Admin 端口对外暴露；Postgres 和 Redis 默认仅绑定到 `127.0.0.1`。

## 当前限制

- `apps/media` 目前仍是占位的适配层边界，还没有真正的 SFU 媒体后端
- 语音和直播房间的运行时状态目前仍以内存态为主
- 当前语音与直播仍是 P2P 方案，更适合小房间场景
- 桌面端/Electron 已接入，但尚未做完整的端到端验证

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
  client/    共享 React UI 和应用壳层
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

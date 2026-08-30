# All-in-One 镜像的阿里云 DNS-01 HTTPS

## 适用范围

Baker 1.1.3 为 all-in-one Supervisor 镜像增加了可选 HTTPS 监听器，适用于以下部署：

- Baker 公网域名的权威 DNS 托管在阿里云 DNS；
- 公网中继能开放 TCP 端口，但无法开放公网 `80/tcp` 和 `443/tcp`；
- 浏览器用户需要可信 HTTPS/WSS 来源来使用麦克风、摄像头、屏幕捕获、语音和直播；
- 运维者希望继续使用单个 all-in-one 容器，而不是额外维护反向代理容器。

该监听器默认关闭。未启用时，现有 HTTP、TURN、SFU、管理后台和 Supervisor 行为不会改变。

## 流量模型

```text
浏览器
  -> https://baker-overseas.example.com:23333
  -> 中继/frps TCP 23333
  -> frpc TCP 隧道
  -> Docker 宿主机 3443/tcp
  -> Baker Caddy 3443/tcp（TLS + WebSocket 终止）
  -> Baker Web/API/Gateway
```

TURN 和 SFU 不经过这个 HTTPS 监听器。继续保留原来的 TCP/UDP 映射和媒体区域 profiles。

DNS-01 只会在申请和续签证书时临时修改 `_acme-challenge` TXT 记录。证书颁发机构不需要访问公网 `80` 或 `443`。

## 前置条件

- Baker all-in-one 镜像 `blockcat233/baker:1.1.3` 或更高版本。
- 公网域名的权威 DNS 区域由阿里云 DNS 托管。
- 为 DNS 自动化单独创建的阿里云 RAM 用户和 AccessKey。
- 持续挂载 `/var/lib/baker`。
- Docker 宿主机 `3443/tcp` 映射到容器 `3443/tcp`。
- 能原样转发 TLS 字节流的 TCP 中继或端口转发。

不要把 FRP HTTP 模式用于此入口。Baker 必须接收到原始 TLS 连接，因此 Web 代理必须使用纯 TCP 模式。

## 环境变量

| 变量                       | 是否必需   | 默认值                        | 用途                                                |
| -------------------------- | ---------- | ----------------------------- | --------------------------------------------------- |
| `BAKER_HTTPS_ENABLED`      | 使用时必需 | `false`                       | 启用可选 HTTPS 监听器。                             |
| `BAKER_HTTPS_HOST`         | 必需       | 无                            | 证书对应的公网 DNS 域名，不要包含协议、路径或端口。 |
| `BAKER_HTTPS_PORT`         | 可选       | `3443`                        | 容器内 HTTPS 监听端口。                             |
| `ALIYUN_ACCESS_KEY_ID`     | 必需       | 无                            | 专用 RAM 身份的 AccessKey ID。                      |
| `ALIYUN_ACCESS_KEY_SECRET` | 必需       | 无                            | 专用 RAM 身份的 AccessKey Secret。                  |
| `XDG_DATA_HOME`            | 镜像管理   | `/var/lib/baker/caddy/data`   | 持久化 Caddy 证书和 ACME 数据。                     |
| `XDG_CONFIG_HOME`          | 镜像管理   | `/var/lib/baker/caddy/config` | 持久化 Caddy 运行配置数据。                         |

生成的 Caddy 配置只包含环境变量占位符，不包含凭据值。Docker 管理员仍可查看容器环境变量，因此 Docker/Container Manager 管理权限必须按高权限保护。

## 阿里云 RAM 权限策略

请为 Baker 创建专用 RAM 用户，不要创建或使用阿里云主账号 AccessKey。

当前 AliDNS provider 使用以下 API Action：

- `alidns:DescribeDomains`
- `alidns:DescribeDomainRecords`
- `alidns:AddDomainRecord`
- `alidns:DeleteDomainRecord`
- `alidns:UpdateDomainRecord`

下面的自定义策略对 AliDNS 要求的列表/读取操作使用账号级范围，并把记录写操作限制到一个 DNS 区域。创建前替换 `<account-id>` 和 `<zone>`。

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["alidns:DescribeDomains", "alidns:DescribeDomainRecords"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "alidns:AddDomainRecord",
        "alidns:DeleteDomainRecord",
        "alidns:UpdateDomainRecord"
      ],
      "Resource": "acs:alidns:*:<account-id>:domain/<zone>"
    }
  ]
}
```

`<zone>` 应填写 `example.com` 这类 DNS 区域，而不是完整 Baker 主机名。如果旧版 AliDNS 账号配置拒绝自定义策略，可以临时使用官方 `AliyunDNSFullAccess` 系统策略定位授权边界；确认连通后应恢复为生产用自定义策略。

## Docker CLI 示例

下面只展示 Web 和 HTTPS 端口。请根据实际媒体部署补充 TURN/SFU 端口。

```bash
docker run -d \
  --name baker \
  --restart unless-stopped \
  -p 3000:80/tcp \
  -p 3001:8080/tcp \
  -p 3443:3443/tcp \
  -e BAKER_HTTPS_ENABLED=true \
  -e BAKER_HTTPS_HOST=baker-overseas.example.com \
  -e BAKER_HTTPS_PORT=3443 \
  -e ALIYUN_ACCESS_KEY_ID='<RAM AccessKey ID>' \
  -e ALIYUN_ACCESS_KEY_SECRET='<RAM AccessKey Secret>' \
  -v baker-data:/var/lib/baker \
  -v /var/run/docker.sock:/var/run/docker.sock \
  blockcat233/baker:1.1.3
```

AccessKey 值应放在容器管理器的凭据/环境配置中，不要提交到 Compose 文件、Shell 脚本、Issue、截图或支持日志。

## 群晖 Container Manager

已有 Baker 容器的升级步骤：

1. 备份当前容器设置和 `/var/lib/baker` 数据卷。
2. 拉取 `blockcat233/baker:1.1.3` 或更新的固定版本。
3. 保留全部现有数据挂载、Docker socket、TURN 端口、SFU 端口和媒体环境变量。
4. 新增宿主机 `3443/tcp` 到容器 `3443/tcp`。
5. 添加上表中的五个 `BAKER_HTTPS_*` 和 `ALIYUN_*` 设置。
6. 使用同一个 `/var/lib/baker` 挂载重建容器。
7. 用 `supervisorctl status` 确认 PostgreSQL、Redis、API、Gateway、Media、Caddy、runtime watchdog 和可选 TURN 都在运行。

此模式不依赖群晖 DSM 证书、DSM 反向代理，也不需要修改 DSM 的 `443`/`5001` 端口。

## FRP TCP 示例

HTTPS Web 入口的公网端口和本地端口可以不同，因为 Caddy 会按浏览器请求处理 URL。这一点与 SFU candidate 端口不同，SFU 仍必须做同端口转发。

```toml
serverAddr = "relay.example.com"
serverPort = 7000

[[proxies]]
name = "baker-https"
type = "tcp"
localIP = "192.0.2.10"
localPort = 3443
remotePort = 23333
```

对应用户访问地址为 `https://baker-overseas.example.com:23333/`。

除非明确配置了 WebSocket Upgrade，并保留 `Host`、`X-Forwarded-Host` 和 `Origin`，否则不要在 FRP 与 Baker 之间再放第二个 TLS 终止代理。

## 首次启动验证

1. 启动容器并查看日志。配置成功时应出现：

   ```text
   [HTTPS] Configured DNS-01 TLS for baker-overseas.example.com:3443.
   ```

2. 等待首次 ACME 订单和 DNS TXT 传播。阿里云免费 DNS 区域的最小 TTL 可能较长。
3. 从 Docker 宿主机或局域网测试本地监听器：

   ```bash
   curl --resolve baker-overseas.example.com:3443:192.0.2.10 \
     https://baker-overseas.example.com:3443/health
   ```

4. 测试公网 FRP 入口：`curl https://baker-overseas.example.com:23333/health`。
5. 浏览器打开公网地址，登录后验证聊天 WebSocket 和麦克风权限。
6. 单独验证 TURN 与 SFU。Web 证书有效不代表媒体端口可达。

## 自动续签与持久化

Caddy 会在证书过期前自动续签，不需要额外计划任务。

续签依赖以下条件：

- RAM AccessKey 仍有效；
- RAM 策略仍允许修改 TXT 记录；
- 容器能访问阿里云 DNS 和 ACME 证书颁发机构；
- `/var/lib/baker/caddy` 可写且持久化。

常规升级不要删除 `/var/lib/baker/caddy`。删除后会丢失 ACME 账号和证书缓存，可能造成不必要的重新签发或触发频率限制。

## 升级

1. 备份 `/var/lib/baker` 并导出当前容器配置。
2. 拉取固定版本的新 Baker 镜像。
3. 使用原挂载、HTTPS 变量、`3443` 端口、TURN/SFU 映射和媒体区域 profiles 重建容器。
4. 验证 `/health`、公网 HTTPS、`supervisorctl status` 和一次真实浏览器语音会话。

Baker 一键更新会保留普通环境变量和端口绑定。从 1.1.3 以前的容器首次升级时，应先在容器管理器中补充 HTTPS 变量和 `3443` 映射，再依赖后续一键更新。

## 回滚

不删除数据即可关闭功能：

1. 设置 `BAKER_HTTPS_ENABLED=false`，或移除可选 HTTPS 变量。
2. 重建容器。
3. 把中继重新指向已有可信反向代理，或停止发布该 HTTPS 地址。
4. 中继不再访问 `3443` 后再移除宿主机端口映射。

回滚镜像时，使用旧固定版本和同一个 `/var/lib/baker` 挂载重建容器。旧镜像会忽略 Caddy 数据目录；建议保留，以便以后恢复到 1.1.3 或更高版本。

## 故障排查

### Supervisor 启动前容器退出

- `BAKER_HTTPS_HOST must be a valid DNS hostname`：移除 `https://`、端口、路径、空格和末尾点。
- `BAKER_HTTPS_PORT must be an integer`：填写 `1` 到 `65535`，并发布相同容器端口。
- `Aliyun DNS-01 requires ...`：两个 AccessKey 变量都必须存在。

### ACME 报 AliDNS 授权错误

- 确认 AccessKey 属于目标 RAM 用户。
- 确认 RAM 策略包含上面五个 Action。
- 确认策略中的 DNS 区域和阿里云账号 ID 正确。
- 确认该区域的权威 DNS 服务商确实是阿里云。

### 本地 HTTPS 正常，公网入口失败

- 确认 FRP 使用 `type = "tcp"`。
- 确认中继公网端口正在监听，并已通过防火墙/安全组。
- 确认 frpc 指向 Docker 宿主机 `3443`，不是 Baker HTTP `3000`。
- 确认 SNI 和浏览器域名与 `BAKER_HTTPS_HOST` 一致。

### 网页正常，但语音失败

HTTPS 和 WebSocket 只是信令路径。继续检查被选中的 `MEDIA_REGION_PROFILES`、TURN 凭据、TURN TCP/UDP 端口、SFU 公告 IP，以及 SFU RTC 同端口转发。

## 其他 DNS 服务商

公开的 1.1.3 镜像只内置 AliDNS Caddy 模块。其他 DNS 服务商可选择：

- 用支持对应 DNS-01 API 的外部反向代理终止 HTTPS；或
- 自行构建带相应 `caddy-dns` 模块的 Caddy 镜像并负责维护。

不要把其他服务商的凭据写入 AliDNS 环境变量。

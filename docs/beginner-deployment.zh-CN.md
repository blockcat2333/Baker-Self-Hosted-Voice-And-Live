# 新手部署指南

这份指南是写给第一次自托管的人看的。

如果你的目标只是尽快搭一个类似 Discord 的私有服务器，给朋友、同学、战队或者小团队使用，请先看这份指南，不用一上来就读完整架构文档。

## Baker 能做什么

- 浏览器文字聊天
- 浏览器语音房间
- 房间内直播和屏幕共享
- 一套由你自己控制的私有服务器

## 开始前你需要准备什么

- 一台能运行 Docker Desktop 或 Docker Engine 的机器
- 10 分钟左右的首次部署时间
- 一个现代浏览器，例如 Chrome、Edge 或 Firefox

如果只是先在自己电脑上做本地体验，上面这些就够了。

如果要给公网用户使用，还需要：

- HTTPS
- 公网域名或公网 IP
- 启用 TURN，保证语音和直播稳定

## 最快的本地体验方式

1. 安装 Docker Desktop。
2. 打开终端。
3. 执行：

```bash
docker volume create baker-data

docker run -d \
  --name baker \
  -p 3000:80 \
  -p 3001:8080 \
  -v baker-data:/var/lib/baker \
  -v /var/run/docker.sock:/var/run/docker.sock \
  blockcat233/baker:1.1.2
```

4. 读取首次启动打印出来的管理后台密码：

```bash
docker logs baker
```

5. 打开：

- Web：`http://localhost:3000`
- 管理后台：`http://localhost:3001`

这份指南默认使用官方 all-in-one 镜像。这个容器内包含所有内置服务和 `supervisorctl`，所以管理后台可以在部署设置或公网 IP 变化后重启 Media/TURN。仓库里的 `docker-compose.yml` 只用于本地开发基础设施，不是公开部署路径。

## 容器启动后应该做什么

1. 打开管理后台，用 `docker logs baker` 里看到的密码登录。
2. 先检查服务器名称、注册策略和其他实例设置。
3. 打开主 Web 页面，创建第一个用户。
4. 最好再准备第二个测试账号，或者找一位朋友一起测试语音和直播。

如果服务器需要通过代理访问 GitHub 或 Docker Hub 元数据，请先在管理后台进入“服务器更新 -> 更新代理”，保存 HTTP/HTTPS 代理地址后再查找版本。这个代理只用于 Baker 更新元数据请求；自动公网 IP 仍会直接检测服务器真实公网 IP。Docker 镜像下载由宿主 Docker daemon 执行，所以镜像拉取失败时仍需要在 Docker 宿主机上配置 Docker daemon 代理或镜像源。

## 什么情况下必须使用 HTTPS

下面这些场景请直接使用 HTTPS：

- 用户要用手机访问
- 用户不在同一个局域网里
- 你希望语音、麦克风、摄像头、屏幕共享稳定工作

浏览器对媒体能力的限制在手机和公网环境里会更严格。HTTP 只适合做很短的本地测试。

## 什么情况下必须启用 TURN

以下场景强烈建议启用 TURN：

- 用户分布在不同城市或国家
- 用户在校园网、公司网、酒店网或移动网络下
- 用户通过 VPN 访问
- 能进语音，但彼此听不到声音
- 直播状态正常，但视频看不到

公网部署检查清单：

- 映射 `3478/tcp` 和 `3478/udp`
- 映射 `49160-49200/tcp` 和 `49160-49200/udp`
- 设置 `TURN_ENABLED=true`
- 设置 `TURN_EXTERNAL_IP=<你的公网 IP>`，或者显式设置 `TURN_URLS`
- 设置 `TURN_USERNAME` 和 `TURN_PASSWORD`

容器重启后，请检查日志，确认媒体服务显示 `turnConfigured:true`。

如果你的公网 IP 可能变化，请在配置好 TURN/SFU 后进入管理后台，启用“运行状态 -> 自动公网 IP”。Baker 会定期检测当前公网 IP，并刷新托管的媒体地址。

Baker 默认会尝试多个公网 IP 检测源，其中包括 `https://ip.3322.net`、`https://myip.ipip.net` 和 `https://ifconfig.co/ip`，用于服务端网络无法稳定访问旧全球接口的情况。如果你的服务器仍然显示检测失败，可以用 `BAKER_PUBLIC_IP_ENDPOINTS` 设置一个逗号分隔的接口列表。接口可以返回纯文本 IP、带 `ip` 字段的 JSON，或者包含 IP 的文本。

all-in-one Docker env 里的 `TURN_EXTERNAL_IP`、`TURN_URLS` 和 `SFU_ANNOUNCED_IP` 只用于首次初始化。`runtime.env` 创建后，Baker 会以运行时文件为准，这样公网 IP 自动化才能替换失效的媒体地址，而不会被旧容器 env 再次覆盖。

## 可选：SFU 模式

TURN 是让 P2P 媒体在 NAT 后面也能连通。SFU 模式不同：语音和直播轨道会先进入 Baker 的媒体后端，再由服务器转发给其他用户，适合有些用户所在网络会阻断或严重影响 P2P 的场景。

如果要让管理后台可以切换到 SFU，请额外映射 SFU RTC 端口范围，并设置公网 IP：

```bash
docker run -d \
  --name baker \
  -p 3000:80 \
  -p 3001:8080 \
  -p 50000-50100:50000-50100/udp \
  -p 50000-50100:50000-50100/tcp \
  -e SFU_ANNOUNCED_IP=203.0.113.10 \
  -v baker-data:/var/lib/baker \
  -v /var/run/docker.sock:/var/run/docker.sock \
  blockcat233/baker:1.1.2
```

然后进入管理后台，把“服务器设置 -> 媒体模式”切到 `sfu`。当前语音和直播会立即按新模式重连，文字聊天连接会保持在线。

## 可选：大陆/海外双区域媒体

如果用户明显分成两个网络区域，例如大陆用户主要访问 `violet.evergarden.space`，海外用户主要访问 `hkserver.evergarden.space`，可以配置 `MEDIA_REGION_PROFILES`。这样用户打开哪个 Web 域名，后续语音、音乐分享和直播就会拿到同一区域的 TURN/SFU 地址。

需要满足这些条件：

- 两个入口域名都能访问同一个 Baker Web 服务。
- 每个 profile 的 `hosts` 写对应 Web 域名。
- 每个 profile 的 `turnUrls` 和 `sfuAnnouncedIp` 必须是该区域用户能访问的地址。
- SFU RTC 端口必须做同端口映射。例如香港 profile 写 `23335-23400`，frp 就应该映射 `23335-23400 -> Baker:23335-23400`。

不要把 `23335 -> 50000` 这类不等端口映射用于 SFU。浏览器会按 Baker 返回的 candidate 端口连接，端口号不一致时媒体连接会失败。

双区域 profile 可以在管理后台“部署设置 -> 媒体区域 Profiles JSON”里保存。保存后需要点击“应用并重启容器”，让 all-in-one 容器重新发布新增端口。

## 公网部署示例

```bash
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
  -e BAKER_PUBLIC_IP_ENDPOINTS='https://ip.3322.net,https://myip.ipip.net,https://ifconfig.co/ip,https://api.ipify.org?format=json' \
  -v baker-data:/var/lib/baker \
  -v /var/run/docker.sock:/var/run/docker.sock \
  blockcat233/baker:1.1.2
```

如果要给真实用户用，Web 入口前面仍然需要配好 HTTPS。

## 最常见的问题

### 页面打不开

请检查：

- Docker 容器是否真的在运行
- 宿主机端口 `3000` 是否映射到容器 `80`
- 宿主机端口 `3001` 是否映射到容器 `8080`

### 聊天正常，但语音或屏幕共享用不了

请检查：

- 是否通过 HTTPS 访问
- 浏览器是否允许麦克风或屏幕共享
- 是否使用现代浏览器

### 能进语音，但只能看到说话灯亮，听不到声音

这通常说明点对点连接只成功了一部分，真正的音频 relay 路径没有建立好。

请检查：

- TURN 是否已启用
- relay 端口是否已放通
- `TURN_EXTERNAL_IP` 或 `TURN_URLS` 是否正确
- 日志里是否出现 `turnConfigured:true`

### 直播窗口打开了，但视频一直不出来

把它当成和上面的语音问题同类处理。直播观看在公网和复杂 NAT 网络下同样依赖可用的 TURN relay。

## 以后怎么升级

只要继续使用同一个 Docker 数据卷，重建容器一般不会丢数据。

常见升级步骤：

```bash
docker pull blockcat233/baker:1.1.2
docker rm -f baker
```

然后重新执行原来的 `docker run` 命令，并继续挂载同一个 `baker-data` 数据卷即可。

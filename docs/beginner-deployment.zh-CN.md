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
  blockcat233/baker:1.0.2
```

4. 读取首次启动打印出来的管理后台密码：

```bash
docker logs baker
```

5. 打开：

- Web：`http://localhost:3000`
- 管理后台：`http://localhost:3001`

## 容器启动后应该做什么

1. 打开管理后台，用 `docker logs baker` 里看到的密码登录。
2. 先检查服务器名称、注册策略和其他实例设置。
3. 打开主 Web 页面，创建第一个用户。
4. 最好再准备第二个测试账号，或者找一位朋友一起测试语音和直播。

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
  -v baker-data:/var/lib/baker \
  blockcat233/baker:1.0.2
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
docker pull blockcat233/baker:1.0.2
docker rm -f baker
```

然后重新执行原来的 `docker run` 命令，并继续挂载同一个 `baker-data` 数据卷即可。

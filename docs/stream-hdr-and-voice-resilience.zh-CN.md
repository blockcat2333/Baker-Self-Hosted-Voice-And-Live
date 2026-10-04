# 直播 HDR 校正与语音连续性

## 直播路径与校正位置

网页端 `apps/web` 和 Electron 桌面端 `apps/desktop` 共用 `packages/client`。屏幕采集在网页端使用 `getDisplayMedia`；Electron 使用选中的屏幕/窗口 ID，通过桌面 `getUserMedia` 采集视频，并按需合并排除 Baker 自身的系统音频。摄像头使用 `getUserMedia`。

`stream-store.captureStream` 应用采集画质后调用 `normalizeStreamHdr`。本地预览、P2P 的 `WebRtcManager` 和 SFU 的 `SfuClientSession` 都使用处理后的同一条视频轨。Gateway 负责会话和信令，mediasoup 转发 RTP，不转码、不校正颜色。观看端包括弹出播放器仍直接使用视频元素播放。

逐帧处理依据 `VideoFrame.colorSpace.transfer` 的标准值 `pq` / `hlg`。SDR 直接通过；不能根据屏幕支持 HDR、画面亮度、广色域或 Windows HDR 开关猜测输入格式。

GPU 路径先读取原始 YUV 平面，解码全范围/有限范围，再执行 PQ 或 HLG 转换、BT.2020 到 BT.709 色域转换、亮度色调映射和 sRGB 编码。这样避免先让浏览器转换成 SDR 再重复处理。支持 I420/I422/I444 的 8 位与 P10 格式，以及 NV12；其他格式保留原始帧，并显示不支持。

当前采用 203 nit 参考白、1000 nit 标称峰值与亮度驱动的 extended Reinhard 曲线；HLG 使用 1000 nit 标称显示和 1.2 系统 gamma。这里的“自动”是自动检测并转换输入，不是读取显示器校准数据或动态测量场景峰值。输出为 SDR，兼容现有 H.264/VP8/VP9/AV1 直播与 SDR 观看设备，不保留端到端 HDR。

处理器仅保留最新一帧，不积累播放队列；音频不经过视频处理器。停止输出轨会停止原始采集、取消帧流并释放 GPU；原始采集结束会通知直播状态机。画质约束继续传递给原始采集轨。

直播详情显示检测中、SDR、PQ/HLG 已校正、缺少色彩信息、API 不可用或格式不支持。浏览器已经把 HDR 转成 SDR 时，不重复转换；采集阶段若丢失色彩信息、发生错误转换或裁掉高光，本模块无法恢复。Firefox/Safari 等不提供当前帧处理 API 的环境保留原始采集。

## 为什么零丢包也可能有杂音

RTP 丢包、迟到包、播放补偿、麦克风噪声和放大削波是不同问题。包最终抵达也可能错过播放截止时间，此时 `concealedSamples`、`packetsDiscarded` 会增长，RTP 丢包仍可能为零。所有听众同时听到同一人的失真，应同时检查源头采集/放大与共享上行，不能仅据“电流声”断定跨境网络是根因。

旧实现的显示问题包括：

- 客户端上报、Gateway 存储、界面显示都按整数取整，低于 0.5% 的值被显示为 0。
- 发送 RTP 数已经包括途中丢失的包，旧计算又把丢包加到分母，低估了发送方向丢包率。
- Gateway 心跳和媒体统计共用新鲜度判断，旧媒体零丢包值会因心跳持续而看似有效。
- SFU 模式缺少逐人接收/播放统计；发送者的 self report 不能代表某位听众的下行和播放质量。
- 反复读取同一份 RTCP 反馈时，旧实现可能把没有新反馈的周期算成新的零丢包。

现在媒体丢包上报与显示保留两位小数。RTCP 反馈缺失、尚无足够差分数据时为未知；媒体值独立在 15 秒后过期。SDK 按 `localId` 关联反馈，不要求远端反馈额外包含 `kind`，缺少任一活跃音频发送者反馈时不把部分测量当作完整零丢包。

右键成员菜单新增“我接收此人的 RTP 丢包”、接收抖动、实际缓冲、有声音频补偿率、迟到/丢弃包和缓冲目标。它们是当前听众的本地测量，区别于成员 self report。实际缓冲和补偿率使用周期差分，而非整个通话的累计平均；缺少浏览器计数器时显示 `--`。

## 语音防护

- 麦克风处理和放大的远端播放使用 48kHz、`balanced` AudioContext。没有承诺仅调整采样率就能修复硬件或驱动问题。
- 0–200% 放大后增加平滑软限幅，普通幅度保持线性，峰值保留 2% 余量；限幅前预留 WaveShaper 输入域，避免 2 倍信号在曲线入口提前硬削波。
- 音量变化采用 10ms 平滑过渡，减少直接改增益的点击声。
- SFU 语音显式配置 Opus FEC、单声道、48kbps 上限、关闭 DTX；音乐和直播音频不套用该语音配置。FEC 只是恢复能力请求，不保证编码器每一帧都携带冗余，也无法修复录入的硬件噪声。
- P2P 与 SFU 音频接收器都设置自适应 jitter buffer 提示：初始 60ms，按抖动、迟到和有声补偿逐步提升，最多 240ms；连续 15 秒有效且稳定的音频后缓慢降低。代价是问题链路可能增加播放延迟；实际缓冲由浏览器决定。
- 优先使用毫秒单位 `jitterBufferTarget`，旧 Chromium 回退到秒单位 `playoutDelayHint`。不支持提示时继续播放、目标显示未知，不伪造支持状态。视频不应用该语音策略。

## 验证与现场验收

本轮完整单元测试、相关 TypeScript、ESLint、网页与 Electron 生产构建通过。两端的 HDR 合成帧 smoke 验证覆盖 PQ/HLG、8/10 位、NV12、范围编码、灰阶顺序、时间戳、SDR 元数据、SDR 直通和源轨释放。它不等同于实际 Windows HDR 游戏采集或 1440p60 性能验收。

`scripts/voice-audio-smoke.mjs` 使用真实浏览器 OfflineAudioContext 验证普通信号增益与 200% 信号限幅。已测 0.2 信号峰值约 0.200000，2 倍信号输出峰值约 0.980163，检查区间无削波样本。

PowerShell 重跑：

```powershell
node scripts/stream-hdr-smoke.mjs
$env:HDR_BROWSER_CHANNEL = 'electron'
node scripts/stream-hdr-smoke.mjs
Remove-Item Env:HDR_BROWSER_CHANNEL
node scripts/voice-audio-smoke.mjs
```

部署之后应完成以下真实验收：

1. 网页和桌面分别共享 HDR 屏幕/游戏，记录直播详情的输入识别状态；同画面对比原机、主播预览和 SDR 听众端，检查暗部、高光、肤色、分辨率和实际帧率。另用 SDR 内容验证没有重复校正。
2. 美国用户加入深圳入口，用正常输入音量与 200% 分别对比；杂音发生时让至少两位听众记录同一时间窗的实际接收丢包、抖动、有声补偿、迟到包、缓冲和发送者 self report。
3. 若所有听众杂音一致但补偿/迟到指标正常，继续检查美国用户本地麦克风、驱动、系统音效、降噪/AGC 和原始录音；限幅不能消除已经录入的电气噪声。
4. 若多位听众同时出现补偿/迟到增长，检查美国到深圳上行路径和当时 UDP/TCP/TURN 路径，比较缓冲调整前后的杂音与额外延迟。

本轮 NAS 操作为只读检查，未部署这些改动、重启服务或修改基础设施。线上症状尚未现场复测，不应称为已根治。

## 资料

- [W3C WebCodecs](https://www.w3.org/TR/webcodecs/)：VideoFrame、颜色枚举和原始平面布局。
- [W3C 媒体帧处理](https://www.w3.org/TR/mediacapture-transform/)：帧队列与资源生命周期。
- [W3C WebRTC](https://www.w3.org/TR/webrtc/)：接收缓冲目标、单位与浏览器控制边界。
- [W3C WebRTC Statistics](https://www.w3.org/TR/webrtc-stats/)：迟到包与音频补偿计数器。
- [mediasoup RTP 参数](https://mediasoup.org/documentation/v3/mediasoup/rtp-parameters-and-capabilities/)：Opus FEC 参数。

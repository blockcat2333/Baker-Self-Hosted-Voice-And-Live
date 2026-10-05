# 麦克风 RNNoise 降噪

## 使用

网页端及 Baker Desktop 的麦克风、扬声器选择区域增加“麦克风降噪”：

- **普通降噪**：默认选项，使用浏览器内置降噪。
- **RNNoise（AI 降噪）**：用户手动选择后启用；使用本机 CPU、WebAssembly 和 AudioWorklet 处理音频。

选择保存在现有 `baker_client_preferences_v1` 的 `voiceNoiseSuppressionMode` 中。没有记录或记录无效时使用普通降噪；已有用户不会自动开启 RNNoise。用户选择 RNNoise 后，下一次进入频道继续使用该选择。

只处理语音频道的麦克风上行。共享音乐、屏幕共享系统音频及独立摄像头直播音频不经过该模块。接收者无需开启 RNNoise，也可以听到发送者的处理结果。

RNNoise 资源随网站/客户端分发，仅在需要时加载，不依赖外部 CDN、AI 云服务、GPU 或虚拟麦克风驱动。远程网页仍需要 HTTPS 安全上下文。

## 音频链路

```text
普通：麦克风（浏览器 AEC / AGC / NS）→ 输入增益 → 限幅 → 发送音轨
RNNoise：麦克风（浏览器 AEC / AGC，NS 关闭）→ RNNoise → 输入增益 → 限幅 → 同一发送音轨
```

RNNoise 使用 `@jitsi/rnnoise-wasm` **0.2.1** 的同步入口 `dist/rnnoise-sync.js`，避免使用包含旧模型的异步入口。处理为 48 kHz 单声道，480 个采样点一帧，Web Audio 回调通过固定缓冲衔接。缓冲本身引入 10 ms；模型及浏览器的其他延迟另计，不能把它当成端到端新增延迟。

### Chromium 的模式切换

在本机 Edge 154 虚拟麦克风验收中，`applyConstraints({ noiseSuppression: false })` 会更新约束，但 `getSettings()` 仍报告内置降噪开启；并发采集同一设备也可能继承旧采集源的 DSP。

因此模式切换会：

1. 在旧麦克风仍运行时预加载所需 Worklet。
2. 释放旧的麦克风采集，并以目标模式重新采集同一设备。
3. RNNoise 模式要求关闭内置 NS，同时保持 AEC 和 AGC。
4. 在现有 AudioContext 内更换采集源，保留发送音轨和静音状态。

切换会有短暂采集间隙，但不退出语音频道，不为模式切换重新协商 P2P/SFU。麦克风设备切换仍使用已有的替换发送音轨路径。

若选择 RNNoise 失败，保留/恢复原模式并提示；加入频道时遇到不支持的采集约束或模型加载失败，恢复普通降噪后继续加入。若原模式的麦克风也无法重新获取，结束无效本地会话并显示麦克风错误。处理器运行异常时旁路 RNNoise，并重新采集普通降噪音频。切换与换设备串行执行；离开频道会取消旧操作的状态提交。

## 构建和测试

两个 Vite 应用使用 ESM Worklet 构建，避免 Worker 打包把 `import.meta.url` 改成 AudioWorklet 中不存在的 `self.location`。开发期排除 RNNoise 的依赖预优化，避免首次开启造成开发页面重载。共享 client 的 tsup 构建也单独生成 Worklet。

上游许可证从 `packages/client/licenses/RNNOISE-NOTICES.txt` 随构建输出；网页/桌面 renderer 中位于 `third-party/rnnoise-notices.txt`。RNNoise 核心为 BSD 3-Clause，Jitsi WASM 包装为 Apache-2.0。

验证命令：

```powershell
corepack pnpm exec vitest run
corepack pnpm --filter @baker/client typecheck
corepack pnpm --filter @baker/web typecheck
corepack pnpm --filter @baker/desktop typecheck
corepack pnpm --filter @baker/client build
corepack pnpm --filter @baker/web build
corepack pnpm --filter @baker/desktop exec vite build
node scripts/voice-noise-smoke.mjs
```

界面验收（用独立、刚启动的 Vite 实例，避免开发热更新时间戳导致 fixture 导入两份 store）：

```powershell
$env:WEB_PORT='4319'
corepack pnpm --filter @baker/web dev --host 127.0.0.1
# 另一个终端：
$env:NOISE_UI_BASE_URL='http://127.0.0.1:4319'
node scripts/voice-noise-ui-smoke.mjs
```

DSP smoke 使用真实生产 Worklet 和合成噪声；UI smoke 使用真实 Edge、虚拟麦克风及本地模拟的频道加入确认，不依赖账号或运行中的服务器。覆盖默认模式、实际 NS/AEC/AGC 状态、手动切换、故障回退和 390px 布局。P2P/SFU、重连、换麦、静音、取消和恢复失败通过 store 单元测试覆盖。

纳入 1.1.9 / 1.1.9a 发布；升级部署由管理员执行。真实麦克风听感、真人端到端通话、Safari/Firefox、手机后台运行以及长时间 CPU/功耗尚未现场验收。

2026-10-05 本地验证：全量 57 个测试文件、304 项测试通过；client/web/desktop 类型检查及构建通过。真实 Edge 154 的生产 Worklet DSP smoke 与虚拟麦克风 UI smoke 通过。合成噪声的衰减结果只用于确认模型实际处理，不作为真人听感的量化结论。

## 上游资料

- [Jitsi 的网页实时降噪实现](https://jitsi.org/blog/enhanced-noise-suppression-in-jitsi-meet/)
- [Jitsi RNNoise WASM](https://github.com/jitsi/rnnoise-wasm)
- [RNNoise](https://github.com/xiph/rnnoise)
- [AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet)

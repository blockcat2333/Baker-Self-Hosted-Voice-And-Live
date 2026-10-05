# Microphone suppression, recovery and web updates

## Microphone suppression

In Web or Desktop microphone controls, select ordinary suppression (default) or RNNoise. The preference is saved locally. Existing users retain ordinary suppression. RNNoise processes only voice-channel microphone uplink; music, screen audio and separate camera-stream audio bypass it. Receivers need no setting change.

RNNoise is bundled, runs locally on CPU using WebAssembly and AudioWorklet, and does not send audio to an AI service. Remote Web usage requires HTTPS and compatible browser capture constraints. Browser echo cancellation and automatic gain control stay enabled, while built-in suppression is disabled for RNNoise. Switching preloads the model, briefly releases and reacquires the same microphone, and preserves the sending track and mute state. Unsupported constraints, loading or runtime failures restore ordinary suppression and show a message. If capture cannot be restored, rejoin after checking permissions/device availability.

The model processes 480 samples per frame at 48 kHz. Its buffering adds 10 ms; this is not a measurement of total call latency. Licenses ship at `third-party/rnnoise-notices.txt`. Verify both modes, mute, device switching and fallback on the target browser. Real listening quality, Safari/Firefox, mobile background behavior and long-running power use require field testing.

## Recovery and shared music

Install the matching desktop release and update the Media service. Temporary ICE disconnection keeps transport ownership; retries reuse registered sessions and release failed consumers. Music mute and volume controls remain visible in voice channels during reconnects. Existing stream bitrate defaults remain unchanged. Test a short network interruption and simultaneous voice/live usage in the affected network; automated state tests do not prove every real congestion failure is resolved.

## Web update detection and hosting

Deploy the entire web build, including `web-build.json`, together. The browser checks the build identifier on load, focus/visibility and every 60 seconds while visible, then offers a manual refresh. It never refreshes an ongoing call automatically. Network failures and old servers without the identifier are ignored. Existing old tabs need one manual refresh to get the feature.

The all-in-one image disables entry-page caching and returns 404 for missing `/assets/*`. With separate hosting, set `Cache-Control: no-store, no-cache, must-revalidate` for entry pages and the build identifier; do not let a proxy/CDN override it. Verify response headers, a missing asset response and the update notice after deploying a different build. If an update fails, try a hard refresh and inspect capture permissions and the browser console. Rollback must restore complete assets and server configuration together. Persisted settings need no migration.

Chinese details: [RNNoise](voice-rnnoise.zh-CN.md), [recovery](music-volume-and-live-recovery.zh-CN.md), [web updates](web-cache-and-update.zh-CN.md).

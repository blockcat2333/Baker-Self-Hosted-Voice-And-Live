# Baker Lite

Baker Lite is the Windows x64 native Baker client. It uses C++20 and Qt 6.8.3
Widgets and deliberately has no Electron, Node.js, React, Chromium, QML, Qt
Quick, or Qt WebEngine runtime.

## Prerequisites

- Windows 10 1809 or newer, or Windows 11, x64
- Visual Studio 2022 with **Desktop development with C++** and a Windows SDK
- CMake 3.24 or newer
- Git and Python 3.9 or newer
- NSIS is bootstrapped into the dependency cache when producing an installer

Dependencies are stored outside the repository. The default cache is
`%LOCALAPPDATA%\BakerLite\deps`; override it with
`BAKER_LITE_DEPS_ROOT` or the scripts' `-CacheRoot` parameter.

## Shell build

The shell build contains the complete Qt UI, REST/WebSocket stack, and local
state but does not link WebRTC. It is the fast development configuration:

```powershell
.\scripts\bootstrap-dependencies.ps1 -Component Qt
.\scripts\build.ps1 -Configuration Debug
```

`CMakePresets.json` also exposes `windows-x64-shell`, `shell-debug`, and
`shell-release`.

## Native media build

The full media dependency bootstrap checks out and verifies:

- libmediasoupclient 3.5.0. `643a09a6c4244618330c0e75531ace5bbc1bda0d`
  is its annotated tag object; the peeled source commit is
  `e345bc4720b8d7cf679e95bde93913969c9cd01d`.
- libwebrtc m140 / `branch-heads/7339` at
  `36ea4535a500ac137dbf1f577ce40dc1aaa774ef`.
- libsdptransform 1.2.10 at
  `e33aba7005c563286b19a8c90b9520a4384cc259`.

The WebRTC checkout is large and its build is long-running:

```powershell
.\scripts\bootstrap-dependencies.ps1 -Component All
.\scripts\build.ps1 -WithWebRTC -Configuration Release
```

To fetch and run WebRTC hooks without compiling `libwebrtc.lib`, pass
`-SkipWebRtcBuild`. The generated GN configuration uses the pinned ClangCL
toolchain, x64, C++20-compatible headers, RTTI, the DLL CRT-compatible Windows
configuration, H.264, and no examples or tests. CMake keeps Baker Lite and
libmediasoupclient on `/MD` (`/MDd` for Debug).

## Tests

Tests under `tests/` are discovered as individual Qt Test executables:

```powershell
.\scripts\build.ps1 -Configuration Debug
.\scripts\test.ps1 -Configuration Debug

# Full native media configuration
.\scripts\build.ps1 -WithWebRTC -Configuration Release
.\scripts\test.ps1 -WithWebRTC -Configuration Release
```

The test wrapper resolves the same CMake/CTest installation as the build
wrapper, avoiding older `ctest.exe` copies that may appear earlier on `PATH`.

## Installer, signing, and update metadata

Run:

```powershell
.\scripts\package.ps1
```

This creates `out\package\Baker-Lite-Setup-<version>-x64.exe` and
`out\package\baker-lite-update.json`. Pass `-WithWebRTC` for the release media
client.

Unsigned packages are the default. For Authenticode signing, set
`BAKER_LITE_SIGN_CERT_THUMBPRINT` and pass `-Sign`, or set
`BAKER_LITE_SIGN_SCRIPT` to a PowerShell script accepting `-FilePath`. Signing
runs before SHA-512 update metadata is generated.

Qt is dynamically deployed with `windeployqt`. Its license files and the
available WebRTC/libmediasoupclient license documents are included in the
installer. See `LICENSES/THIRD_PARTY_NOTICES.md`.

## Release notes

- [Baker Lite 1.1.2a](docs/releases/1.1.2a.md)
- [Baker Lite 1.1.1a](docs/releases/1.1.1a.md)
- [Baker Lite 1.1.1](docs/releases/1.1.1.md)

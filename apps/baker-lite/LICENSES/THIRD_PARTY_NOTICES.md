# Baker Lite third-party notices

Baker Lite is distributed under the repository's GNU Affero General Public
License, version 3. The installer places a copy in `licenses/`.

The native Windows build uses the following separately licensed components:

| Component | Pinned version/revision | License |
| --- | --- | --- |
| Qt | 6.8.3, `msvc2022_64` shared libraries | LGPL-3.0-only, GPL-2.0-only, GPL-3.0-only, or commercial, depending on the selected Qt terms |
| libmediasoupclient | 3.5.0 (`643a09a6c4244618330c0e75531ace5bbc1bda0d` tag object; `e345bc4720b8d7cf679e95bde93913969c9cd01d` commit) | ISC |
| libwebrtc | m140 / `branch-heads/7339`, `36ea4535a500ac137dbf1f577ce40dc1aaa774ef` | BSD-3-Clause plus third-party notices and PATENTS |
| libsdptransform | 1.2.10, `e33aba7005c563286b19a8c90b9520a4384cc259` | MIT |
| aqtinstall | 3.3.0 (build-time only) | MIT |

Qt is dynamically linked. Users may replace the Qt DLLs shipped beside
`Baker Lite.exe` with compatible Qt 6.8 builds. The packaging step copies the
Qt SDK's `LICENSES` directory, while WebRTC and libmediasoupclient license
documents are copied from their pinned source checkouts when media support is
enabled.

Source locations:

- https://code.qt.io/cgit/qt/
- https://github.com/versatica/libmediasoupclient
- https://webrtc.googlesource.com/src
- https://github.com/ibc/libsdptransform
- https://github.com/miurahr/aqtinstall

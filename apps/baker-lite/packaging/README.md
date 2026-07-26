# Windows packaging

`CMakeLists.txt` configures CPack's NSIS generator for a per-user x64 install.
The uninstall registry key is `BakerLite`, separate from the Electron client's
application identity. CPack invokes `windeployqt`, rejects QML, Qt Quick,
Qt WebEngine, Electron, Node, and Chromium runtime files, and names the result:

`Baker-Lite-Setup-<version>-x64.exe`

Run `scripts/package.ps1` to build the installer and
`baker-lite-update.json`. Pass `-Sign` only when an Authenticode certificate or
custom signing hook has been configured.

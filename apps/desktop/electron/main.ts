import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

import { app, BrowserWindow, desktopCapturer, ipcMain, session, shell } from 'electron';
import { NsisUpdater } from 'electron-updater';

import { desktopMediaCapturePatchScript, isDesktopMediaPermissionAllowed } from './desktop-media';
import {
  getWindowAudioLevels,
  isExcludedSystemAudioCaptureAvailable,
  listWindowAudioSources,
  startExcludedSystemAudioCapture,
  startWindowAudioCapture,
  stopAllExcludedSystemAudioCaptures,
  stopExcludedSystemAudioCapture,
  stopWindowAudioCapture,
  type WindowAudioSource,
} from './excluded-system-audio';
import {
  normalizeScreenSourceSelection,
  readDesktopPreferences,
  type ScreenSourceSelection,
  serializeScreenSource,
  type SerializedScreenSource,
  writeDesktopPreferences,
} from './screen-source-picker';
import {
  compareBakerVersions,
  isClientReleaseVersion,
  isVersionGreater,
  normalizeReleaseTag,
} from '../src/versioning';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const releaseBaseUrl =
  'https://github.com/blockcat2333/Baker-Self-Hosted-Voice-And-Live/releases/download';
const githubReleasesUrl =
  'https://api.github.com/repos/blockcat2333/Baker-Self-Hosted-Voice-And-Live/releases?per_page=100';
const serverConfigFile = 'server.json';

function getDesktopIconPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'branding', 'baker-icon.png');
  }

  return path.resolve(currentDirectory, '../../build/icons/baker-icon.png');
}

interface SavedServerConfig {
  apiBaseUrl: string;
  gatewayUrl: string;
  input: string;
  serverVersion: string;
  savedAt: string;
}

interface UpdateEventPayload {
  error?: string;
  feedUrl?: string;
  percent?: number;
  targetVersion?: string;
  state:
    | 'checking'
    | 'available'
    | 'not_available'
    | 'downloading'
    | 'downloaded'
    | 'error';
  version?: string;
}

interface DesktopUpdateVersion {
  assetNames: string[];
  hasInstaller: boolean;
  isLatest: boolean;
  name: string;
  publishedAt: string | null;
  releaseNotes: string | null;
  releaseUrl: string | null;
  tag: string;
}

interface DesktopUpdateVersionsResponse {
  currentVersion: string;
  hasNewer: boolean;
  latestVersion: string | null;
  repository: string;
  versions: DesktopUpdateVersion[];
}

let updateSession:
  | {
      feedUrl: string;
      targetVersion: string;
      updater: NsisUpdater;
    }
  | null = null;
let activeScreenPicker:
  | {
      audio: {
        available: boolean;
        reason: string | null;
        shareAudio: boolean;
      };
      resolve(selection: ScreenSourceSelection | null): void;
      sources: SerializedScreenSource[];
      window: BrowserWindow;
    }
  | null = null;
let activeMusicPicker:
  | {
      resolve(selection: { processId: number } | null): void;
      sources: WindowAudioSource[];
      window: BrowserWindow;
    }
  | null = null;

function getServerConfigPath() {
  return path.join(app.getPath('userData'), serverConfigFile);
}

function getLogFilePath() {
  return path.join(app.getPath('logs'), 'desktop.log');
}

function serializeError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

async function writeLog(scope: string, message: string, details?: unknown) {
  const line = [
    new Date().toISOString(),
    scope,
    message,
    details === undefined ? '' : serializeError(details),
  ]
    .filter(Boolean)
    .join(' | ');

  const logFile = getLogFilePath();
  await fs.mkdir(path.dirname(logFile), { recursive: true });
  await fs.appendFile(logFile, `${line}\n`, 'utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseReleaseAssetNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item): string[] => {
    if (!isRecord(item) || typeof item['name'] !== 'string') {
      return [];
    }
    return [item['name']];
  });
}

function parseDesktopUpdateVersions(value: unknown): DesktopUpdateVersion[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const releases = value.flatMap((item): DesktopUpdateVersion[] => {
    if (!isRecord(item) || typeof item['tag_name'] !== 'string') {
      return [];
    }

    const tag = normalizeReleaseTag(item['tag_name']);
    if (!isClientReleaseVersion(tag) || item['draft'] === true) {
      return [];
    }

    const assetNames = parseReleaseAssetNames(item['assets']);
    const hasInstaller = assetNames.some((asset) => asset.endsWith('.yml'));

    return [
      {
        assetNames,
        hasInstaller,
        isLatest: false,
        name: typeof item['name'] === 'string' && item['name'] ? item['name'] : `Baker ${tag}`,
        publishedAt: typeof item['published_at'] === 'string' ? item['published_at'] : null,
        releaseNotes: typeof item['body'] === 'string' ? item['body'] : null,
        releaseUrl: typeof item['html_url'] === 'string' ? item['html_url'] : null,
        tag,
      },
    ];
  });

  return releases.sort((left, right) => compareBakerVersions(right.tag, left.tag));
}

async function fetchJson(url: string, headers: Record<string, string> = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Fetch failed for ${url} with HTTP ${response.status}.`);
  }
  return response.json() as Promise<unknown>;
}

async function listDesktopUpdateVersions(): Promise<DesktopUpdateVersionsResponse> {
  const versions = parseDesktopUpdateVersions(
    await fetchJson(githubReleasesUrl, {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Baker-Desktop',
    }),
  );
  const latestVersion = versions[0]?.tag ?? null;
  const currentVersion = app.getVersion();

  return {
    currentVersion,
    hasNewer: latestVersion ? isVersionGreater(latestVersion, currentVersion) : false,
    latestVersion,
    repository: 'blockcat2333/Baker-Self-Hosted-Voice-And-Live',
    versions: versions.map((version) => ({
      ...version,
      isLatest: version.tag === latestVersion,
    })),
  };
}

function publishUpdateEvent(payload: UpdateEventPayload) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('desktop:update-event', payload);
  }
}

function createUpdater(targetVersion: string) {
  const feedUrl = `${releaseBaseUrl}/v${targetVersion}`;
  const updater = new NsisUpdater({
    provider: 'generic',
    url: feedUrl,
  });
  updater.allowDowngrade = true;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;

  updater.on('checking-for-update', () => {
    publishUpdateEvent({ feedUrl, targetVersion, state: 'checking' });
  });
  updater.on('update-available', (info) => {
    publishUpdateEvent({
      feedUrl,
      targetVersion,
      state: 'available',
      version: info.version,
    });
  });
  updater.on('update-not-available', (info) => {
    publishUpdateEvent({
      feedUrl,
      targetVersion,
      state: 'not_available',
      version: info.version,
    });
  });
  updater.on('download-progress', (progress) => {
    publishUpdateEvent({
      feedUrl,
      percent: progress.percent,
      targetVersion,
      state: 'downloading',
    });
  });
  updater.on('update-downloaded', (info) => {
    publishUpdateEvent({
      feedUrl,
      targetVersion,
      state: 'downloaded',
      version: info.version,
    });
  });
  updater.on('error', (error) => {
    const message = serializeError(error);
    publishUpdateEvent({
      error: message,
      feedUrl,
      targetVersion,
      state: 'error',
    });
    void writeLog('update', `Update failed for desktop ${targetVersion} from ${feedUrl}`, error);
  });

  return { feedUrl, updater };
}

function configurePermissions() {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(isDesktopMediaPermissionAllowed(permission));
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) =>
    isDesktopMediaPermissionAllowed(permission),
  );
}

function installDesktopMediaCapturePatch(window: BrowserWindow) {
  window.webContents.on('dom-ready', () => {
    void window.webContents
      .executeJavaScript(desktopMediaCapturePatchScript, true)
      .catch((error) => {
        void writeLog('screen-capture', 'Failed to install desktop media capture patch.', error);
      });
  });
}

function buildScreenPickerDocument() {
  return String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Baker · 选择共享内容</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --bg: #111214;
      --panel: #1e1f22;
      --panel-2: #2b2d31;
      --panel-deep: #0f1012;
      --border: rgba(255, 255, 255, 0.08);
      --border-strong: #5865f2;
      --text: #f2f3f5;
      --muted: #b5bac1;
      --muted-2: #80848e;
      --accent: #5865f2;
      --accent-hover: #4752c4;
      --accent-soft: rgba(88, 101, 242, 0.18);
      --danger: #fa777c;
    }

    * {
      box-sizing: border-box;
    }

    body {
      background: var(--bg);
      color: var(--text);
      margin: 0;
      min-height: 100vh;
      overflow: hidden;
    }

    button,
    input {
      font: inherit;
    }

    button:focus-visible,
    input:focus-visible {
      outline: 2px solid #949cf7;
      outline-offset: 2px;
    }

    .shell {
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr) auto;
      height: 100vh;
      min-width: 0;
    }

    header {
      border-bottom: 1px solid var(--border);
      padding: 20px 24px 18px;
    }

    .brand {
      align-items: center;
      color: var(--muted);
      display: flex;
      font-size: 12px;
      font-weight: 700;
      gap: 9px;
      letter-spacing: 0.02em;
      margin-bottom: 16px;
    }

    .brand-mark {
      align-items: center;
      background: var(--accent);
      border-radius: 9px;
      color: #fff;
      display: inline-flex;
      font-size: 14px;
      height: 28px;
      justify-content: center;
      width: 28px;
    }

    h1 {
      font-size: 24px;
      line-height: 1.15;
      margin: 0;
    }

    .subtitle {
      color: var(--muted);
      font-size: 13px;
      margin: 8px 0 0;
    }

    .toolbar {
      align-items: center;
      border-bottom: 1px solid var(--border);
      display: grid;
      gap: 14px;
      grid-template-columns: auto minmax(180px, 320px);
      padding: 14px 24px;
    }

    .tabs {
      background: var(--panel-deep);
      border: 1px solid var(--border);
      border-radius: 9px;
      display: inline-grid;
      grid-template-columns: repeat(2, minmax(110px, 1fr));
      padding: 3px;
      width: fit-content;
    }

    .tab {
      background: transparent;
      border: 0;
      border-radius: 6px;
      color: var(--muted);
      cursor: pointer;
      min-height: 34px;
      padding: 0 14px;
    }

    .tab[aria-selected="true"] {
      background: var(--panel-2);
      color: #fff;
    }

    .search {
      background: var(--panel-deep);
      border: 1px solid var(--border);
      border-radius: 9px;
      color: var(--text);
      min-height: 40px;
      min-width: 0;
      padding: 0 12px;
      width: 100%;
    }

    .search::placeholder {
      color: var(--muted-2);
    }

    .search:focus {
      border-color: rgba(88, 101, 242, 0.8);
    }

    .content {
      min-height: 0;
      overflow: auto;
      padding: 18px 24px 22px;
    }

    .grid {
      display: grid;
      gap: 14px;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      padding-bottom: 4px;
    }

    .source-card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      color: inherit;
      cursor: pointer;
      display: grid;
      gap: 10px;
      min-width: 0;
      padding: 10px;
      position: relative;
      text-align: left;
      transition: border-color 120ms ease, background 120ms ease, box-shadow 120ms ease, transform 120ms ease;
    }

    .source-card:hover {
      background: #232428;
      border-color: rgba(255, 255, 255, 0.18);
      transform: translateY(-1px);
    }

    .source-card[aria-pressed="true"] {
      background: var(--accent-soft);
      border-color: var(--border-strong);
      box-shadow: 0 0 0 2px rgba(88, 101, 242, 0.3);
    }

    .source-card[aria-pressed="true"]::after {
      align-items: center;
      background: var(--accent);
      border: 3px solid var(--bg);
      border-radius: 50%;
      color: #fff;
      content: "✓";
      display: flex;
      font-size: 12px;
      font-weight: 800;
      height: 25px;
      justify-content: center;
      position: absolute;
      right: 6px;
      top: 6px;
      width: 25px;
    }

    .preview {
      align-items: center;
      aspect-ratio: 16 / 9;
      background: var(--panel-deep);
      border: 1px solid var(--border);
      border-radius: 8px;
      display: flex;
      justify-content: center;
      overflow: hidden;
    }

    .preview img {
      height: 100%;
      object-fit: contain;
      width: 100%;
    }

    .preview-empty {
      color: var(--muted-2);
      font-size: 12px;
    }

    .source-info {
      align-items: center;
      display: grid;
      gap: 9px;
      grid-template-columns: 28px minmax(0, 1fr);
      min-height: 30px;
    }

    .app-icon {
      align-items: center;
      background: var(--panel-2);
      border-radius: 7px;
      display: flex;
      height: 28px;
      justify-content: center;
      overflow: hidden;
      width: 28px;
    }

    .app-icon img {
      height: 100%;
      object-fit: contain;
      width: 100%;
    }

    .app-icon span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }

    .source-name {
      font-size: 13px;
      font-weight: 650;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .source-type {
      color: var(--muted-2);
      font-size: 11px;
      margin-top: 2px;
    }

    .empty {
      align-items: center;
      border: 1px dashed var(--border);
      border-radius: 8px;
      color: var(--muted);
      display: flex;
      min-height: 180px;
      padding: 24px;
    }

    footer {
      align-items: center;
      background: var(--panel);
      border-top: 1px solid var(--border);
      display: grid;
      gap: 16px;
      grid-template-columns: minmax(0, 1fr) auto;
      padding: 14px 24px;
    }

    .audio-row {
      align-items: center;
      background: var(--panel-deep);
      border: 1px solid var(--border);
      border-radius: 10px;
      display: grid;
      gap: 12px;
      grid-template-columns: 34px minmax(0, 1fr) auto;
      min-width: 0;
      padding: 10px 12px;
    }

    .audio-icon {
      align-items: center;
      background: var(--accent-soft);
      border-radius: 8px;
      color: #b9beff;
      display: flex;
      font-size: 16px;
      height: 34px;
      justify-content: center;
      width: 34px;
    }

    .switch {
      align-items: center;
      background: #4e5058;
      border: 0;
      border-radius: 999px;
      cursor: pointer;
      display: inline-flex;
      height: 28px;
      padding: 2px;
      width: 50px;
    }

    .switch[aria-checked="true"] {
      background: var(--accent);
    }

    .switch[aria-disabled="true"] {
      cursor: not-allowed;
      opacity: 0.5;
    }

    .switch-handle {
      background: #fff;
      border-radius: 999px;
      height: 22px;
      transform: translateX(0);
      transition: transform 120ms ease;
      width: 22px;
    }

    .switch[aria-checked="true"] .switch-handle {
      transform: translateX(20px);
    }

    .audio-title {
      font-size: 13px;
      font-weight: 700;
      margin: 0;
    }

    .audio-copy {
      color: var(--muted);
      font-size: 12px;
      margin: 3px 0 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .audio-copy.danger {
      color: var(--danger);
    }

    .actions {
      display: flex;
      gap: 10px;
    }

    .btn {
      border-radius: 4px;
      cursor: pointer;
      font-weight: 700;
      min-height: 38px;
      padding: 0 15px;
    }

    .btn-secondary {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text);
    }

    .btn-primary {
      background: var(--accent);
      border: 1px solid transparent;
      color: #fff;
    }

    .btn-primary:hover:not(:disabled) {
      background: var(--accent-hover);
    }

    .btn-secondary:hover:not(:disabled) {
      background: var(--panel-2);
    }

    .btn:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }

    @media (max-width: 720px) {
      .toolbar,
      footer {
        grid-template-columns: minmax(0, 1fr);
      }

      .tabs {
        width: 100%;
      }

      .actions {
        justify-content: stretch;
      }

      .btn {
        flex: 1;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <div class="brand"><span class="brand-mark">B</span><span>Baker Desktop</span></div>
      <h1>选择共享内容</h1>
      <p class="subtitle">选择一个窗口或整个屏幕；确认前不会开始传输画面。</p>
    </header>
    <section class="toolbar">
      <div class="tabs" role="tablist" aria-label="共享类型">
        <button id="tab-window" class="tab" type="button" role="tab" aria-selected="true">窗口</button>
        <button id="tab-screen" class="tab" type="button" role="tab" aria-selected="false">屏幕</button>
      </div>
      <input id="search" class="search" type="search" placeholder="搜索窗口或屏幕" />
    </section>
    <section id="content" class="content" aria-live="polite"></section>
    <footer>
      <div class="audio-row">
        <span class="audio-icon" aria-hidden="true">♫</span>
        <div>
          <p class="audio-title">共享声音</p>
          <p id="audio-copy" class="audio-copy">直播声音会排除 Baker 自身音频。</p>
        </div>
        <button id="audio-switch" class="switch" type="button" role="switch" aria-label="共享声音" aria-checked="false">
          <span class="switch-handle"></span>
        </button>
      </div>
      <div class="actions">
        <button id="cancel" class="btn btn-secondary" type="button">取消</button>
        <button id="share" class="btn btn-primary" type="button" disabled>开始共享</button>
      </div>
    </footer>
  </main>
  <script>
    const api = window.bakerDesktopScreenPicker;
    const content = document.getElementById('content');
    const search = document.getElementById('search');
    const share = document.getElementById('share');
    const cancel = document.getElementById('cancel');
    const audioSwitch = document.getElementById('audio-switch');
    const audioCopy = document.getElementById('audio-copy');
    const tabs = {
      screen: document.getElementById('tab-screen'),
      window: document.getElementById('tab-window'),
    };
    let sources = [];
    let sourceType = 'window';
    let selectedId = null;
    let shareAudio = false;
    let audioAvailable = false;

    function setSourceType(nextType) {
      sourceType = nextType;
      tabs.window.setAttribute('aria-selected', String(sourceType === 'window'));
      tabs.screen.setAttribute('aria-selected', String(sourceType === 'screen'));
      const first = filteredSources()[0];
      selectedId = first ? first.id : null;
      render();
    }

    function filteredSources() {
      const query = search.value.trim().toLowerCase();
      return sources.filter((source) => {
        if (source.type !== sourceType) return false;
        if (!query) return true;
        return source.name.toLowerCase().includes(query);
      });
    }

    function renderAudio() {
      audioSwitch.setAttribute('aria-checked', String(audioAvailable && shareAudio));
      audioSwitch.setAttribute('aria-disabled', String(!audioAvailable));
      if (audioAvailable) {
        audioCopy.className = 'audio-copy';
        audioCopy.textContent = shareAudio
          ? '直播声音会排除 Baker 自身音频。'
          : '仅共享画面，不共享系统声音。';
      } else {
        audioCopy.className = 'audio-copy danger';
      }
    }

    function render() {
      renderAudio();
      const visibleSources = filteredSources();
      if (!visibleSources.some((source) => source.id === selectedId)) {
        selectedId = visibleSources[0]?.id ?? null;
      }
      share.disabled = !selectedId;

      if (visibleSources.length === 0) {
        content.innerHTML = '<div class="empty">没有匹配的共享来源。</div>';
        return;
      }

      const grid = document.createElement('div');
      grid.className = 'grid';
      for (const source of visibleSources) {
        const button = document.createElement('button');
        button.className = 'source-card';
        button.type = 'button';
        button.setAttribute('aria-pressed', String(source.id === selectedId));
        button.addEventListener('click', () => {
          selectedId = source.id;
          render();
        });

        const preview = document.createElement('div');
        preview.className = 'preview';
        if (source.thumbnailDataUrl) {
          const image = document.createElement('img');
          image.alt = '';
          image.src = source.thumbnailDataUrl;
          preview.appendChild(image);
        } else {
          const empty = document.createElement('span');
          empty.className = 'preview-empty';
          empty.textContent = '无预览';
          preview.appendChild(empty);
        }

        const info = document.createElement('div');
        info.className = 'source-info';
        const icon = document.createElement('div');
        icon.className = 'app-icon';
        if (source.appIconDataUrl) {
          const image = document.createElement('img');
          image.alt = '';
          image.src = source.appIconDataUrl;
          icon.appendChild(image);
        } else {
          const fallback = document.createElement('span');
          fallback.textContent = source.type === 'screen' ? 'S' : 'W';
          icon.appendChild(fallback);
        }
        const label = document.createElement('div');
        const name = document.createElement('div');
        name.className = 'source-name';
        name.title = source.name;
        name.textContent = source.name;
        const type = document.createElement('div');
        type.className = 'source-type';
        type.textContent = source.type === 'screen' ? '整个屏幕' : '应用窗口';
        label.append(name, type);
        info.append(icon, label);
        button.append(preview, info);
        grid.appendChild(button);
      }
      content.replaceChildren(grid);
    }

    tabs.window.addEventListener('click', () => setSourceType('window'));
    tabs.screen.addEventListener('click', () => setSourceType('screen'));
    search.addEventListener('input', render);
    cancel.addEventListener('click', () => void api.cancel());
    audioSwitch.addEventListener('click', () => {
      if (!audioAvailable) return;
      shareAudio = !shareAudio;
      renderAudio();
    });
    share.addEventListener('click', () => {
      if (!selectedId) return;
      void api.select({ sourceId: selectedId, shareAudio: audioAvailable && shareAudio });
    });

    api.getData().then((data) => {
      sources = data.sources;
      audioAvailable = data.audio.available;
      shareAudio = data.audio.available && data.audio.shareAudio;
      if (!data.audio.available) {
        audioCopy.textContent = data.audio.reason || '当前无法共享系统声音。';
      }
      sourceType = sources.some((source) => source.type === 'window') ? 'window' : 'screen';
      setSourceType(sourceType);
      search.focus();
    }).catch(() => {
      content.innerHTML = '<div class="empty">无法加载共享来源。</div>';
    });
  </script>
</body>
</html>`;
}

async function showScreenSourcePicker(
  owner: BrowserWindow | null,
  sources: SerializedScreenSource[],
  audio: { available: boolean; reason: string | null; shareAudio: boolean },
): Promise<ScreenSourceSelection | null> {
  if (activeScreenPicker) {
    activeScreenPicker.window.focus();
    return null;
  }

  return new Promise((resolve) => {
    const pickerWindow = new BrowserWindow({
      autoHideMenuBar: true,
      backgroundColor: '#111214',
      height: 760,
      icon: getDesktopIconPath(),
      minHeight: 600,
      minWidth: 760,
      modal: !!owner,
      parent: owner ?? undefined,
      resizable: true,
      show: false,
      title: 'Baker · 选择共享内容',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(currentDirectory, 'preload.cjs'),
        sandbox: false,
      },
      width: 1040,
    });

    activeScreenPicker = {
      audio,
      resolve,
      sources,
      window: pickerWindow,
    };

    pickerWindow.once('ready-to-show', () => {
      pickerWindow.show();
    });
    pickerWindow.once('closed', () => {
      if (activeScreenPicker?.window === pickerWindow) {
        activeScreenPicker = null;
        resolve(null);
      }
    });
    void pickerWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(buildScreenPickerDocument())}`,
    );
  });
}

async function resolveScreenAudioAvailability() {
  if (process.platform !== 'win32') {
    return {
      available: false,
      reason: '排除 Baker 自身声音的系统音频共享仅支持 Windows。',
    };
  }

  if (!(await isExcludedSystemAudioCaptureAvailable(currentDirectory))) {
    return {
      available: false,
      reason: '需要先构建 Windows 排除音频 helper，才能共享系统声音。',
    };
  }

  return { available: true, reason: null };
}

async function selectScreenSource(owner: BrowserWindow | null): Promise<ScreenSourceSelection | null> {
  const sources = await desktopCapturer.getSources({
    fetchWindowIcons: true,
    thumbnailSize: { height: 180, width: 320 },
    types: ['screen', 'window'],
  });

  if (sources.length === 0) {
    throw new Error('No screen or window source is available.');
  }

  const serializedSources = sources.map(serializeScreenSource);
  const audioAvailability = await resolveScreenAudioAvailability();
  const preferences = await readDesktopPreferences(app.getPath('userData'));
  const audio = {
    ...audioAvailability,
    shareAudio: audioAvailability.available && preferences.shareScreenAudio,
  };

  if (process.env.BAKER_DESKTOP_AUTO_SELECT_SCREEN_SOURCE === '1') {
    return {
      shareAudio: audio.shareAudio,
      sourceId: serializedSources[0]?.id ?? sources[0]!.id,
    };
  }

  const selection = await showScreenSourcePicker(owner, serializedSources, audio);
  if (selection) {
    await writeDesktopPreferences(app.getPath('userData'), {
      shareScreenAudio: audioAvailability.available ? selection.shareAudio : preferences.shareScreenAudio,
    });
  }

  return selection;
}

function buildMusicPickerDocument() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Baker · 共享应用音频</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, "Segoe UI", system-ui, sans-serif;
      --bg: #111214;
      --panel: #1e1f22;
      --panel-2: #2b2d31;
      --deep: #0f1012;
      --border: rgba(255, 255, 255, 0.08);
      --text: #f2f3f5;
      --muted: #b5bac1;
      --muted-2: #80848e;
      --accent: #5865f2;
      --accent-hover: #4752c4;
      --accent-soft: rgba(88, 101, 242, 0.18);
      background: var(--bg);
      color: var(--text);
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: var(--bg); }
    button:focus-visible,
    input:focus-visible { outline: 2px solid #949cf7; outline-offset: 2px; }
    .shell {
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr) auto;
      height: 100vh;
    }
    header {
      border-bottom: 1px solid var(--border);
      padding: 20px 22px 18px;
    }
    .brand {
      align-items: center;
      color: var(--muted);
      display: flex;
      font-size: 12px;
      font-weight: 700;
      gap: 9px;
      margin-bottom: 16px;
    }
    .brand-mark {
      align-items: center;
      background: var(--accent);
      border-radius: 9px;
      color: #fff;
      display: inline-flex;
      font-size: 14px;
      height: 28px;
      justify-content: center;
      width: 28px;
    }
    h1 { font-size: 22px; margin: 0; }
    .subtitle { color: var(--muted); font-size: 13px; margin: 7px 0 0; }
    .notice {
      align-items: flex-start;
      background: var(--accent-soft);
      border: 1px solid rgba(88, 101, 242, 0.35);
      border-radius: 9px;
      color: #c9cdfb;
      display: flex;
      font-size: 12px;
      gap: 9px;
      line-height: 1.5;
      margin-top: 14px;
      padding: 10px 12px;
    }
    .search {
      width: 100%;
      border: 1px solid var(--border);
      border-radius: 9px;
      background: var(--deep);
      color: var(--text);
      font: inherit;
      margin: 14px 22px;
      padding: 11px 12px;
      width: calc(100% - 44px);
    }
    .search::placeholder { color: var(--muted-2); }
    .search:focus { border-color: rgba(88, 101, 242, 0.8); }
    .content {
      min-height: 0;
      overflow: auto;
      border: 1px solid var(--border);
      border-radius: 10px;
      margin: 0 22px 14px;
    }
    .list { display: grid; gap: 1px; }
    .row {
      align-items: center;
      background: var(--panel);
      border: 0;
      color: inherit;
      cursor: pointer;
      display: grid;
      grid-template-columns: 34px minmax(0, 1fr) minmax(90px, 140px) 22px;
      gap: 12px;
      min-height: 62px;
      padding: 10px 14px;
      text-align: left;
      width: 100%;
    }
    .row:hover { background: #232428; }
    .row[aria-pressed="true"] {
      background: var(--accent-soft);
      outline: 1px solid rgba(88, 101, 242, 0.65);
      outline-offset: -1px;
    }
    .source-icon {
      align-items: center;
      background: var(--panel-2);
      border-radius: 9px;
      color: #c9cdfb;
      display: flex;
      font-size: 16px;
      height: 34px;
      justify-content: center;
      width: 34px;
    }
    .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      font-weight: 600;
    }
    .source-copy {
      color: var(--muted-2);
      font-size: 11px;
      margin-top: 3px;
    }
    .meter {
      height: 8px;
      overflow: hidden;
      border-radius: 999px;
      background: #3f4147;
    }
    .meter-fill {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #5865f2, #9b84ee);
      transition: width 120ms linear;
    }
    .check {
      align-items: center;
      border: 1px solid #4e5058;
      border-radius: 50%;
      color: transparent;
      display: flex;
      font-size: 11px;
      height: 20px;
      justify-content: center;
      width: 20px;
    }
    .row[aria-pressed="true"] .check {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }
    .empty {
      color: var(--muted);
      font-size: 13px;
      padding: 18px;
    }
    footer {
      align-items: center;
      background: var(--panel);
      border-top: 1px solid var(--border);
      display: grid;
      gap: 10px;
      grid-template-columns: minmax(0, 1fr) auto;
      padding: 14px 22px;
    }
    .selection-summary {
      color: var(--muted);
      font-size: 12px;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .actions {
      display: flex;
      gap: 10px;
    }
    .btn {
      border-radius: 4px;
      cursor: pointer;
      font: inherit;
      font-size: 13px;
      font-weight: 700;
      padding: 9px 14px;
    }
    .btn-secondary {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text);
    }
    .btn-primary {
      background: var(--accent);
      border: 1px solid transparent;
      color: #fff;
    }
    .btn-secondary:hover:not(:disabled) { background: var(--panel-2); }
    .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
    .btn:disabled { cursor: not-allowed; opacity: 0.5; }
    @media (max-width: 620px) {
      .row { grid-template-columns: 34px minmax(0, 1fr) 22px; }
      .meter { display: none; }
      footer { grid-template-columns: minmax(0, 1fr); }
      .actions .btn { flex: 1; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <div class="brand"><span class="brand-mark">B</span><span>Baker Desktop</span></div>
      <h1>共享应用音频</h1>
      <p class="subtitle">选择一个正在播放声音的应用。</p>
      <div class="notice"><span aria-hidden="true">♫</span><span>只共享所选应用及其子进程的声音，不会混入其他系统声音；窗口名称仅在本机处理。</span></div>
    </header>
    <input id="search" class="search" type="search" placeholder="搜索应用或窗口" />
    <section id="content" class="content" aria-live="polite"></section>
    <footer>
      <div id="selection-summary" class="selection-summary">请选择要共享声音的应用</div>
      <div class="actions">
        <button id="cancel" class="btn btn-secondary" type="button">取消</button>
        <button id="share" class="btn btn-primary" type="button" disabled>共享此应用</button>
      </div>
    </footer>
  </main>
  <script>
    const api = window.bakerDesktopMusicPicker;
    const content = document.getElementById('content');
    const search = document.getElementById('search');
    const share = document.getElementById('share');
    const cancel = document.getElementById('cancel');
    const selectionSummary = document.getElementById('selection-summary');
    let sources = [];
    let selectedId = null;
    let levels = {};

    function filteredSources() {
      const query = search.value.trim().toLowerCase();
      return sources.filter((source) => !query || source.title.toLowerCase().includes(query));
    }

    function render() {
      const visible = filteredSources();
      if (!visible.some((source) => source.id === selectedId)) {
        selectedId = visible[0]?.id ?? null;
      }
      share.disabled = !selectedId;
      const selectedSource = visible.find((source) => source.id === selectedId);
      selectionSummary.textContent = selectedSource
        ? '将共享：' + selectedSource.title
        : '请选择要共享声音的应用';
      if (visible.length === 0) {
        content.innerHTML = '<div class="empty">没有找到可共享音频的应用窗口。</div>';
        return;
      }

      const list = document.createElement('div');
      list.className = 'list';
      for (const source of visible) {
        const row = document.createElement('button');
        row.className = 'row';
        row.type = 'button';
        row.setAttribute('aria-pressed', String(source.id === selectedId));
        row.addEventListener('click', () => {
          selectedId = source.id;
          render();
        });

        const icon = document.createElement('div');
        icon.className = 'source-icon';
        icon.textContent = '♫';

        const label = document.createElement('div');
        const name = document.createElement('div');
        name.className = 'name';
        name.title = source.title;
        name.textContent = source.title;
        const copy = document.createElement('div');
        copy.className = 'source-copy';
        copy.textContent = '应用音频';
        label.append(name, copy);

        const meter = document.createElement('div');
        meter.className = 'meter';
        const fill = document.createElement('div');
        fill.className = 'meter-fill';
        fill.style.width = Math.round((levels[String(source.processId)] || 0) * 100) + '%';
        meter.appendChild(fill);
        const check = document.createElement('span');
        check.className = 'check';
        check.textContent = '✓';
        check.setAttribute('aria-hidden', 'true');
        row.append(icon, label, meter, check);
        list.appendChild(row);
      }
      content.replaceChildren(list);
    }

    async function refreshLevels() {
      try {
        const processIds = [...new Set(filteredSources().map((source) => source.processId))];
        levels = await api.getLevels(processIds);
        render();
      } catch {}
    }

    search.addEventListener('input', () => {
      render();
      void refreshLevels();
    });
    cancel.addEventListener('click', () => void api.cancel());
    share.addEventListener('click', () => {
      const source = sources.find((candidate) => candidate.id === selectedId);
      if (!source) return;
      void api.select({ processId: source.processId });
    });

    api.getData().then((data) => {
      sources = data.sources;
      selectedId = sources[0]?.id ?? null;
      render();
      search.focus();
      void refreshLevels();
      setInterval(refreshLevels, 500);
    }).catch(() => {
      content.innerHTML = '<div class="empty">无法加载可共享音频的应用窗口。</div>';
    });
  </script>
</body>
</html>`;
}

async function showMusicSourcePicker(
  owner: BrowserWindow | null,
  sources: WindowAudioSource[],
): Promise<{ processId: number } | null> {
  if (activeMusicPicker) {
    activeMusicPicker.window.focus();
    return null;
  }

  return new Promise((resolve) => {
    const pickerWindow = new BrowserWindow({
      autoHideMenuBar: true,
      backgroundColor: '#111214',
      height: 650,
      icon: getDesktopIconPath(),
      minHeight: 500,
      minWidth: 560,
      modal: !!owner,
      parent: owner ?? undefined,
      resizable: true,
      show: false,
      title: 'Baker · 共享应用音频',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(currentDirectory, 'preload.cjs'),
        sandbox: false,
      },
      width: 760,
    });

    activeMusicPicker = { resolve, sources, window: pickerWindow };
    pickerWindow.once('ready-to-show', () => {
      pickerWindow.show();
    });
    pickerWindow.once('closed', () => {
      if (activeMusicPicker?.window === pickerWindow) {
        activeMusicPicker = null;
        resolve(null);
      }
    });
    void pickerWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildMusicPickerDocument())}`);
  });
}

async function selectMusicSource(owner: BrowserWindow | null): Promise<{ processId: number } | null> {
  if (!(await isExcludedSystemAudioCaptureAvailable(currentDirectory))) {
    throw new Error('Window audio helper is not available. Build the Windows native helper before sharing music.');
  }

  const sources = await listWindowAudioSources(currentDirectory);
  if (sources.length === 0) {
    throw new Error('No window audio source is available.');
  }

  if (process.env.BAKER_DESKTOP_AUTO_SELECT_MUSIC_SOURCE === '1') {
    return { processId: sources[0]!.processId };
  }

  return showMusicSourcePicker(owner, sources);
}

async function createWindow() {
  const window = new BrowserWindow({
    height: 900,
    icon: getDesktopIconPath(),
    minHeight: 700,
    minWidth: 1100,
    title: 'Baker Desktop',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(currentDirectory, 'preload.cjs'),
      sandbox: false,
    },
    width: 1400,
  });

  installDesktopMediaCapturePatch(window);

  window.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      autoHideMenuBar: true,
      icon: getDesktopIconPath(),
      title: 'Baker Stream',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    },
  }));

  if (process.env.VITE_DEV_SERVER_URL) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await window.loadFile(path.resolve(currentDirectory, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  configurePermissions();

  ipcMain.handle('desktop:open-external', async (_event, url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Only HTTP(S) URLs can be opened externally.');
    }
    await shell.openExternal(parsed.toString());
  });

  ipcMain.handle('desktop:select-screen-source', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    try {
      return await selectScreenSource(owner);
    } catch (error) {
      await writeLog('screen-capture', 'Screen source selection failed.', error);
      throw error;
    }
  });

  ipcMain.handle('desktop:select-music-source', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    try {
      return await selectMusicSource(owner);
    } catch (error) {
      await writeLog('music-capture', 'Music source selection failed.', error);
      throw error;
    }
  });

  ipcMain.handle('desktop:screen-picker:get-data', async (event) => {
    if (!activeScreenPicker || activeScreenPicker.window.webContents.id !== event.sender.id) {
      throw new Error('No screen picker is active.');
    }

    return {
      audio: activeScreenPicker.audio,
      sources: activeScreenPicker.sources,
    };
  });

  ipcMain.handle('desktop:screen-picker:select', async (event, rawSelection: unknown) => {
    if (!activeScreenPicker || activeScreenPicker.window.webContents.id !== event.sender.id) {
      throw new Error('No screen picker is active.');
    }

    const picker = activeScreenPicker;
    const selection = normalizeScreenSourceSelection(
      rawSelection,
      picker.sources.map((source) => source.id),
      picker.audio.available,
    );
    activeScreenPicker = null;
    picker.resolve(selection);
    picker.window.close();
  });

  ipcMain.handle('desktop:screen-picker:cancel', async (event) => {
    if (!activeScreenPicker || activeScreenPicker.window.webContents.id !== event.sender.id) {
      return;
    }

    const picker = activeScreenPicker;
    activeScreenPicker = null;
    picker.resolve(null);
    picker.window.close();
  });

  ipcMain.handle('desktop:music-picker:get-data', async (event) => {
    if (!activeMusicPicker || activeMusicPicker.window.webContents.id !== event.sender.id) {
      throw new Error('No music picker is active.');
    }

    return {
      sources: activeMusicPicker.sources,
    };
  });

  ipcMain.handle('desktop:music-picker:get-levels', async (event, rawProcessIds: unknown) => {
    if (!activeMusicPicker || activeMusicPicker.window.webContents.id !== event.sender.id) {
      throw new Error('No music picker is active.');
    }

    if (!Array.isArray(rawProcessIds)) {
      throw new Error('Invalid music picker process list.');
    }

    const availableProcessIds = new Set(activeMusicPicker.sources.map((source) => source.processId));
    const processIds = [
      ...new Set(
        rawProcessIds.filter(
          (processId): processId is number =>
            Number.isInteger(processId) && processId > 0 && availableProcessIds.has(processId),
        ),
      ),
    ];

    return getWindowAudioLevels(currentDirectory, processIds);
  });

  ipcMain.handle('desktop:music-picker:select', async (event, rawSelection: unknown) => {
    if (!activeMusicPicker || activeMusicPicker.window.webContents.id !== event.sender.id) {
      throw new Error('No music picker is active.');
    }

    if (!rawSelection || typeof rawSelection !== 'object') {
      throw new Error('Invalid music source selection.');
    }

    const processId = (rawSelection as { processId?: unknown }).processId;
    if (
      typeof processId !== 'number' ||
      !Number.isInteger(processId) ||
      !activeMusicPicker.sources.some((source) => source.processId === processId)
    ) {
      throw new Error('Invalid music source selection.');
    }

    const picker = activeMusicPicker;
    activeMusicPicker = null;
    picker.resolve({ processId });
    picker.window.close();
  });

  ipcMain.handle('desktop:music-picker:cancel', async (event) => {
    if (!activeMusicPicker || activeMusicPicker.window.webContents.id !== event.sender.id) {
      return;
    }

    const picker = activeMusicPicker;
    activeMusicPicker = null;
    picker.resolve(null);
    picker.window.close();
  });

  ipcMain.handle('desktop:excluded-audio-start', async (event) => {
    try {
      return await startExcludedSystemAudioCapture(currentDirectory, event.sender);
    } catch (error) {
      await writeLog('screen-capture', 'Excluded system audio capture failed to start.', error);
      throw error;
    }
  });

  ipcMain.handle('desktop:excluded-audio-stop', async (_event, sessionId: string) => {
    stopExcludedSystemAudioCapture(sessionId);
  });

  ipcMain.handle('desktop:window-audio-available', async () => {
    return isExcludedSystemAudioCaptureAvailable(currentDirectory);
  });

  ipcMain.handle('desktop:window-audio-start', async (event, processId: number) => {
    try {
      return await startWindowAudioCapture(currentDirectory, event.sender, processId);
    } catch (error) {
      await writeLog('music-capture', 'Window audio capture failed to start.', error);
      throw error;
    }
  });

  ipcMain.handle('desktop:window-audio-stop', async (_event, sessionId: string) => {
    stopWindowAudioCapture(sessionId);
  });

  ipcMain.handle('desktop:get-app-info', async () => ({
    logsDirectory: app.getPath('logs'),
    platform: process.platform,
    version: app.getVersion(),
  }));

  ipcMain.handle('desktop:get-saved-server', async () => {
    try {
      const raw = await fs.readFile(getServerConfigPath(), 'utf8');
      return JSON.parse(raw) as SavedServerConfig;
    } catch {
      return null;
    }
  });

  ipcMain.handle('desktop:save-server', async (_event, config: SavedServerConfig) => {
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    await fs.writeFile(getServerConfigPath(), JSON.stringify(config, null, 2), 'utf8');
    return config;
  });

  ipcMain.handle('desktop:clear-server', async () => {
    try {
      await fs.unlink(getServerConfigPath());
    } catch {
      // Already cleared.
    }
  });

  ipcMain.handle('desktop:update-versions', async () => {
    try {
      const versions = await listDesktopUpdateVersions();
      await writeLog(
        'update',
        `Checked GitHub releases. app=${app.getVersion()} latest=${versions.latestVersion ?? 'none'} count=${versions.versions.length}`,
      );
      return versions;
    } catch (error) {
      await writeLog('update', 'Failed to read GitHub release versions.', error);
      throw error;
    }
  });

  ipcMain.handle('desktop:update-check', async (_event, targetVersion: string) => {
    const version = normalizeReleaseTag(targetVersion);
    if (!isClientReleaseVersion(version)) {
      throw new Error('Desktop updates must use a client release label such as 1.0.5a.');
    }

    const { feedUrl, updater } = createUpdater(version);
    updateSession = { feedUrl, targetVersion: version, updater };
    await writeLog('update', `Checking update. app=${app.getVersion()} target=${version} feed=${feedUrl}`);
    publishUpdateEvent({ feedUrl, targetVersion: version, state: 'checking' });
    await updater.checkForUpdates();
    return { feedUrl };
  });

  ipcMain.handle('desktop:update-download', async () => {
    if (!updateSession) {
      throw new Error('No update check is active.');
    }
    await writeLog(
      'update',
      `Downloading update. app=${app.getVersion()} target=${updateSession.targetVersion} feed=${updateSession.feedUrl}`,
    );
    await updateSession.updater.downloadUpdate();
  });

  ipcMain.handle('desktop:update-install', async () => {
    if (!updateSession) {
      throw new Error('No downloaded update is active.');
    }
    await writeLog(
      'update',
      `Installing update. app=${app.getVersion()} target=${updateSession.targetVersion} feed=${updateSession.feedUrl}`,
    );
    updateSession.updater.quitAndInstall(false, true);
  });

  ipcMain.handle('desktop:open-logs', async () => {
    await fs.mkdir(app.getPath('logs'), { recursive: true });
    await shell.openPath(app.getPath('logs'));
  });

  ipcMain.handle('desktop:log-error', async (_event, payload: { message: string; scope: string; stack?: string }) => {
    await writeLog(payload.scope, payload.message, payload.stack);
  });

  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopAllExcludedSystemAudioCaptures();
    app.quit();
  }
});

app.on('before-quit', () => {
  stopAllExcludedSystemAudioCaptures();
});

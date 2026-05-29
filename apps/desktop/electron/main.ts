import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

import { app, BrowserWindow, desktopCapturer, ipcMain, session, shell } from 'electron';
import { NsisUpdater } from 'electron-updater';

import { desktopMediaCapturePatchScript, isDesktopMediaPermissionAllowed } from './desktop-media';
import {
  isExcludedSystemAudioCaptureAvailable,
  startExcludedSystemAudioCapture,
  stopAllExcludedSystemAudioCaptures,
  stopExcludedSystemAudioCapture,
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
  <title>Baker Screen Share</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --bg: #0b1220;
      --panel: #111827;
      --panel-2: #0f172a;
      --border: rgba(148, 163, 184, 0.2);
      --border-strong: rgba(125, 211, 252, 0.72);
      --text: #f8fafc;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --accent-soft: rgba(56, 189, 248, 0.16);
      --danger: #fca5a5;
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

    .shell {
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr) auto;
      height: 100vh;
      min-width: 0;
    }

    header {
      border-bottom: 1px solid var(--border);
      padding: 22px 24px 18px;
    }

    h1 {
      font-size: 22px;
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
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid var(--border);
      border-radius: 8px;
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
      background: rgba(148, 163, 184, 0.16);
      color: var(--text);
    }

    .search {
      background: rgba(2, 6, 23, 0.34);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      min-height: 40px;
      min-width: 0;
      padding: 0 12px;
      width: 100%;
    }

    .search::placeholder {
      color: #64748b;
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
      border-radius: 8px;
      color: inherit;
      cursor: pointer;
      display: grid;
      gap: 10px;
      min-width: 0;
      padding: 10px;
      text-align: left;
      transition: border-color 120ms ease, background 120ms ease, transform 120ms ease;
    }

    .source-card:hover {
      background: #162033;
      border-color: rgba(148, 163, 184, 0.42);
      transform: translateY(-1px);
    }

    .source-card[aria-pressed="true"] {
      background: var(--accent-soft);
      border-color: var(--border-strong);
    }

    .preview {
      align-items: center;
      aspect-ratio: 16 / 9;
      background: #020617;
      border: 1px solid rgba(148, 163, 184, 0.12);
      border-radius: 6px;
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
      color: #64748b;
      font-size: 12px;
    }

    .source-info {
      align-items: center;
      display: grid;
      gap: 9px;
      grid-template-columns: 24px minmax(0, 1fr);
      min-height: 30px;
    }

    .app-icon {
      align-items: center;
      background: rgba(148, 163, 184, 0.14);
      border-radius: 6px;
      display: flex;
      height: 24px;
      justify-content: center;
      overflow: hidden;
      width: 24px;
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
      background: rgba(15, 23, 42, 0.96);
      border-top: 1px solid var(--border);
      display: grid;
      gap: 16px;
      grid-template-columns: minmax(0, 1fr) auto;
      padding: 14px 24px;
    }

    .audio-row {
      align-items: center;
      display: grid;
      gap: 12px;
      grid-template-columns: auto minmax(0, 1fr);
      min-width: 0;
    }

    .switch {
      align-items: center;
      background: rgba(148, 163, 184, 0.18);
      border: 1px solid rgba(148, 163, 184, 0.28);
      border-radius: 999px;
      cursor: pointer;
      display: inline-flex;
      height: 28px;
      padding: 2px;
      width: 50px;
    }

    .switch[aria-checked="true"] {
      background: rgba(56, 189, 248, 0.28);
      border-color: rgba(56, 189, 248, 0.62);
    }

    .switch[aria-disabled="true"] {
      cursor: not-allowed;
      opacity: 0.5;
    }

    .switch-handle {
      background: #e2e8f0;
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
      border-radius: 8px;
      cursor: pointer;
      font-weight: 700;
      min-height: 38px;
      padding: 0 15px;
    }

    .btn-secondary {
      background: rgba(148, 163, 184, 0.1);
      border: 1px solid var(--border);
      color: var(--text);
    }

    .btn-primary {
      background: var(--accent);
      border: 1px solid transparent;
      color: #082f49;
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
      <h1>选择共享内容</h1>
      <p class="subtitle">选择一个窗口或整个屏幕进行直播。</p>
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
        <button id="audio-switch" class="switch" type="button" role="switch" aria-checked="false">
          <span class="switch-handle"></span>
        </button>
        <div>
          <p class="audio-title">共享声音</p>
          <p id="audio-copy" class="audio-copy">直播声音会排除 Baker 自身音频。</p>
        </div>
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
        const name = document.createElement('div');
        name.className = 'source-name';
        name.title = source.name;
        name.textContent = source.name;
        info.append(icon, name);
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
      height: 720,
      icon: getDesktopIconPath(),
      modal: !!owner,
      parent: owner ?? undefined,
      resizable: true,
      show: false,
      title: 'Baker Screen Share',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(currentDirectory, 'preload.cjs'),
        sandbox: false,
      },
      width: 980,
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

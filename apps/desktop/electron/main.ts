import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, session, shell } from 'electron';
import { NsisUpdater } from 'electron-updater';

import { desktopMediaCapturePatchScript, isDesktopMediaPermissionAllowed } from './desktop-media';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const releaseBaseUrl =
  'https://github.com/blockcat2333/Baker-Self-Hosted-Voice-And-Live/releases/download';
const serverConfigFile = 'server.json';

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
  serverVersion?: string;
  state:
    | 'checking'
    | 'available'
    | 'not_available'
    | 'downloading'
    | 'downloaded'
    | 'error';
  version?: string;
}

let updateSession:
  | {
      feedUrl: string;
      serverVersion: string;
      updater: NsisUpdater;
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

function publishUpdateEvent(payload: UpdateEventPayload) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('desktop:update-event', payload);
  }
}

function createUpdater(serverVersion: string) {
  const feedUrl = `${releaseBaseUrl}/v${serverVersion}`;
  const updater = new NsisUpdater({
    provider: 'generic',
    url: feedUrl,
  });
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;

  updater.on('checking-for-update', () => {
    publishUpdateEvent({ feedUrl, serverVersion, state: 'checking' });
  });
  updater.on('update-available', (info) => {
    publishUpdateEvent({
      feedUrl,
      serverVersion,
      state: 'available',
      version: info.version,
    });
  });
  updater.on('update-not-available', (info) => {
    publishUpdateEvent({
      feedUrl,
      serverVersion,
      state: 'not_available',
      version: info.version,
    });
  });
  updater.on('download-progress', (progress) => {
    publishUpdateEvent({
      feedUrl,
      percent: progress.percent,
      serverVersion,
      state: 'downloading',
    });
  });
  updater.on('update-downloaded', (info) => {
    publishUpdateEvent({
      feedUrl,
      serverVersion,
      state: 'downloaded',
      version: info.version,
    });
  });
  updater.on('error', (error) => {
    const message = serializeError(error);
    publishUpdateEvent({
      error: message,
      feedUrl,
      serverVersion,
      state: 'error',
    });
    void writeLog('update', `Update failed for server ${serverVersion} from ${feedUrl}`, error);
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

function getScreenSourceLabel(source: Electron.DesktopCapturerSource, index: number) {
  const kind = source.id.startsWith('screen:') ? 'Screen' : 'Window';
  const name = source.name.trim() || source.id;
  const label = `${kind} ${index + 1}: ${name}`;
  return label.length > 72 ? `${label.slice(0, 69)}...` : label;
}

async function showScreenSourcePicker(
  owner: BrowserWindow | null,
  sources: Electron.DesktopCapturerSource[],
) {
  if (process.env.BAKER_DESKTOP_AUTO_SELECT_SCREEN_SOURCE === '1') {
    return sources[0]?.id ?? null;
  }

  const visibleSources = sources.slice(0, 12);
  const buttons = [...visibleSources.map(getScreenSourceLabel), 'Cancel'];
  const options = {
    buttons,
    cancelId: buttons.length - 1,
    defaultId: 0,
    detail:
      sources.length > visibleSources.length
        ? `Showing the first ${visibleSources.length} of ${sources.length} available sources. Close unused windows if the source is not listed.`
        : 'Select a screen or window to share in the livestream.',
    message: 'Choose what to share',
    noLink: true,
    title: 'Baker Screen Share',
    type: 'question' as const,
  };
  const result = owner
    ? await dialog.showMessageBox(owner, options)
    : await dialog.showMessageBox(options);

  if (result.response < 0 || result.response >= visibleSources.length) {
    return null;
  }

  return visibleSources[result.response]?.id ?? null;
}

async function selectScreenSource(owner: BrowserWindow | null) {
  const sources = await desktopCapturer.getSources({
    fetchWindowIcons: true,
    thumbnailSize: { height: 180, width: 320 },
    types: ['screen', 'window'],
  });

  if (sources.length === 0) {
    throw new Error('No screen or window source is available.');
  }

  return showScreenSourcePicker(owner, sources);
}

async function createWindow() {
  const window = new BrowserWindow({
    height: 900,
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

  ipcMain.handle('desktop:update-check', async (_event, serverVersion: string) => {
    const { feedUrl, updater } = createUpdater(serverVersion);
    updateSession = { feedUrl, serverVersion, updater };
    await writeLog('update', `Checking update. app=${app.getVersion()} server=${serverVersion} feed=${feedUrl}`);
    publishUpdateEvent({ feedUrl, serverVersion, state: 'checking' });
    await updater.checkForUpdates();
    return { feedUrl };
  });

  ipcMain.handle('desktop:update-download', async () => {
    if (!updateSession) {
      throw new Error('No update check is active.');
    }
    await writeLog(
      'update',
      `Downloading update. app=${app.getVersion()} server=${updateSession.serverVersion} feed=${updateSession.feedUrl}`,
    );
    await updateSession.updater.downloadUpdate();
  });

  ipcMain.handle('desktop:update-install', async () => {
    if (!updateSession) {
      throw new Error('No downloaded update is active.');
    }
    await writeLog(
      'update',
      `Installing update. app=${app.getVersion()} server=${updateSession.serverVersion} feed=${updateSession.feedUrl}`,
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
    app.quit();
  }
});

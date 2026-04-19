import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, ipcMain, shell } from 'electron';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

async function createWindow() {
  const window = new BrowserWindow({
    height: 900,
    minHeight: 700,
    minWidth: 1100,
    title: 'Baker Desktop',
    webPreferences: {
      contextIsolation: true,
      preload: path.join(currentDirectory, 'preload.mjs'),
    },
    width: 1400,
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await window.loadFile(path.resolve(currentDirectory, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  ipcMain.handle('desktop:open-external', async (_event, url: string) => {
    await shell.openExternal(url);
  });

  ipcMain.handle('desktop:select-screen-source', async () => null);

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

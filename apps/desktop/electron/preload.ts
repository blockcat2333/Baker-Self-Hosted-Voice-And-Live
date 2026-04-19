import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('bakerDesktop', {
  async openExternal(url: string) {
    await ipcRenderer.invoke('desktop:open-external', url);
  },
  platform: 'desktop' as const,
  async selectScreenSource() {
    return (await ipcRenderer.invoke('desktop:select-screen-source')) as string | null;
  },
});

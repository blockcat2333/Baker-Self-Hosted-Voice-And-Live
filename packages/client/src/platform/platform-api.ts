export interface PlatformApi {
  name: 'desktop' | 'web';
  openExternal(url: string): Promise<void>;
  selectScreenSource(): Promise<string | null>;
}

export function createBrowserPlatformApi(): PlatformApi {
  return {
    name: 'web',
    async openExternal(url: string) {
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    async selectScreenSource() {
      return null;
    },
  };
}

declare global {
  interface Window {
    bakerDesktop?: {
      openExternal(url: string): Promise<void>;
      platform: 'desktop';
      selectScreenSource(): Promise<string | null>;
    };
  }
}

export function createDesktopPlatformApi(): PlatformApi {
  return {
    name: 'desktop',
    async openExternal(url: string) {
      await window.bakerDesktop?.openExternal(url);
    },
    async selectScreenSource() {
      return (await window.bakerDesktop?.selectScreenSource()) ?? null;
    },
  };
}

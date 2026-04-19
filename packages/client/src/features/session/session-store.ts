import { create } from 'zustand';

import type { ConnectionState } from '@baker/protocol';

interface SessionState {
  apiBaseUrl: string;
  connectionState: ConnectionState;
  gatewayUrl: string;
  mediaBaseUrl: string;
  platform: 'desktop' | 'web';
  setConnectionState(state: ConnectionState): void;
  setRuntimeConfig(config: Omit<SessionState, 'connectionState' | 'setConnectionState' | 'setRuntimeConfig'>): void;
}

export const useSessionStore = create<SessionState>((set) => ({
  apiBaseUrl: 'http://localhost:3001',
  connectionState: 'closed',
  gatewayUrl: 'ws://localhost:3002/ws',
  mediaBaseUrl: 'http://localhost:3003',
  platform: 'web',
  setConnectionState: (connectionState) => set({ connectionState }),
  setRuntimeConfig: (config) => set(config),
}));

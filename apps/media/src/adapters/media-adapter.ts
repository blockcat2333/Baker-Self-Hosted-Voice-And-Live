import type { MediaCapabilities, MediaSessionDescriptor, SessionMode } from '@baker/protocol';

export interface MediaSessionRecord {
  descriptor: MediaSessionDescriptor;
  mode: SessionMode;
  state: 'idle' | 'prepared';
}

export interface MediaAdapter {
  createSession(input: MediaSessionDescriptor): Promise<MediaSessionRecord>;
  getCapabilities(): MediaCapabilities;
  getHealth(): { backend: string; status: 'ok' };
}

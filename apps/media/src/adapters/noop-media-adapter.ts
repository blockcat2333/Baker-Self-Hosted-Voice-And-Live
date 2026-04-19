import type { MediaSessionDescriptor } from '@baker/protocol';

import type { MediaAdapter, MediaSessionRecord } from './media-adapter';

export class NoopMediaAdapter implements MediaAdapter {
  async createSession(input: MediaSessionDescriptor): Promise<MediaSessionRecord> {
    return {
      descriptor: input,
      mode: input.mode,
      state: 'prepared',
    };
  }

  getCapabilities() {
    return {
      deviceSwitch: true,
      metrics: true,
      simulcast: false,
      speakerSelection: true,
    };
  }

  getHealth() {
    return {
      backend: 'noop',
      status: 'ok' as const,
    };
  }
}

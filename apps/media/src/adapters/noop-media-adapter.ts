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
      sfu: {
        available: false,
        configured: false,
        requiredAnnouncedIp: true,
      },
    };
  }

  getHealth() {
    return {
      backend: 'noop',
      status: 'ok' as const,
    };
  }

  async closeSfu(): Promise<{ closedProducer?: never }> {
    throw new Error('SFU mode is not available in the noop media adapter.');
  }

  async connectSfuTransport(): Promise<void> {
    throw new Error('SFU mode is not available in the noop media adapter.');
  }

  async consumeSfu(): Promise<never> {
    throw new Error('SFU mode is not available in the noop media adapter.');
  }

  async createSfuTransport(): Promise<never> {
    throw new Error('SFU mode is not available in the noop media adapter.');
  }

  async getSfuSessionInfo(): Promise<never> {
    throw new Error('SFU mode is not available in the noop media adapter.');
  }

  async produceSfu(): Promise<never> {
    throw new Error('SFU mode is not available in the noop media adapter.');
  }

  async resumeSfuConsumer(): Promise<void> {
    throw new Error('SFU mode is not available in the noop media adapter.');
  }
}

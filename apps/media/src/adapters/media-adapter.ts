import type {
  MediaCapabilities,
  MediaSessionDescriptor,
  SessionMode,
  SfuProducer,
  SfuSessionInfo,
} from '@baker/protocol';

export interface MediaSessionRecord {
  descriptor: MediaSessionDescriptor;
  mode: SessionMode;
  state: 'idle' | 'prepared';
}

export interface MediaAdapter {
  createSession(input: MediaSessionDescriptor): Promise<MediaSessionRecord>;
  getCapabilities(): MediaCapabilities;
  getHealth(): { backend: string; status: 'ok' };
  closeSfu(input: SfuSessionInput & {
    consumerId?: string;
    producerId?: string;
    transportId?: string;
  }): Promise<{ closedProducer?: SfuProducer }>;
  connectSfuTransport(input: SfuSessionInput & {
    dtlsParameters: Record<string, unknown>;
    transportId: string;
  }): Promise<void>;
  consumeSfu(input: SfuSessionInput & {
    producerId: string;
    rtpCapabilities: Record<string, unknown>;
    transportId: string;
  }): Promise<{
    consumerId: string;
    id: string;
    kind: 'audio' | 'video';
    producerId: string;
    producerPaused: boolean;
    rtpParameters: Record<string, unknown>;
    type: string;
  }>;
  createSfuTransport(input: SfuSessionInput & {
    direction: 'recv' | 'send';
  }): Promise<{
    direction: 'recv' | 'send';
    transportOptions: {
      dtlsParameters: Record<string, unknown>;
      iceCandidates: Record<string, unknown>[];
      iceParameters: Record<string, unknown>;
      id: string;
      sctpParameters?: Record<string, unknown>;
    };
  }>;
  getSfuSessionInfo(input: MediaSessionDescriptor): Promise<SfuSessionInfo>;
  produceSfu(input: SfuSessionInput & {
    appData?: Record<string, unknown>;
    kind: 'audio' | 'video';
    rtpParameters: Record<string, unknown>;
    transportId: string;
    userId: string;
  }): Promise<{ producer: SfuProducer; producerId: string }>;
  resumeSfuConsumer(input: SfuSessionInput & {
    consumerId: string;
  }): Promise<void>;
}

export interface SfuSessionInput {
  channelId: string;
  mode: SessionMode;
  sessionId: string;
  streamId?: string;
}

import { createWorker, type types } from 'mediasoup';

import type { AppEnv } from '@baker/shared';
import type {
  MediaCapabilities,
  MediaSessionDescriptor,
  SfuProducer,
  SfuSessionInfo,
} from '@baker/protocol';

import type { MediaAdapter, MediaSessionRecord, SfuSessionInput } from './media-adapter';

type RouterMediaCodec = Omit<types.RtpCodecCapability, 'preferredPayloadType'> & {
  preferredPayloadType?: number;
};

const mediaCodecs: RouterMediaCodec[] = [
  {
    channels: 2,
    clockRate: 48000,
    kind: 'audio',
    mimeType: 'audio/opus',
  },
  {
    clockRate: 90000,
    kind: 'video',
    mimeType: 'video/VP8',
    parameters: {
      'x-google-start-bitrate': 1000,
    },
    rtcpFeedback: [
      { type: 'nack' },
      { parameter: 'pli', type: 'nack' },
      { type: 'ccm', parameter: 'fir' },
      { type: 'goog-remb' },
      { type: 'transport-cc' },
    ],
  },
  {
    clockRate: 90000,
    kind: 'video',
    mimeType: 'video/H264',
    parameters: {
      'level-asymmetry-allowed': 1,
      'packetization-mode': 1,
      'profile-level-id': '42e01f',
    },
    rtcpFeedback: [
      { type: 'nack' },
      { parameter: 'pli', type: 'nack' },
      { type: 'ccm', parameter: 'fir' },
      { type: 'goog-remb' },
      { type: 'transport-cc' },
    ],
  },
];

interface SfuTransportRecord {
  direction: 'recv' | 'send';
  transport: types.WebRtcTransport;
}

interface SfuSessionRecord {
  consumers: Map<string, types.Consumer>;
  descriptor: MediaSessionDescriptor;
  producers: Map<string, types.Producer>;
  transports: Map<string, SfuTransportRecord>;
}

interface SfuProducerRecord {
  producer: types.Producer;
  summary: SfuProducer;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  return value as Record<string, unknown>[];
}

export class MediasoupMediaAdapter implements MediaAdapter {
  private worker: types.Worker | null = null;
  private workerPromise: Promise<types.Worker> | null = null;
  private readonly routers = new Map<string, types.Router>();
  private readonly sessions = new Map<string, SfuSessionRecord>();
  private readonly producers = new Map<string, SfuProducerRecord>();

  constructor(private readonly env: AppEnv) {}

  async createSession(input: MediaSessionDescriptor): Promise<MediaSessionRecord> {
    if (!this.sessions.has(input.sessionId)) {
      this.sessions.set(input.sessionId, {
        consumers: new Map(),
        descriptor: input,
        producers: new Map(),
        transports: new Map(),
      });
    }

    return {
      descriptor: input,
      mode: input.mode,
      state: 'prepared',
    };
  }

  getCapabilities(): MediaCapabilities {
    return {
      deviceSwitch: true,
      metrics: true,
      simulcast: false,
      speakerSelection: true,
      sfu: {
        available: true,
        configured: this.isSfuConfigured(),
        requiredAnnouncedIp: true,
      },
    };
  }

  getHealth() {
    return {
      backend: 'mediasoup',
      status: 'ok' as const,
    };
  }

  async getSfuSessionInfo(input: MediaSessionDescriptor): Promise<SfuSessionInfo> {
    const router = await this.getRouter(input.channelId);
    return {
      producers: this.listProducers(input),
      routerRtpCapabilities: toRecord(router.rtpCapabilities),
    };
  }

  async createSfuTransport(input: SfuSessionInput & { direction: 'recv' | 'send' }) {
    this.assertSfuConfigured();
    const session = this.requireSession(input.sessionId);
    const router = await this.getRouter(input.channelId);
    const transport = await router.createWebRtcTransport({
      enableTcp: this.env.SFU_ENABLE_TCP,
      enableUdp: true,
      initialAvailableOutgoingBitrate: 1_000_000,
      listenInfos: this.createListenInfos(),
      preferUdp: true,
    });

    session.transports.set(transport.id, {
      direction: input.direction,
      transport,
    });

    transport.on('icestatechange', (state) => {
      if (state === 'closed' || state === 'disconnected') {
        session.transports.delete(transport.id);
      }
    });

    return {
      direction: input.direction,
      transportOptions: {
        dtlsParameters: toRecord(transport.dtlsParameters),
        iceCandidates: toRecordArray(transport.iceCandidates),
        iceParameters: toRecord(transport.iceParameters),
        id: transport.id,
        sctpParameters: transport.sctpParameters ? toRecord(transport.sctpParameters) : undefined,
      },
    };
  }

  async connectSfuTransport(input: SfuSessionInput & {
    dtlsParameters: Record<string, unknown>;
    transportId: string;
  }): Promise<void> {
    const transport = this.requireTransport(input.sessionId, input.transportId).transport;
    await transport.connect({ dtlsParameters: input.dtlsParameters as types.DtlsParameters });
  }

  async produceSfu(input: SfuSessionInput & {
    appData?: Record<string, unknown>;
    kind: 'audio' | 'video';
    rtpParameters: Record<string, unknown>;
    transportId: string;
    userId: string;
  }) {
    const session = this.requireSession(input.sessionId);
    const transport = this.requireTransport(input.sessionId, input.transportId);
    if (transport.direction !== 'send') {
      throw new Error('Cannot produce on a recv transport.');
    }

    const producer = await transport.transport.produce({
      appData: input.appData ?? {},
      kind: input.kind,
      rtpParameters: input.rtpParameters as types.RtpParameters,
    });
    const source = input.mode === 'voice'
      ? 'voice'
      : input.mode === 'music_publish' || input.mode === 'music_listen'
        ? 'music'
        : 'stream';
    const summary: SfuProducer = {
      channelId: input.channelId,
      id: producer.id,
      kind: input.kind,
      sessionId: input.sessionId,
      source,
      ...(input.streamId ? { streamId: input.streamId } : {}),
      userId: input.userId,
    };

    session.producers.set(producer.id, producer);
    this.producers.set(producer.id, { producer, summary });
    producer.on('transportclose', () => {
      session.producers.delete(producer.id);
      this.producers.delete(producer.id);
    });
    producer.observer.on('close', () => {
      session.producers.delete(producer.id);
      this.producers.delete(producer.id);
    });

    return {
      producer: summary,
      producerId: producer.id,
    };
  }

  async consumeSfu(input: SfuSessionInput & {
    producerId: string;
    rtpCapabilities: Record<string, unknown>;
    transportId: string;
  }) {
    const router = await this.getRouter(input.channelId);
    const producer = this.producers.get(input.producerId)?.producer;
    if (!producer) {
      throw new Error('Producer not found.');
    }
    if (!router.canConsume({
      producerId: input.producerId,
      rtpCapabilities: input.rtpCapabilities as types.RtpCapabilities,
    })) {
      throw new Error('Consumer RTP capabilities cannot consume this producer.');
    }

    const session = this.requireSession(input.sessionId);
    const transport = this.requireTransport(input.sessionId, input.transportId);
    if (transport.direction !== 'recv') {
      throw new Error('Cannot consume on a send transport.');
    }

    const consumer = await transport.transport.consume({
      paused: true,
      producerId: input.producerId,
      rtpCapabilities: input.rtpCapabilities as types.RtpCapabilities,
    });
    session.consumers.set(consumer.id, consumer);
    consumer.on('transportclose', () => {
      session.consumers.delete(consumer.id);
    });
    consumer.on('producerclose', () => {
      session.consumers.delete(consumer.id);
    });

    return {
      consumerId: consumer.id,
      id: consumer.id,
      kind: consumer.kind,
      producerId: input.producerId,
      producerPaused: consumer.producerPaused,
      rtpParameters: toRecord(consumer.rtpParameters),
      type: consumer.type,
    };
  }

  async resumeSfuConsumer(input: SfuSessionInput & { consumerId: string }): Promise<void> {
    const consumer = this.requireSession(input.sessionId).consumers.get(input.consumerId);
    if (!consumer) {
      throw new Error('Consumer not found.');
    }
    await consumer.resume();
  }

  async closeSfu(input: SfuSessionInput & {
    consumerId?: string;
    producerId?: string;
    transportId?: string;
  }): Promise<{ closedProducer?: SfuProducer }> {
    const session = this.sessions.get(input.sessionId);
    if (!session) {
      return {};
    }

    if (input.consumerId) {
      const consumer = session.consumers.get(input.consumerId);
      consumer?.close();
      session.consumers.delete(input.consumerId);
      return {};
    }

    if (input.producerId) {
      const record = this.producers.get(input.producerId);
      record?.producer.close();
      session.producers.delete(input.producerId);
      this.producers.delete(input.producerId);
      return record ? { closedProducer: record.summary } : {};
    }

    if (input.transportId) {
      const transport = session.transports.get(input.transportId);
      transport?.transport.close();
      session.transports.delete(input.transportId);
      return {};
    }

    for (const consumer of session.consumers.values()) {
      consumer.close();
    }
    for (const producer of session.producers.values()) {
      this.producers.delete(producer.id);
      producer.close();
    }
    for (const transport of session.transports.values()) {
      transport.transport.close();
    }
    this.sessions.delete(input.sessionId);
    return {};
  }

  private assertSfuConfigured() {
    if (!this.isSfuConfigured()) {
      throw new Error('SFU_ANNOUNCED_IP is required before SFU transports can be created.');
    }
  }

  private createListenInfos(): types.TransportListenInfo[] {
    const portRange = {
      max: this.env.SFU_RTC_MAX_PORT,
      min: this.env.SFU_RTC_MIN_PORT,
    };
    const announcedAddress = this.env.SFU_ANNOUNCED_IP;
    const listenInfos: types.TransportListenInfo[] = [
      {
        announcedAddress,
        ip: '0.0.0.0',
        portRange,
        protocol: 'udp',
      },
    ];

    if (this.env.SFU_ENABLE_TCP) {
      listenInfos.push({
        announcedAddress,
        ip: '0.0.0.0',
        portRange,
        protocol: 'tcp',
      });
    }

    return listenInfos;
  }

  private async getRouter(channelId: string): Promise<types.Router> {
    const existing = this.routers.get(channelId);
    if (existing) {
      return existing;
    }

    const worker = await this.getWorker();
    const router = await worker.createRouter({ mediaCodecs: mediaCodecs as types.RtpCodecCapability[] });
    this.routers.set(channelId, router);
    return router;
  }

  private async getWorker(): Promise<types.Worker> {
    if (this.worker) {
      return this.worker;
    }
    if (!this.workerPromise) {
      this.workerPromise = createWorker({
        logLevel: 'warn',
        rtcMaxPort: this.env.SFU_RTC_MAX_PORT,
        rtcMinPort: this.env.SFU_RTC_MIN_PORT,
      }).then((worker) => {
        this.worker = worker;
        worker.on('died', () => {
          this.worker = null;
          this.workerPromise = null;
          this.routers.clear();
          this.sessions.clear();
          this.producers.clear();
        });
        return worker;
      });
    }
    return this.workerPromise;
  }

  private isSfuConfigured() {
    return this.env.SFU_ANNOUNCED_IP.trim().length > 0;
  }

  private listProducers(input: Pick<MediaSessionDescriptor, 'channelId' | 'mode' | 'streamId' | 'userId'>): SfuProducer[] {
    return [...this.producers.values()]
      .map((record) => record.summary)
      .filter((producer) => {
        if (producer.channelId !== input.channelId) {
          return false;
        }
        if (producer.userId === input.userId) {
          return false;
        }
        if (input.mode === 'voice') {
          return producer.source === 'voice';
        }
        if (input.mode === 'music_publish' || input.mode === 'music_listen') {
          return producer.source === 'music' && producer.streamId === input.streamId;
        }
        return producer.source === 'stream' && producer.streamId === input.streamId;
      });
  }

  private requireSession(sessionId: string): SfuSessionRecord {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('SFU session not found.');
    }
    return session;
  }

  private requireTransport(sessionId: string, transportId: string): SfuTransportRecord {
    const transport = this.requireSession(sessionId).transports.get(transportId);
    if (!transport) {
      throw new Error('SFU transport not found.');
    }
    return transport;
  }
}

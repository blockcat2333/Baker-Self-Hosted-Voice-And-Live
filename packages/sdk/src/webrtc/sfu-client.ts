import type {
  ConnectionState,
  Device,
  Producer,
  Transport,
  TransportOptions,
} from 'mediasoup-client/types';
import { Device as MediasoupDevice } from 'mediasoup-client';

import type {
  GatewayCommandName,
  MediaSfuCreateTransportAckData,
  SessionMode,
  SfuProducer,
  SfuSessionInfo,
} from '@baker/protocol';
import {
  MediaSfuConsumeAckDataSchema,
  MediaSfuCreateTransportAckDataSchema,
  MediaSfuProduceAckDataSchema,
} from '@baker/protocol';

import {
  summarizeAggregateVideoSendStats,
  summarizeLocalOutboundAudioNetworkStats,
  type AggregatePeerVideoSendSample,
  type LocalOutboundNetworkSample,
} from './webrtc-manager';

interface SfuSessionDescriptor {
  channelId: string;
  mode: SessionMode;
  sessionId: string;
  streamId?: string;
}

type SendCommandAwaitAck = (command: GatewayCommandName, data: unknown, timeoutMs?: number) => Promise<unknown>;

export type SfuTransportDirection = 'recv' | 'send';

export interface SfuClientSessionCallbacks {
  onTransportConnectionStateChange?(direction: SfuTransportDirection, state: ConnectionState): void;
}

export interface SfuRemoteTrack {
  consumerId: string;
  producer: SfuProducer;
  track: MediaStreamTrack;
}

export class SfuClientSession {
  private device: Device | null = null;
  private recvTransport: Transport | null = null;
  private sendTransport: Transport | null = null;
  private readonly producers = new Map<string, Producer>();
  private readonly consumedProducerIds = new Set<string>();

  constructor(
    private readonly descriptor: SfuSessionDescriptor,
    private readonly sendCommandAwaitAck: SendCommandAwaitAck,
    private readonly callbacks: SfuClientSessionCallbacks = {},
  ) {}

  async load(info: SfuSessionInfo): Promise<void> {
    if (this.device) {
      return;
    }
    const device = new MediasoupDevice();
    await device.load({ routerRtpCapabilities: info.routerRtpCapabilities as Parameters<Device['load']>[0]['routerRtpCapabilities'] });
    this.device = device;
  }

  async produceTracks(tracks: MediaStreamTrack[]): Promise<void> {
    if (tracks.length === 0) {
      return;
    }

    const transport = await this.ensureSendTransport();
    for (const track of tracks) {
      const producer = await transport.produce({ track });
      this.producers.set(producer.id, producer);
    }
  }

  async replaceProducedTrack(kind: MediaStreamTrack['kind'], track: MediaStreamTrack | null): Promise<void> {
    const producers = [...this.producers.values()].filter((producer) => producer.kind === kind);
    for (const producer of producers) {
      await producer.replaceTrack({ track });
    }
  }

  async getVideoSendSample(): Promise<AggregatePeerVideoSendSample | null> {
    const videoProducers = [...this.producers.values()].filter(
      (producer) => producer.kind === 'video' && !producer.closed,
    );
    if (videoProducers.length === 0) {
      return null;
    }

    const reports: RTCStatsReport[] = [];
    for (const producer of videoProducers) {
      try {
        reports.push(await producer.getStats());
      } catch {
        continue;
      }
    }

    return summarizeAggregateVideoSendStats(reports);
  }

  async getLocalOutboundNetworkSample(): Promise<LocalOutboundNetworkSample | null> {
    const audioProducers = [...this.producers.values()].filter(
      (producer) => producer.kind === 'audio' && !producer.closed,
    );
    if (audioProducers.length === 0) {
      return null;
    }

    const reports: RTCStatsReport[] = [];
    for (const producer of audioProducers) {
      try {
        reports.push(await producer.getStats());
      } catch {
        continue;
      }
    }

    return summarizeLocalOutboundAudioNetworkStats(reports);
  }

  async consumeProducer(producer: SfuProducer): Promise<SfuRemoteTrack | null> {
    if (this.consumedProducerIds.has(producer.id)) {
      return null;
    }

    const device = this.requireDevice();
    const transport = await this.ensureRecvTransport();
    const raw = await this.sendCommandAwaitAck('media.sfu.consume', {
      ...this.descriptor,
      producerId: producer.id,
      rtpCapabilities: device.rtpCapabilities,
      transportId: transport.id,
    });
    const data = MediaSfuConsumeAckDataSchema.parse(raw);
    const consumer = await transport.consume({
      id: data.consumerId,
      kind: data.kind,
      producerId: data.producerId,
      rtpParameters: data.rtpParameters as Parameters<Transport['consume']>[0]['rtpParameters'],
    });
    this.consumedProducerIds.add(producer.id);
    await this.sendCommandAwaitAck('media.sfu.resume_consumer', {
      ...this.descriptor,
      consumerId: data.consumerId,
    });
    return {
      consumerId: data.consumerId,
      producer,
      track: consumer.track,
    };
  }

  close(): void {
    for (const producer of this.producers.values()) {
      producer.close();
    }
    this.producers.clear();
    this.consumedProducerIds.clear();
    this.recvTransport?.close();
    this.sendTransport?.close();
    this.recvTransport = null;
    this.sendTransport = null;
  }

  private async ensureSendTransport(): Promise<Transport> {
    if (this.sendTransport) {
      return this.sendTransport;
    }
    this.sendTransport = this.createTransport(
      await this.createTransportOptions('send'),
      'send',
    );
    return this.sendTransport;
  }

  private async ensureRecvTransport(): Promise<Transport> {
    if (this.recvTransport) {
      return this.recvTransport;
    }
    this.recvTransport = this.createTransport(
      await this.createTransportOptions('recv'),
      'recv',
    );
    return this.recvTransport;
  }

  private async createTransportOptions(direction: 'recv' | 'send'): Promise<MediaSfuCreateTransportAckData> {
    const raw = await this.sendCommandAwaitAck('media.sfu.create_transport', {
      ...this.descriptor,
      direction,
    });
    return MediaSfuCreateTransportAckDataSchema.parse(raw);
  }

  private createTransport(data: MediaSfuCreateTransportAckData, direction: 'recv' | 'send'): Transport {
    const device = this.requireDevice();
    const options = data.transportOptions as TransportOptions;
    const transport = direction === 'send'
      ? device.createSendTransport(options)
      : device.createRecvTransport(options);

    transport.on('connectionstatechange', (state) => {
      this.callbacks.onTransportConnectionStateChange?.(direction, state);
    });

    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      this.sendCommandAwaitAck('media.sfu.connect_transport', {
        ...this.descriptor,
        dtlsParameters,
        transportId: transport.id,
      }).then(() => callback()).catch((err) => errback(err instanceof Error ? err : new Error(String(err))));
    });

    if (direction === 'send') {
      transport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
        this.sendCommandAwaitAck('media.sfu.produce', {
          ...this.descriptor,
          appData,
          kind,
          rtpParameters,
          transportId: transport.id,
        }).then((raw) => {
          const result = MediaSfuProduceAckDataSchema.parse(raw);
          callback({ id: result.producerId });
        }).catch((err) => errback(err instanceof Error ? err : new Error(String(err))));
      });
    }

    return transport;
  }

  private requireDevice(): Device {
    if (!this.device) {
      throw new Error('SFU device is not loaded.');
    }
    return this.device;
  }
}

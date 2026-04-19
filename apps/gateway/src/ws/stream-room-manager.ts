import { createEventEnvelope } from '@baker/protocol';
import type { StreamPublication, StreamSourceType, StreamViewer } from '@baker/protocol';

import { createLogger } from '@baker/shared';

import type { ConnectionManager } from './connection-manager';

const log = createLogger('gateway:stream');

export interface StreamHostRecord {
  connectionId: string;
  sessionId: string;
  sourceType: StreamSourceType;
  userId: string;
}

export interface StreamViewerRecord {
  connectionId: string;
  sessionId: string;
  userId: string;
}

export interface StreamPublicationRecord {
  channelId: string;
  host: StreamHostRecord;
  streamId: string;
  viewers: Map<string, StreamViewerRecord>;
}

export interface StreamSnapshot {
  channelId: string;
  session: {
    hostUserId: string;
    sessionId: string;
    sourceType: StreamSourceType;
    status: 'live';
    streamId: string;
  } | null;
  streams: StreamPublication[];
  viewers: StreamViewer[];
}

export type StreamDisconnectResult =
  | { channelId: string; connectionIds: string[]; sessionId: string; streamId: string; type: 'host_stopped' }
  | { channelId: string; streamId: string; type: 'viewer_left' };

export class StreamRoomManager {
  private readonly rooms = new Map<string, Map<string, StreamPublicationRecord>>();

  constructor(private readonly connections: ConnectionManager) {}

  private getRoom(channelId: string): Map<string, StreamPublicationRecord> | null {
    return this.rooms.get(channelId) ?? null;
  }

  private deleteRoomIfEmpty(channelId: string) {
    if (this.rooms.get(channelId)?.size === 0) {
      this.rooms.delete(channelId);
    }
  }

  private toPublication(publication: StreamPublicationRecord): StreamPublication {
    return {
      channelId: publication.channelId,
      hostUserId: publication.host.userId,
      sessionId: publication.host.sessionId,
      sourceType: publication.host.sourceType,
      status: 'live',
      streamId: publication.streamId,
      viewers: [...publication.viewers.values()].map((viewer) => ({
        sessionId: viewer.sessionId,
        userId: viewer.userId,
      })),
    };
  }

  createSnapshot(channelId: string): StreamSnapshot {
    const room = this.getRoom(channelId);
    const streams = room ? [...room.values()].map((publication) => this.toPublication(publication)) : [];
    const compatibilityPublication = streams.length === 1 ? streams[0] : null;

    return {
      channelId,
      session: compatibilityPublication
        ? {
            hostUserId: compatibilityPublication.hostUserId,
            sessionId: compatibilityPublication.sessionId,
            sourceType: compatibilityPublication.sourceType,
            status: 'live',
            streamId: compatibilityPublication.streamId,
          }
        : null,
      streams,
      viewers: compatibilityPublication?.viewers ?? [],
    };
  }

  private getAudienceConnectionIds(publication: StreamPublicationRecord): string[] {
    return [
      publication.host.connectionId,
      ...[...publication.viewers.values()].map((viewer) => viewer.connectionId),
    ];
  }

  private getBroadcastConnectionIds(channelId: string, extraConnectionIds: string[] = []): string[] {
    const connectionIds = new Set(extraConnectionIds);
    const room = this.getRoom(channelId);

    if (room) {
      for (const publication of room.values()) {
        for (const connectionId of this.getAudienceConnectionIds(publication)) {
          connectionIds.add(connectionId);
        }
      }
    }

    return [...connectionIds];
  }

  private leaveRoomForUser(
    channelId: string,
    room: Map<string, StreamPublicationRecord>,
    userId: string,
  ): StreamDisconnectResult[] {
    const results: StreamDisconnectResult[] = [];

    for (const [streamId, publication] of room) {
      if (publication.host.userId === userId) {
        room.delete(streamId);
        results.push({
          channelId,
          connectionIds: this.getAudienceConnectionIds(publication),
          sessionId: publication.host.sessionId,
          streamId,
          type: 'host_stopped',
        });
        continue;
      }

      if (publication.viewers.delete(userId)) {
        results.push({ channelId, streamId, type: 'viewer_left' });
      }
    }

    this.deleteRoomIfEmpty(channelId);
    return results;
  }

  start(
    channelId: string,
    streamId: string,
    userId: string,
    connectionId: string,
    sessionId: string,
    sourceType: StreamSourceType,
  ): StreamPublicationRecord | null {
    let room = this.rooms.get(channelId);
    if (!room) {
      room = new Map();
      this.rooms.set(channelId, room);
    }

    for (const publication of room.values()) {
      if (publication.host.userId === userId) {
        return null;
      }
    }

    const publication: StreamPublicationRecord = {
      channelId,
      host: { connectionId, sessionId, sourceType, userId },
      streamId,
      viewers: new Map(),
    };
    room.set(streamId, publication);

    log.info({ channelId, connectionId, sourceType, streamId, userId }, 'User started stream');
    return publication;
  }

  stop(channelId: string, streamId: string, userId: string): { connectionIds: string[]; sessionId: string; streamId: string } | null {
    const room = this.getRoom(channelId);
    if (!room) {
      return null;
    }

    const publication = room.get(streamId);
    if (!publication || publication.host.userId !== userId) {
      return null;
    }

    room.delete(streamId);
    this.deleteRoomIfEmpty(channelId);
    log.info({ channelId, streamId, userId }, 'User stopped stream');

    return {
      connectionIds: this.getAudienceConnectionIds(publication),
      sessionId: publication.host.sessionId,
      streamId,
    };
  }

  addViewer(
    channelId: string,
    streamId: string,
    userId: string,
    connectionId: string,
    sessionId: string,
  ): { existing: boolean; publication: StreamPublicationRecord; viewerSessionId: string } | null {
    const publication = this.getPublication(channelId, streamId);
    if (!publication) {
      return null;
    }

    const existing = publication.viewers.get(userId);
    if (existing) {
      return {
        existing: true,
        publication,
        viewerSessionId: existing.sessionId,
      };
    }

    publication.viewers.set(userId, { connectionId, sessionId, userId });
    log.info({ channelId, connectionId, streamId, userId }, 'User started watching stream');

    return {
      existing: false,
      publication,
      viewerSessionId: sessionId,
    };
  }

  removeViewer(channelId: string, streamId: string, userId: string): boolean {
    const publication = this.getPublication(channelId, streamId);
    if (!publication) {
      return false;
    }

    const removed = publication.viewers.delete(userId);
    if (removed) {
      log.info({ channelId, streamId, userId }, 'User stopped watching stream');
    }
    return removed;
  }

  findHostedPublicationByUser(userId: string, channelId?: string): StreamPublicationRecord | null {
    if (channelId) {
      const room = this.getRoom(channelId);
      if (!room) {
        return null;
      }

      for (const publication of room.values()) {
        if (publication.host.userId === userId) {
          return publication;
        }
      }

      return null;
    }

    for (const room of this.rooms.values()) {
      for (const publication of room.values()) {
        if (publication.host.userId === userId) {
          return publication;
        }
      }
    }

    return null;
  }

  findWatchedPublicationsByUser(userId: string, channelId?: string): StreamPublicationRecord[] {
    const matches: StreamPublicationRecord[] = [];
    const rooms = channelId ? [this.getRoom(channelId)] : [...this.rooms.values()];

    for (const room of rooms) {
      if (!room) {
        continue;
      }

      for (const publication of room.values()) {
        if (publication.viewers.has(userId)) {
          matches.push(publication);
        }
      }
    }

    return matches;
  }

  getPublication(channelId: string, streamId: string): StreamPublicationRecord | null {
    return this.getRoom(channelId)?.get(streamId) ?? null;
  }

  getPublications(channelId: string): StreamPublicationRecord[] {
    return [...(this.getRoom(channelId)?.values() ?? [])];
  }

  getViewer(channelId: string, streamId: string, userId: string): StreamViewerRecord | null {
    return this.getPublication(channelId, streamId)?.viewers.get(userId) ?? null;
  }

  resolvePublication(channelId: string, streamId?: string): StreamPublicationRecord | null {
    if (streamId) {
      return this.getPublication(channelId, streamId);
    }

    const publications = this.getPublications(channelId);
    if (publications.length !== 1) {
      return null;
    }

    return publications[0] ?? null;
  }

  canRelaySignal(
    channelId: string,
    streamId: string | undefined,
    mode: 'stream_publish' | 'stream_watch',
    senderUserId: string,
    senderSessionId: string,
    targetUserId: string,
  ): boolean {
    const publication = this.resolvePublication(channelId, streamId);
    if (!publication) {
      return false;
    }

    if (mode === 'stream_publish') {
      return (
        publication.host.userId === senderUserId &&
        publication.host.sessionId === senderSessionId &&
        publication.viewers.has(targetUserId)
      );
    }

    const viewer = publication.viewers.get(senderUserId);
    return viewer?.sessionId === senderSessionId && publication.host.userId === targetUserId;
  }

  broadcastStateUpdated(channelId: string, extraConnectionIds: string[] = []): void {
    const connectionIds = this.getBroadcastConnectionIds(channelId, extraConnectionIds);
    if (connectionIds.length === 0) {
      return;
    }

    const data = this.createSnapshot(channelId);

    for (const connectionId of connectionIds) {
      const conn = this.connections.getById(connectionId);
      if (!conn) {
        continue;
      }

      try {
        const envelope = createEventEnvelope(conn.nextSequence(), 'stream.state.updated', data);
        conn.socket.send(JSON.stringify(envelope));
      } catch (err) {
        log.warn({ channelId, connectionId, err }, 'Failed to send stream.state.updated');
      }
    }
  }

  broadcastStateCleared(channelId: string, connectionIds: string[]): void {
    const data = this.createSnapshot(channelId);

    for (const connectionId of this.getBroadcastConnectionIds(channelId, connectionIds)) {
      const conn = this.connections.getById(connectionId);
      if (!conn) {
        continue;
      }

      try {
        const envelope = createEventEnvelope(conn.nextSequence(), 'stream.state.updated', data);
        conn.socket.send(JSON.stringify(envelope));
      } catch (err) {
        log.warn({ channelId, connectionId, err }, 'Failed to send cleared stream.state.updated');
      }
    }
  }

  leaveChannelForUser(channelId: string, userId: string): StreamDisconnectResult[] {
    const room = this.getRoom(channelId);
    if (!room) {
      return [];
    }

    return this.leaveRoomForUser(channelId, room, userId);
  }

  leaveAllForUser(userId: string): StreamDisconnectResult[] {
    const results: StreamDisconnectResult[] = [];

    for (const [channelId, room] of this.rooms) {
      results.push(...this.leaveRoomForUser(channelId, room, userId));
    }

    return results;
  }
}

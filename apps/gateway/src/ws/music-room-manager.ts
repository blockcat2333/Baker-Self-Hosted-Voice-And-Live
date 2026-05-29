import { createEventEnvelope } from '@baker/protocol';
import type { MusicPublication } from '@baker/protocol';

import { createLogger } from '@baker/shared';

import type { ConnectionManager } from './connection-manager';

const log = createLogger('gateway:music');

export interface MusicHostRecord {
  connectionId: string;
  sessionId: string;
  userId: string;
}

export interface MusicListenerRecord {
  connectionId: string;
  sessionId: string;
  userId: string;
}

export interface MusicPublicationRecord {
  channelId: string;
  host: MusicHostRecord;
  listeners: Map<string, MusicListenerRecord>;
  musicId: string;
}

export type MusicDisconnectResult =
  | { channelId: string; connectionIds: string[]; musicId: string; sessionId: string; type: 'host_stopped' }
  | { channelId: string; musicId: string; sessionId: string; type: 'listener_left' };

export class MusicRoomManager {
  private readonly rooms = new Map<string, Map<string, MusicPublicationRecord>>();

  constructor(private readonly connections: ConnectionManager) {}

  private getRoom(channelId: string): Map<string, MusicPublicationRecord> | null {
    return this.rooms.get(channelId) ?? null;
  }

  private deleteRoomIfEmpty(channelId: string) {
    if (this.rooms.get(channelId)?.size === 0) {
      this.rooms.delete(channelId);
    }
  }

  private toPublication(publication: MusicPublicationRecord): MusicPublication {
    return {
      channelId: publication.channelId,
      hostUserId: publication.host.userId,
      listeners: [...publication.listeners.values()].map((listener) => ({
        sessionId: listener.sessionId,
        userId: listener.userId,
      })),
      musicId: publication.musicId,
      sessionId: publication.host.sessionId,
      status: 'live',
    };
  }

  createSnapshot(channelId: string): { channelId: string; publications: MusicPublication[] } {
    const room = this.getRoom(channelId);
    return {
      channelId,
      publications: room ? [...room.values()].map((publication) => this.toPublication(publication)) : [],
    };
  }

  private getPublicationAudienceConnectionIds(publication: MusicPublicationRecord): string[] {
    return [
      publication.host.connectionId,
      ...[...publication.listeners.values()].map((listener) => listener.connectionId),
    ];
  }

  getAudienceConnectionIds(channelId: string, musicId?: string): string[] {
    const publications = musicId
      ? [this.getPublication(channelId, musicId)].filter((value): value is MusicPublicationRecord => value !== null)
      : this.getPublications(channelId);
    return [...new Set(publications.flatMap((publication) => this.getPublicationAudienceConnectionIds(publication)))];
  }

  private getBroadcastConnectionIds(channelId: string, extraConnectionIds: string[] = []): string[] {
    const connectionIds = new Set(extraConnectionIds);
    const room = this.getRoom(channelId);

    if (room) {
      for (const publication of room.values()) {
        for (const connectionId of this.getPublicationAudienceConnectionIds(publication)) {
          connectionIds.add(connectionId);
        }
      }
    }

    return [...connectionIds];
  }

  start(
    channelId: string,
    musicId: string,
    userId: string,
    connectionId: string,
    sessionId: string,
  ): MusicPublicationRecord | null {
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

    const publication: MusicPublicationRecord = {
      channelId,
      host: { connectionId, sessionId, userId },
      listeners: new Map(),
      musicId,
    };
    room.set(musicId, publication);

    log.info({ channelId, connectionId, musicId, userId }, 'User started music share');
    return publication;
  }

  stop(channelId: string, musicId: string, userId: string): { connectionIds: string[]; musicId: string; sessionId: string } | null {
    const room = this.getRoom(channelId);
    if (!room) {
      return null;
    }

    const publication = room.get(musicId);
    if (!publication || publication.host.userId !== userId) {
      return null;
    }

    room.delete(musicId);
    this.deleteRoomIfEmpty(channelId);
    log.info({ channelId, musicId, userId }, 'User stopped music share');

    return {
      connectionIds: this.getPublicationAudienceConnectionIds(publication),
      musicId,
      sessionId: publication.host.sessionId,
    };
  }

  addListener(
    channelId: string,
    musicId: string,
    userId: string,
    connectionId: string,
    sessionId: string,
  ): { existing: boolean; listenerSessionId: string; publication: MusicPublicationRecord } | null {
    const publication = this.getPublication(channelId, musicId);
    if (!publication) {
      return null;
    }

    const existing = publication.listeners.get(userId);
    if (existing) {
      return {
        existing: true,
        listenerSessionId: existing.sessionId,
        publication,
      };
    }

    publication.listeners.set(userId, { connectionId, sessionId, userId });
    log.info({ channelId, connectionId, musicId, userId }, 'User started listening to music share');

    return {
      existing: false,
      listenerSessionId: sessionId,
      publication,
    };
  }

  removeListener(channelId: string, musicId: string, userId: string): boolean {
    const publication = this.getPublication(channelId, musicId);
    if (!publication) {
      return false;
    }

    const removed = publication.listeners.delete(userId);
    if (removed) {
      log.info({ channelId, musicId, userId }, 'User stopped listening to music share');
    }
    return removed;
  }

  findHostedPublicationByUser(userId: string, channelId?: string): MusicPublicationRecord | null {
    const rooms = channelId ? [this.getRoom(channelId)] : [...this.rooms.values()];

    for (const room of rooms) {
      if (!room) continue;
      for (const publication of room.values()) {
        if (publication.host.userId === userId) {
          return publication;
        }
      }
    }

    return null;
  }

  findListenedPublicationsByUser(userId: string, channelId?: string): MusicPublicationRecord[] {
    const matches: MusicPublicationRecord[] = [];
    const rooms = channelId ? [this.getRoom(channelId)] : [...this.rooms.values()];

    for (const room of rooms) {
      if (!room) continue;
      for (const publication of room.values()) {
        if (publication.listeners.has(userId)) {
          matches.push(publication);
        }
      }
    }

    return matches;
  }

  getPublication(channelId: string, musicId: string): MusicPublicationRecord | null {
    return this.getRoom(channelId)?.get(musicId) ?? null;
  }

  getPublications(channelId: string): MusicPublicationRecord[] {
    return [...(this.getRoom(channelId)?.values() ?? [])];
  }

  getListener(channelId: string, musicId: string, userId: string): MusicListenerRecord | null {
    return this.getPublication(channelId, musicId)?.listeners.get(userId) ?? null;
  }

  canRelaySignal(
    channelId: string,
    musicId: string | undefined,
    mode: 'music_listen' | 'music_publish',
    senderUserId: string,
    senderSessionId: string,
    targetUserId: string,
  ): boolean {
    if (!musicId) {
      return false;
    }

    const publication = this.getPublication(channelId, musicId);
    if (!publication) {
      return false;
    }

    if (mode === 'music_publish') {
      return (
        publication.host.userId === senderUserId &&
        publication.host.sessionId === senderSessionId &&
        publication.listeners.has(targetUserId)
      );
    }

    const listener = publication.listeners.get(senderUserId);
    return listener?.sessionId === senderSessionId && publication.host.userId === targetUserId;
  }

  broadcastStateUpdated(channelId: string, extraConnectionIds: string[] = []): void {
    const connectionIds = this.getBroadcastConnectionIds(channelId, extraConnectionIds);
    if (connectionIds.length === 0) {
      return;
    }

    const data = this.createSnapshot(channelId);
    for (const connectionId of connectionIds) {
      const conn = this.connections.getById(connectionId);
      if (!conn) continue;
      try {
        const envelope = createEventEnvelope(conn.nextSequence(), 'music.state.updated', data);
        conn.socket.send(JSON.stringify(envelope));
      } catch (err) {
        log.warn({ channelId, connectionId, err }, 'Failed to send music.state.updated');
      }
    }
  }

  private leaveRoomForUser(
    channelId: string,
    room: Map<string, MusicPublicationRecord>,
    userId: string,
  ): MusicDisconnectResult[] {
    const results: MusicDisconnectResult[] = [];

    for (const [musicId, publication] of room) {
      if (publication.host.userId === userId) {
        room.delete(musicId);
        results.push({
          channelId,
          connectionIds: this.getPublicationAudienceConnectionIds(publication),
          musicId,
          sessionId: publication.host.sessionId,
          type: 'host_stopped',
        });
        continue;
      }

      const listener = publication.listeners.get(userId);
      if (listener) {
        publication.listeners.delete(userId);
        results.push({
          channelId,
          musicId,
          sessionId: listener.sessionId,
          type: 'listener_left',
        });
      }
    }

    this.deleteRoomIfEmpty(channelId);
    return results;
  }

  leaveChannelForUser(channelId: string, userId: string): MusicDisconnectResult[] {
    const room = this.getRoom(channelId);
    if (!room) {
      return [];
    }

    return this.leaveRoomForUser(channelId, room, userId);
  }

  leaveAllForUser(userId: string): MusicDisconnectResult[] {
    const results: MusicDisconnectResult[] = [];

    for (const [channelId, room] of this.rooms) {
      results.push(...this.leaveRoomForUser(channelId, room, userId));
    }

    return results;
  }

  clearAll(): MusicDisconnectResult[] {
    const results: MusicDisconnectResult[] = [];

    for (const [channelId, room] of this.rooms) {
      for (const [musicId, publication] of room) {
        results.push({
          channelId,
          connectionIds: this.getPublicationAudienceConnectionIds(publication),
          musicId,
          sessionId: publication.host.sessionId,
          type: 'host_stopped',
        });
      }
    }

    this.rooms.clear();
    return results;
  }
}

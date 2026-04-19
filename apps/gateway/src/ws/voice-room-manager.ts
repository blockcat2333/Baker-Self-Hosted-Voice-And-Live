/**
 * VoiceRoomManager tracks in-memory voice room state per channel.
 *
 * One userId may occupy at most one slot per voice channel. The slot is
 * identified by the specific connectionId that sent voice.join — this is
 * the "owning connection" for signal relay purposes.
 *
 * This registry is in-memory only; multi-instance deployments are deferred.
 */

import { createEventEnvelope } from '@baker/protocol';

import { createLogger } from '@baker/shared';

import type { ConnectionManager } from './connection-manager';

const log = createLogger('gateway:voice');

export interface VoiceParticipantRecord {
  connectionId: string;
  isMuted: boolean;
  sessionId: string;
  userId: string;
}

export class VoiceRoomManager {
  /**
   * Map<channelId, Map<userId, VoiceParticipantRecord>>
   */
  private readonly rooms = new Map<string, Map<string, VoiceParticipantRecord>>();

  constructor(private readonly connections: ConnectionManager) {}

  /**
   * Add a participant to a voice channel room.
   * Returns the full participant snapshot after joining (including the new participant).
   * Returns null and does NOT join if the userId is already in this room.
   */
  join(
    channelId: string,
    userId: string,
    connectionId: string,
    sessionId: string,
  ): VoiceParticipantRecord[] | null {
    let room = this.rooms.get(channelId);
    if (!room) {
      room = new Map();
      this.rooms.set(channelId, room);
    }

    if (room.has(userId)) {
      return null; // VOICE_ALREADY_JOINED
    }

    const record: VoiceParticipantRecord = { connectionId, isMuted: false, sessionId, userId };
    room.set(userId, record);

    log.info({ channelId, connectionId, userId }, 'User joined voice room');

    return [...room.values()];
  }

  /**
   * Remove a participant from a voice channel room.
   * Returns the remaining participant snapshot, or null if the room didn't exist.
   */
  leave(channelId: string, userId: string): VoiceParticipantRecord[] | null {
    const room = this.rooms.get(channelId);
    if (!room) return null;

    room.delete(userId);

    if (room.size === 0) {
      this.rooms.delete(channelId);
    }

    log.info({ channelId, userId }, 'User left voice room');

    return room.size > 0 ? [...room.values()] : [];
  }

  /**
   * Update mute state for a participant.
   * Returns the updated record, or null if the participant is not in the room.
   */
  setMuted(channelId: string, userId: string, isMuted: boolean): VoiceParticipantRecord | null {
    const record = this.rooms.get(channelId)?.get(userId);
    if (!record) return null;
    record.isMuted = isMuted;
    return record;
  }

  /**
   * Get current participants in a channel. Returns [] if room does not exist.
   */
  getParticipants(channelId: string): VoiceParticipantRecord[] {
    const room = this.rooms.get(channelId);
    return room ? [...room.values()] : [];
  }

  getParticipant(channelId: string, userId: string): VoiceParticipantRecord | null {
    return this.rooms.get(channelId)?.get(userId) ?? null;
  }

  /**
   * Get the voice channel a user is currently in, or null.
   */
  getChannelForUser(userId: string): string | null {
    for (const [channelId, room] of this.rooms) {
      if (room.has(userId)) return channelId;
    }
    return null;
  }

  /**
   * Remove a user from all voice rooms they are in (used on disconnect).
   * Returns affected rooms: [{ channelId, remaining }]
   */
  leaveAllChannels(userId: string): Array<{ channelId: string; remaining: VoiceParticipantRecord[] }> {
    const affected: Array<{ channelId: string; remaining: VoiceParticipantRecord[] }> = [];
    for (const [channelId, room] of this.rooms) {
      if (room.has(userId)) {
        room.delete(userId);
        if (room.size === 0) this.rooms.delete(channelId);
        affected.push({ channelId, remaining: room.size > 0 ? [...room.values()] : [] });
      }
    }
    if (affected.length > 0) {
      log.info({ userId, channels: affected.map((a) => a.channelId) }, 'User removed from all voice rooms on disconnect');
    }
    return affected;
  }

  /**
   * Broadcast voice.state.updated (full participant snapshot) to all connections
   * currently in the voice room.
   */
  broadcastStateUpdated(channelId: string, participants: VoiceParticipantRecord[]): void {
    const data = {
      channelId,
      participants: participants.map((p) => ({
        isMuted: p.isMuted,
        sessionId: p.sessionId,
        userId: p.userId,
      })),
    };

    for (const participant of participants) {
      const conn = this.connections.getById(participant.connectionId);
      if (!conn) continue;
      try {
        const envelope = createEventEnvelope(conn.nextSequence(), 'voice.state.updated', data);
        conn.socket.send(JSON.stringify(envelope));
      } catch (err) {
        log.warn({ err, connectionId: participant.connectionId, channelId }, 'Failed to send voice.state.updated');
      }
    }
  }

  /**
   * Broadcast voice.member.updated (single participant delta) to all connections
   * currently in the voice room.
   */
  broadcastMemberUpdated(channelId: string, record: VoiceParticipantRecord): void {
    const participants = this.getParticipants(channelId);
    const data = {
      channelId,
      participant: {
        isMuted: record.isMuted,
        sessionId: record.sessionId,
        userId: record.userId,
      },
    };

    for (const p of participants) {
      const conn = this.connections.getById(p.connectionId);
      if (!conn) continue;
      try {
        const envelope = createEventEnvelope(conn.nextSequence(), 'voice.member.updated', data);
        conn.socket.send(JSON.stringify(envelope));
      } catch (err) {
        log.warn({ err, connectionId: p.connectionId, channelId }, 'Failed to send voice.member.updated');
      }
    }
  }

  /**
   * Broadcast voice.roster.updated (full participant snapshot) to a caller-
   * provided set of connection IDs (for example all authenticated guild members).
   */
  broadcastRosterUpdated(
    channelId: string,
    participants: VoiceParticipantRecord[],
    targetConnectionIds: string[],
  ): void {
    const data = {
      channelId,
      participants: participants.map((p) => ({
        isMuted: p.isMuted,
        sessionId: p.sessionId,
        userId: p.userId,
      })),
    };

    for (const connectionId of targetConnectionIds) {
      const conn = this.connections.getById(connectionId);
      if (!conn) continue;
      try {
        const envelope = createEventEnvelope(conn.nextSequence(), 'voice.roster.updated', data);
        conn.socket.send(JSON.stringify(envelope));
      } catch (err) {
        log.warn({ err, connectionId, channelId }, 'Failed to send voice.roster.updated');
      }
    }
  }

  /**
   * Broadcast voice.speaking.updated to all connections in the voice room
   * EXCEPT the sender (they already know their own speaking state).
   */
  broadcastSpeakingUpdated(
    channelId: string,
    userId: string,
    isSpeaking: boolean,
    excludeConnectionId: string,
  ): void {
    const participants = this.getParticipants(channelId);
    const data = { channelId, isSpeaking, userId };

    for (const p of participants) {
      if (p.connectionId === excludeConnectionId) continue;
      const conn = this.connections.getById(p.connectionId);
      if (!conn) continue;
      try {
        const envelope = createEventEnvelope(conn.nextSequence(), 'voice.speaking.updated', data);
        conn.socket.send(JSON.stringify(envelope));
      } catch (err) {
        log.warn({ err, connectionId: p.connectionId, channelId }, 'Failed to send voice.speaking.updated');
      }
    }
  }
}

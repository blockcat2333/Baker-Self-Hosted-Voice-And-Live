import { createEventEnvelope } from '@baker/protocol';

export interface SocketLike {
  close(): void;
  send(payload: string): void;
}

export interface GatewayConnection {
  /** guild IDs the authenticated user could access when this connection authenticated */
  guildIds: Set<string>;
  id: string;
  /** null until system.authenticate succeeds */
  userId: string | null;
  /** null until system.authenticate succeeds */
  sessionId: string | null;
  /** Display name resolved from the users table at auth time. null until authenticated. */
  username: string | null;
  /** text channel IDs this connection has subscribed to */
  subscriptions: Set<string>;
  /** voice channel this connection is currently in, or null */
  voiceChannelId: string | null;
  nextSequence(): number;
  socket: SocketLike;
}

export interface VoiceConnectionNetworkSnapshot {
  gatewayLossPct: number | null;
  gatewayRttMs: number | null;
  mediaSelfLossPct: number | null;
  stale: boolean;
  updatedAt: string;
}

interface ConnectionQualityState {
  gatewayLossPct: number | null;
  gatewayRttMs: number | null;
  gatewaySamples: boolean[];
  gatewayUpdatedAtMs: number | null;
  mediaSelfLossPct: number | null;
  mediaUpdatedAtMs: number | null;
  pendingGatewayPingSentAtMs: number | null;
}

const QUALITY_SAMPLE_WINDOW = 20;

export class ConnectionManager {
  private readonly connections = new Map<string, GatewayConnection>();
  private readonly connectionQuality = new Map<string, ConnectionQualityState>();
  /**
   * O(1) lookup from userId → connectionId.
   * Populated at markAuthenticated; cleared at detach.
   * Only holds the most recently authenticated connection for a given userId.
   * Voice signal relay uses this index.
   */
  private readonly userToConnectionId = new Map<string, string>();

  attach(socket: SocketLike): GatewayConnection {
    const state = {
      id: `conn-${Date.now()}-${this.connections.size + 1}`,
      seq: 0,
      socket,
    };

    const connection: GatewayConnection = {
      guildIds: new Set(),
      id: state.id,
      userId: null,
      sessionId: null,
      username: null,
      subscriptions: new Set(),
      voiceChannelId: null,
      nextSequence: () => {
        state.seq += 1;
        return state.seq;
      },
      socket,
    };

    this.connections.set(connection.id, connection);
    this.connectionQuality.set(connection.id, {
      gatewayLossPct: null,
      gatewayRttMs: null,
      gatewaySamples: [],
      gatewayUpdatedAtMs: null,
      mediaSelfLossPct: null,
      mediaUpdatedAtMs: null,
      pendingGatewayPingSentAtMs: null,
    });
    return connection;
  }

  detach(connectionId: string) {
    const conn = this.connections.get(connectionId);
    if (conn?.userId) {
      // Only remove the index entry if this connection is still the owner.
      if (this.userToConnectionId.get(conn.userId) === connectionId) {
        this.userToConnectionId.delete(conn.userId);
      }
    }
    this.connections.delete(connectionId);
    this.connectionQuality.delete(connectionId);
  }

  private pushGatewaySample(state: ConnectionQualityState, success: boolean, atMs: number) {
    state.gatewaySamples.push(success);
    if (state.gatewaySamples.length > QUALITY_SAMPLE_WINDOW) {
      state.gatewaySamples.splice(0, state.gatewaySamples.length - QUALITY_SAMPLE_WINDOW);
    }
    const losses = state.gatewaySamples.filter((sample) => !sample).length;
    state.gatewayLossPct =
      state.gatewaySamples.length > 0
        ? Math.round((losses / state.gatewaySamples.length) * 100)
        : null;
    state.gatewayUpdatedAtMs = atMs;
  }

  noteGatewayPingSent(connectionId: string, sentAtMs: number): boolean {
    const state = this.connectionQuality.get(connectionId);
    if (!state) return false;
    state.pendingGatewayPingSentAtMs = sentAtMs;
    return true;
  }

  noteGatewayPingTimeout(connectionId: string, timeoutAtMs: number): boolean {
    const state = this.connectionQuality.get(connectionId);
    if (!state) return false;
    if (state.pendingGatewayPingSentAtMs === null) return false;
    state.pendingGatewayPingSentAtMs = null;
    this.pushGatewaySample(state, false, timeoutAtMs);
    return true;
  }

  noteGatewayPong(connectionId: string, pongAtMs: number): boolean {
    const state = this.connectionQuality.get(connectionId);
    if (!state) return false;
    const sentAtMs = state.pendingGatewayPingSentAtMs;
    if (sentAtMs === null) return false;

    state.pendingGatewayPingSentAtMs = null;
    state.gatewayRttMs = Math.max(0, Math.round(pongAtMs - sentAtMs));
    this.pushGatewaySample(state, true, pongAtMs);
    return true;
  }

  updateMediaSelfLoss(connectionId: string, mediaSelfLossPct: number, updatedAtMs: number): boolean {
    const state = this.connectionQuality.get(connectionId);
    if (!state) return false;
    const clamped = Math.max(0, Math.min(100, mediaSelfLossPct));
    state.mediaSelfLossPct = Math.round(clamped);
    state.mediaUpdatedAtMs = updatedAtMs;
    return true;
  }

  getVoiceConnectionNetworkSnapshot(
    connectionId: string,
    nowMs: number,
    staleAfterMs = 15_000,
  ): VoiceConnectionNetworkSnapshot | null {
    const state = this.connectionQuality.get(connectionId);
    if (!state) return null;

    const latestMs = Math.max(
      state.gatewayUpdatedAtMs ?? 0,
      state.mediaUpdatedAtMs ?? 0,
    );
    const updatedAtMs = latestMs > 0 ? latestMs : nowMs;

    return {
      gatewayLossPct: state.gatewayLossPct,
      gatewayRttMs: state.gatewayRttMs,
      mediaSelfLossPct: state.mediaSelfLossPct,
      stale: latestMs > 0 ? nowMs - latestMs > staleAfterMs : true,
      updatedAt: new Date(updatedAtMs).toISOString(),
    };
  }

  markAuthenticated(
    connectionId: string,
    userId: string,
    sessionId: string,
    username: string | null,
    guildIds: string[],
  ): boolean {
    const conn = this.connections.get(connectionId);
    if (!conn) return false;
    conn.guildIds = new Set(guildIds);
    conn.userId = userId;
    conn.sessionId = sessionId;
    conn.username = username;
    this.userToConnectionId.set(userId, connectionId);
    return true;
  }

  /** Look up a connection by its connection ID. */
  getById(connectionId: string): GatewayConnection | undefined {
    return this.connections.get(connectionId);
  }

  /**
   * Look up the active connection for a given userId.
   * Returns undefined if the user has no authenticated connection.
   */
  findByUserId(userId: string): GatewayConnection | undefined {
    const connId = this.userToConnectionId.get(userId);
    return connId ? this.connections.get(connId) : undefined;
  }

  /**
   * Returns all connections that have subscribed to the given channelId.
   */
  getByChannel(channelId: string): GatewayConnection[] {
    const result: GatewayConnection[] = [];
    for (const conn of this.connections.values()) {
      if (conn.subscriptions.has(channelId)) {
        result.push(conn);
      }
    }
    return result;
  }

  /**
   * Returns all currently tracked connections.
   */
  getAll(): GatewayConnection[] {
    return [...this.connections.values()];
  }

  createReadyPayload(connection: GatewayConnection) {
    return createEventEnvelope(connection.nextSequence(), 'system.ready', {
      capabilities: {
        chat: true,
        presence: true,
        stream: true,
        voice: true,
      },
      connectionId: connection.id,
      serverTime: new Date().toISOString(),
    });
  }

  size() {
    return this.connections.size;
  }
}

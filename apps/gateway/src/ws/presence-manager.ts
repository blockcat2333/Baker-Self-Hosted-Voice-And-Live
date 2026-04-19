/**
 * PresenceManager tracks per-user connection counts in Redis and broadcasts
 * presence.updated events to all current connections.
 *
 * Redis key: bakr:presence:connections (Hash)
 *   field = userId, value = integer connection count
 *
 * Username cache:
 *   In-memory Map<userId, username> populated at connect time.
 *   Used to include display names in presence events so clients never need a
 *   separate user lookup for the online list.
 *
 * sendSnapshotTo:
 *   Called after auth succeeds to push the full current roster to the new
 *   connection. Each online user is delivered as a separate presence.updated
 *   event so the client processes them through the same handler as incremental
 *   updates and the map converges to the authoritative state.
 *
 * The current gateway's authenticated connections are treated as the
 * authoritative presence roster. Redis is a mirror used for cross-process
 * fanout, but stale hash entries must never leak old users into fresh clients.
 */

import { createEventEnvelope } from '@baker/protocol';

import { createLogger } from '@baker/shared';

import type { RedisClient } from '../lib/redis';
import type { ConnectionManager } from './connection-manager';
import type { GatewayConnection } from './connection-manager';

const log = createLogger('gateway:presence');

const PRESENCE_HASH_KEY = 'bakr:presence:connections';

export class PresenceManager {
  /** In-memory display-name cache populated at connect time. */
  private readonly usernameCache = new Map<string, string>();

  constructor(
    private readonly connections: ConnectionManager,
    private readonly redisClient: RedisClient | null,
  ) {}

  async onConnect(userId: string, username: string | null): Promise<void> {
    if (username) this.usernameCache.set(userId, username);
    const count = this.getLocalConnectionCount(userId);
    await this.persistCount(userId, count);
    this.broadcast(userId, count);
  }

  async onDisconnect(userId: string): Promise<void> {
    const count = this.getLocalConnectionCount(userId);
    await this.persistCount(userId, count);
    this.broadcast(userId, count);
    if (count <= 0) {
      this.usernameCache.delete(userId);
    }
  }

  /**
   * Send the full current presence roster to a single newly-authenticated
   * connection. Each online user is delivered as a separate presence.updated
   * event so the client processes them through the same handler as incremental
   * updates and the map converges to the authoritative state.
   */
  async sendSnapshotTo(connection: GatewayConnection): Promise<void> {
    const snapshot = this.getLocalSnapshot(connection.id);
    await this.reconcileRedisSnapshot(snapshot);

    for (const [userId, entry] of snapshot.entries()) {
      try {
        const envelope = createEventEnvelope(connection.nextSequence(), 'presence.updated', {
          connectionCount: entry.connectionCount,
          status: 'online',
          userId,
          username: entry.username,
        });
        connection.socket.send(JSON.stringify(envelope));
      } catch (err) {
        log.warn({ err, connectionId: connection.id, userId }, 'Failed to send presence snapshot entry');
      }
    }
  }

  private getLocalConnectionCount(userId: string): number {
    let count = 0;
    for (const connection of this.connections.getAll()) {
      if (connection.userId === userId) {
        count += 1;
      }
    }

    return count;
  }

  private getLocalSnapshot(excludeConnectionId?: string): Map<string, { connectionCount: number; username: string | null }> {
    const snapshot = new Map<string, { connectionCount: number; username: string | null }>();

    for (const connection of this.connections.getAll()) {
      if (!connection.userId || connection.id === excludeConnectionId) {
        continue;
      }

      const existing = snapshot.get(connection.userId);
      snapshot.set(connection.userId, {
        connectionCount: (existing?.connectionCount ?? 0) + 1,
        username: connection.username ?? existing?.username ?? this.usernameCache.get(connection.userId) ?? null,
      });
    }

    return snapshot;
  }

  private async reconcileRedisSnapshot(snapshot: Map<string, { connectionCount: number; username: string | null }>): Promise<void> {
    if (!this.redisClient) {
      return;
    }

    let hash: Record<string, string> | null;
    try {
      hash = await this.redisClient.hgetall(PRESENCE_HASH_KEY);
    } catch (err) {
      log.warn({ err }, '[PRESENCE] Failed to read presence hash for reconciliation');
      return;
    }

    for (const userId of Object.keys(hash ?? {})) {
      if (snapshot.has(userId)) {
        continue;
      }

      try {
        await this.redisClient.hdel(PRESENCE_HASH_KEY, userId);
      } catch (err) {
        log.warn({ err, userId }, '[PRESENCE] Failed to prune stale presence entry');
      }
    }

    for (const [userId, entry] of snapshot.entries()) {
      if (hash?.[userId] === String(entry.connectionCount)) {
        continue;
      }

      try {
        await this.redisClient.hset(PRESENCE_HASH_KEY, userId, String(entry.connectionCount));
      } catch (err) {
        log.warn({ err, userId }, '[PRESENCE] Failed to reconcile presence count');
      }
    }
  }

  private async persistCount(userId: string, count: number): Promise<void> {
    if (!this.redisClient) {
      log.warn({ userId }, '[FANOUT_DISABLED] Presence sync skipped - Redis unavailable');
      return;
    }

    try {
      if (count <= 0) {
        await this.redisClient.hdel(PRESENCE_HASH_KEY, userId);
        return;
      }

      await this.redisClient.hset(PRESENCE_HASH_KEY, userId, String(count));
    } catch (err) {
      log.warn({ err, userId, count }, '[FANOUT_DISABLED] Presence sync failed - Redis error');
    }
  }

  private broadcast(userId: string, connectionCount: number): void {
    const status = connectionCount > 0 ? 'online' : 'offline';
    const username = this.usernameCache.get(userId) ?? null;
    const allConnections = this.connections.getAll();

    for (const conn of allConnections) {
      try {
        const envelope = createEventEnvelope(conn.nextSequence(), 'presence.updated', {
          connectionCount,
          status,
          userId,
          username,
        });
        conn.socket.send(JSON.stringify(envelope));
      } catch (err) {
        log.warn({ err, connectionId: conn.id }, 'Failed to send presence.updated to connection');
      }
    }
  }
}

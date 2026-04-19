/**
 * Redis publisher for the API.
 *
 * Publishes message.created events to the gateway fanout channel after a
 * durable message write succeeds.
 *
 * Redis channel convention:
 *   bakr:channel:{channelId}:messages
 *
 * FANOUT_DISABLED behavior:
 *   If the client is null (Redis unavailable at startup) or if publish fails,
 *   a WARN is logged with enough context to identify which message was lost.
 *   The publish error is never re-thrown — HTTP request success must not depend
 *   on fanout delivery.
 */

import Redis from 'ioredis';

import { createLogger } from '@baker/shared';

import type { MessageCreatedEventData } from '@baker/protocol';

const log = createLogger('api:redis-publisher');

export interface RedisPublisher {
  publishMessageCreated(channelId: string, data: MessageCreatedEventData): Promise<void>;
}

export function createRedisPublisher(client: Redis | null): RedisPublisher {
  return {
    async publishMessageCreated(channelId, data) {
      if (!client) {
        log.warn(
          { channelId, messageId: data.id },
          '[FANOUT_DISABLED] Redis client unavailable — message.created event not published',
        );
        return;
      }

      const channel = `bakr:channel:${channelId}:messages`;
      try {
        await client.publish(channel, JSON.stringify(data));
      } catch (err) {
        log.warn(
          { err, channelId, messageId: data.id, redisChannel: channel },
          '[FANOUT_DISABLED] Failed to publish message.created to Redis — message persisted but gateway push skipped',
        );
      }
    },
  };
}

export function createRedisClient(redisUrl: string): Redis {
  const client = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: null });

  client.on('error', (err: Error) => {
    log.warn({ err }, '[FANOUT_DISABLED] Redis error in API publisher');
  });

  return client;
}

export async function tryConnectRedisPublisher(client: Redis): Promise<Redis | null> {
  try {
    await client.connect();
    log.info('Redis publisher connected — message fanout enabled');
    return client;
  } catch (err) {
    log.warn(
      { err },
      '[FANOUT_DISABLED] Could not connect to Redis — API will persist messages but not publish to gateway. ' +
        'Restart after fixing Redis connectivity.',
    );
    return null;
  }
}

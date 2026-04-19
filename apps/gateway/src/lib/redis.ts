/**
 * Redis client factory for the gateway.
 *
 * Redis is used for:
 *   - presence counters (HINCRBY/HDECRBY on bakr:presence:connections)
 *   - message fanout subscriber (PSUBSCRIBE bakr:channel:*:messages)
 *
 * FANOUT_DISABLED behavior:
 *   If Redis is unreachable at startup, the gateway logs a prominent WARN and
 *   continues in degraded mode. WebSocket connections and auth still work, but
 *   no message push or presence sync will occur. Every place that skips a Redis
 *   operation in this mode logs an additional WARN so degradation is visible in
 *   logs and is never silent.
 */

import Redis from 'ioredis';

import { createLogger } from '@baker/shared';

const log = createLogger('gateway:redis');

export type RedisClient = Redis;

export function createRedisClient(redisUrl: string): Redis {
  const client = new Redis(redisUrl, {
    // Do not auto-reconnect forever in test/dev — fail fast instead.
    lazyConnect: true,
    maxRetriesPerRequest: null,
  });

  client.on('error', (err: Error) => {
    log.warn({ err }, '[FANOUT_DISABLED] Redis error — realtime fanout is degraded');
  });

  return client;
}

/**
 * Attempt to connect to Redis. Returns true if successful, false if not.
 * On failure logs a prominent warning and the caller must treat fanout as disabled.
 */
export async function tryConnectRedis(client: Redis): Promise<boolean> {
  try {
    await client.connect();
    log.info('Redis connected — realtime fanout enabled');
    return true;
  } catch (err) {
    log.warn(
      { err },
      '[FANOUT_DISABLED] Could not connect to Redis at startup. ' +
        'Message push and presence sync are disabled for this gateway instance. ' +
        'Restart the gateway after fixing Redis connectivity.',
    );
    return false;
  }
}

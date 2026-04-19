import { getServiceBinding, parseAppEnv } from '@baker/shared';

import { buildApiApp, createRedisClient, createRedisPublisher, tryConnectRedisPublisher } from './app';

async function main() {
  const env = parseAppEnv();

  // Wire the Redis publisher before building the app so the decorated
  // `publisher` instance is the real one, not the null fallback.
  const redisClient = createRedisClient(env.REDIS_URL);
  const connectedClient = await tryConnectRedisPublisher(redisClient);
  const publisher = createRedisPublisher(connectedClient);

  const app = buildApiApp({ publisher });
  const binding = getServiceBinding(env, 'api');

  await app.listen(binding);
}

void main();

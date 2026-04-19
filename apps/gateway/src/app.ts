import type { IncomingMessage, ServerResponse } from 'node:http';

import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type RawServerDefault } from 'fastify';
import type { RawData } from 'ws';

import { createDatabaseAccess } from '@baker/db';
import { createLogger, parseAppEnv, type Logger } from '@baker/shared';

import { GatewayRuntime } from './app-runtime';
import { createRedisClient, tryConnectRedis } from './lib/redis';
import { createTokenVerifier } from './lib/token-verifier';
import { registerHealthRoute } from './routes/health';
import { routeGatewayMessage } from './ws/event-router';

const log = createLogger('gateway');

type GatewayApp = FastifyInstance<
  RawServerDefault,
  IncomingMessage,
  ServerResponse<IncomingMessage>,
  Logger
>;

export async function buildGatewayApp(): Promise<GatewayApp> {
  const env = parseAppEnv();

  const tokenVerifier = createTokenVerifier(env);

  // Attempt Redis connections. Both pub and sub clients are needed:
  //   - pubClient: reserved for future outbound publish from gateway
  //   - subClient: psubscribes to bakr:channel:*:messages for message fanout
  const pubClient = createRedisClient(env.REDIS_URL);
  const subClient = createRedisClient(env.REDIS_URL);

  const pubConnected = await tryConnectRedis(pubClient);
  const subConnected = await tryConnectRedis(subClient);
  const fanoutEnabled = pubConnected && subConnected;

  const db = createDatabaseAccess(env.DATABASE_URL);

  const runtime = new GatewayRuntime({
    db,
    fanoutEnabled,
    mediaBaseUrl: env.MEDIA_INTERNAL_URL,
    mediaInternalSecret: env.MEDIA_INTERNAL_SECRET,
    pubClient: fanoutEnabled ? pubClient : null,
    subClient: fanoutEnabled ? subClient : null,
    tokenVerifier,
  });

  runtime.startFanout();

  const app = Fastify({ loggerInstance: log });

  void app.register(cors, { origin: true });
  registerHealthRoute(app);

  // The @fastify/websocket plugin's onRoute hook must be registered before
  // the /ws route is added, otherwise the handler receives the Fastify request
  // object instead of the WebSocket (Fastify v5 + @fastify/websocket v11).
  // Wrapping both in the same app.register() callback guarantees the plugin
  // initialises (and adds its hook) before the route is processed.
  void app.register(async function registerWs(fastify) {
    await fastify.register(websocket);

    fastify.get('/ws', { websocket: true }, (socket, _request) => {
      const connection = runtime.connections.attach(socket);

      // Heartbeat + per-connection gateway link-quality sampling.
      // Every 5s we send a ping, convert missed pongs into packet-loss samples,
      // and terminate only after repeated misses to clean stale sessions.
      let consecutiveMisses = 0;
      const HEARTBEAT_INTERVAL_MS = 5_000;
      const MAX_CONSECUTIVE_MISSES = 6;

      const heartbeatTimer = setInterval(() => {
        void (async () => {
          const nowMs = Date.now();
          const timedOut = await runtime.noteGatewayPingTimeout(connection.id, nowMs);
          if (timedOut) {
            consecutiveMisses += 1;
          }

          if (consecutiveMisses >= MAX_CONSECUTIVE_MISSES) {
            clearInterval(heartbeatTimer);
            socket.terminate();
            return;
          }

          runtime.noteGatewayPingSent(connection.id, nowMs);
          socket.ping();
        })();
      }, HEARTBEAT_INTERVAL_MS);

      socket.on('pong', () => {
        consecutiveMisses = 0;
        void runtime.noteGatewayPong(connection.id, Date.now());
      });

      // Send system.ready immediately - client is unauthenticated until
      // system.authenticate succeeds.
      socket.send(JSON.stringify(runtime.connections.createReadyPayload(connection)));

      socket.on('message', (raw: RawData) => {
        void routeGatewayMessage(connection, raw.toString(), runtime).then((reply) => {
          socket.send(JSON.stringify(reply));
        });
      });

      socket.on('close', () => {
        clearInterval(heartbeatTimer);

        const { userId } = connection;
        runtime.connections.detach(connection.id);
        if (userId) {
          void runtime.presence.onDisconnect(userId);

          // Remove the user from all voice rooms and notify remaining participants.
          const affected = runtime.voiceRoom.leaveAllChannels(userId);
          for (const { channelId, remaining } of affected) {
            if (remaining.length > 0) {
              runtime.voiceRoom.broadcastStateUpdated(channelId, remaining);
            }
            void runtime.broadcastVoiceRosterUpdated(channelId);
            void runtime.broadcastVoiceNetworkUpdated(channelId);
          }

          const streamChanges = runtime.streamRoom.leaveAllForUser(userId);
          for (const change of streamChanges) {
            const voiceConnectionIds = runtime.voiceRoom
              .getParticipants(change.channelId)
              .map((participant) => participant.connectionId);
            if (change.type === 'host_stopped') {
              runtime.streamRoom.broadcastStateCleared(change.channelId, [
                ...change.connectionIds,
                ...voiceConnectionIds,
              ]);
              void runtime.db.streamSessions.updateStatus(change.sessionId, 'idle', { endedAt: new Date() });
            } else {
              runtime.streamRoom.broadcastStateUpdated(change.channelId, voiceConnectionIds);
            }
          }
        }
      });
    });
  });

  return app;
}

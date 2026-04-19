import { z } from 'zod';

import type { DatabaseAccess } from '@baker/db';
import {
  ListMessagesQuerySchema,
  MessageCreatedEventDataSchema,
  MessagePageSchema,
  MessageSchema,
  SendMessageRequestSchema,
} from '@baker/protocol';

import { ApiError } from '../lib/api-error';
import type { RedisPublisher } from '../lib/redis-publisher';
import { requireAuth } from '../lib/require-auth';

const ChannelParamsSchema = z.object({
  channelId: z.string().uuid(),
});

function toMessage(
  message: {
    authorUserId: string;
    channelId: string;
    content: string;
    createdAt: Date;
    editedAt: Date | null;
    id: string;
    kind: 'system' | 'text';
  },
  authorUsername: string,
) {
  return MessageSchema.parse({
    authorUserId: message.authorUserId,
    authorUsername,
    channelId: message.channelId,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
    id: message.id,
    kind: message.kind,
  });
}

interface ChannelRoutesRequest {
  auth: {
    sessionId: string | null;
    userId: string | null;
  };
  authError: ApiError | null;
  body: unknown;
  params: unknown;
  query: unknown;
}

interface ChannelRoutesApp {
  dataAccess: DatabaseAccess;
  publisher: RedisPublisher;
  get(path: string, handler: (request: ChannelRoutesRequest) => Promise<unknown>): unknown;
  post(path: string, handler: (request: ChannelRoutesRequest) => Promise<unknown>): unknown;
}

export function registerChannelRoutes(app: ChannelRoutesApp) {
  app.get('/v1/channels/:channelId/messages', async (request) => {
    const auth = requireAuth(request);
    const { channelId } = ChannelParamsSchema.parse(request.params);
    const query = ListMessagesQuerySchema.parse(request.query);

    const channel = await app.dataAccess.channels.findById(channelId);
    if (!channel) {
      throw new ApiError(404, 'NOT_FOUND', 'Channel not found.');
    }

    const accessibleChannel = await app.dataAccess.channels.findAccessibleById(channelId, auth.userId);
    if (!accessibleChannel) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this channel.');
    }

    if (accessibleChannel.type !== 'text') {
      throw new ApiError(400, 'CHANNEL_NOT_TEXT', 'Messages are only available for text channels.');
    }

    const page = await app.dataAccess.messages.listByChannel({
      beforeId: query.before,
      channelId,
      limit: query.limit,
    });

    if (query.before && !page.cursorResolved) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Message cursor does not exist in this channel.', {
        before: query.before,
      });
    }

    return MessagePageSchema.parse({
      items: page.items.map((m) => toMessage(m, m.authorUsername)),
      nextCursor: page.nextCursor,
    });
  });

  app.post('/v1/channels/:channelId/messages', async (request) => {
    const auth = requireAuth(request);
    const { channelId } = ChannelParamsSchema.parse(request.params);
    const input = SendMessageRequestSchema.parse(request.body);

    const channel = await app.dataAccess.channels.findById(channelId);
    if (!channel) {
      throw new ApiError(404, 'NOT_FOUND', 'Channel not found.');
    }

    const accessibleChannel = await app.dataAccess.channels.findAccessibleById(channelId, auth.userId);
    if (!accessibleChannel) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this channel.');
    }

    if (accessibleChannel.type !== 'text') {
      throw new ApiError(400, 'CHANNEL_NOT_TEXT', 'Messages can only be sent to text channels.');
    }

    const author = await app.dataAccess.users.findById(auth.userId);
    const authorUsername = author?.username ?? auth.userId;

    const message = await app.dataAccess.messages.create({
      authorUserId: auth.userId,
      channelId,
      content: input.content.trim(),
      kind: 'text',
      metadata: {},
    });

    const dto = toMessage(message, authorUsername);

    // Publish to gateway fanout after durable write. Fire-and-forget:
    // publish failure must never fail the HTTP response.
    void app.publisher.publishMessageCreated(
      channelId,
      MessageCreatedEventDataSchema.parse({
        authorUserId: message.authorUserId,
        authorUsername,
        channelId: message.channelId,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
        id: message.id,
        kind: message.kind,
      }),
    );

    return dto;
  });
}

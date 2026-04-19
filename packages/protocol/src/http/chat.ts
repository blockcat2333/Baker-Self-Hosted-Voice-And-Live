import { z } from 'zod';

export const MessageKindSchema = z.enum(['system', 'text']);

export const MessageSchema = z.object({
  authorUserId: z.string().uuid(),
  authorUsername: z.string(),
  channelId: z.string().uuid(),
  content: z.string().min(1).max(4000),
  createdAt: z.string().datetime(),
  editedAt: z.string().datetime().nullable(),
  id: z.string().uuid(),
  kind: MessageKindSchema,
});

export const SendMessageRequestSchema = z.object({
  content: z.string().min(1).max(4000),
});

export const ListMessagesQuerySchema = z.object({
  before: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const MessagePageSchema = z.object({
  items: z.array(MessageSchema),
  nextCursor: z.string().uuid().nullable(),
});

export type Message = z.infer<typeof MessageSchema>;
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;
export type ListMessagesQuery = z.infer<typeof ListMessagesQuerySchema>;
export type MessagePage = z.infer<typeof MessagePageSchema>;

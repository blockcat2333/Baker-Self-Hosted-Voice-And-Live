import { create } from 'zustand';

import type { ApiClient } from '@baker/sdk';
import type { ChannelSummary, GuildSummary, Message, MessageCreatedEventData } from '@baker/protocol';

interface ChatState {
  guilds: GuildSummary[];
  /** channels keyed by guildId */
  channelsByGuild: Record<string, ChannelSummary[]>;
  /** messages keyed by channelId, oldest-first display order */
  messagesByChannel: Record<string, Message[]>;
  /** pagination cursor keyed by channelId — null means no more pages */
  cursorByChannel: Record<string, string | null>;
  /** whether older messages exist for a channel */
  hasMoreByChannel: Record<string, boolean>;
  activeGuildId: string | null;
  activeChannelId: string | null;
  isLoadingGuilds: boolean;
  isLoadingChannels: boolean;
  isLoadingMessages: boolean;
  isLoadingOlder: boolean;
  error: string | null;

  loadGuilds(api: ApiClient): Promise<void>;
  loadChannels(api: ApiClient, guildId: string): Promise<void>;
  loadMessages(api: ApiClient, channelId: string): Promise<void>;
  loadOlderMessages(api: ApiClient, channelId: string): Promise<void>;
  sendMessage(api: ApiClient, channelId: string, content: string): Promise<void>;
  appendRealtimeMessage(data: MessageCreatedEventData): void;
  setActiveGuild(guildId: string): void;
  setActiveChannel(channelId: string): void;
  reset(): void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  guilds: [],
  channelsByGuild: {},
  messagesByChannel: {},
  cursorByChannel: {},
  hasMoreByChannel: {},
  activeGuildId: null,
  activeChannelId: null,
  isLoadingGuilds: false,
  isLoadingChannels: false,
  isLoadingMessages: false,
  isLoadingOlder: false,
  error: null,

  async loadGuilds(api) {
    set({ isLoadingGuilds: true, error: null });
    try {
      const guilds = await api.listGuilds();
      set({ guilds, isLoadingGuilds: false });
      const { activeGuildId } = get();
      if (!activeGuildId && guilds.length > 0) {
        set({ activeGuildId: guilds[0]?.id ?? null });
      }
    } catch (err) {
      set({ isLoadingGuilds: false, error: err instanceof Error ? err.message : 'Failed to load guilds.' });
    }
  },

  async loadChannels(api, guildId) {
    set({ isLoadingChannels: true, error: null });
    try {
      const channels = await api.listChannels(guildId);
      set((state) => ({
        channelsByGuild: { ...state.channelsByGuild, [guildId]: channels },
        isLoadingChannels: false,
      }));
      const { activeChannelId } = get();
      if (!activeChannelId) {
        const first = channels.find((c) => c.type === 'text');
        if (first) set({ activeChannelId: first.id });
      }
    } catch (err) {
      set({ isLoadingChannels: false, error: err instanceof Error ? err.message : 'Failed to load channels.' });
    }
  },

  async loadMessages(api, channelId) {
    set({ isLoadingMessages: true, error: null });
    try {
      const page = await api.listMessages(channelId, { limit: 50 });
      // API returns newest-first; reverse for chronological display
      const ordered = [...page.items].reverse();
      set((state) => ({
        messagesByChannel: { ...state.messagesByChannel, [channelId]: ordered },
        cursorByChannel: { ...state.cursorByChannel, [channelId]: page.nextCursor },
        hasMoreByChannel: { ...state.hasMoreByChannel, [channelId]: page.nextCursor !== null },
        isLoadingMessages: false,
      }));
    } catch (err) {
      set({ isLoadingMessages: false, error: err instanceof Error ? err.message : 'Failed to load messages.' });
    }
  },

  async loadOlderMessages(api, channelId) {
    const { cursorByChannel, hasMoreByChannel, isLoadingOlder } = get();
    if (isLoadingOlder) return;
    if (!hasMoreByChannel[channelId]) return;
    const cursor = cursorByChannel[channelId];
    if (!cursor) return;

    set({ isLoadingOlder: true });
    try {
      const page = await api.listMessages(channelId, { before: cursor, limit: 50 });
      // API returns newest-first; reverse for chronological order, then prepend
      const older = [...page.items].reverse();
      set((state) => ({
        messagesByChannel: {
          ...state.messagesByChannel,
          [channelId]: [...older, ...(state.messagesByChannel[channelId] ?? [])],
        },
        cursorByChannel: { ...state.cursorByChannel, [channelId]: page.nextCursor },
        hasMoreByChannel: { ...state.hasMoreByChannel, [channelId]: page.nextCursor !== null },
        isLoadingOlder: false,
      }));
    } catch (err) {
      set({ isLoadingOlder: false, error: err instanceof Error ? err.message : 'Failed to load older messages.' });
    }
  },

  async sendMessage(api, channelId, content) {
    try {
      const message = await api.sendMessage(channelId, content);
      // Append the sender's message immediately from the HTTP response.
      // appendRealtimeMessage deduplicates by id, so the subsequent WS push
      // (when Redis fanout is healthy) will be a no-op for the sender.
      get().appendRealtimeMessage({
        authorUserId: message.authorUserId,
        authorUsername: message.authorUsername,
        channelId: message.channelId,
        content: message.content,
        createdAt: message.createdAt,
        id: message.id,
        kind: message.kind,
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to send message.' });
      throw err;
    }
  },

  appendRealtimeMessage(data) {
    const { channelId } = data;
    set((state) => {
      const existing = state.messagesByChannel[channelId] ?? [];
      // Deduplicate by id in case the sender also receives the WS push
      if (existing.some((m) => m.id === data.id)) return state;
      const message: Message = {
        authorUserId: data.authorUserId,
        authorUsername: data.authorUsername,
        channelId: data.channelId,
        content: data.content,
        createdAt: data.createdAt,
        editedAt: null,
        id: data.id,
        kind: data.kind,
      };
      return {
        messagesByChannel: {
          ...state.messagesByChannel,
          [channelId]: [...existing, message],
        },
      };
    });
  },

  setActiveGuild(guildId) {
    set({ activeGuildId: guildId, activeChannelId: null });
  },

  setActiveChannel(channelId) {
    set({ activeChannelId: channelId });
  },

  reset() {
    set({
      guilds: [],
      channelsByGuild: {},
      messagesByChannel: {},
      cursorByChannel: {},
      hasMoreByChannel: {},
      activeGuildId: null,
      activeChannelId: null,
      isLoadingOlder: false,
      error: null,
    });
  },
}));

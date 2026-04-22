import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '@baker/sdk';
import type { ChannelSummary } from '@baker/protocol';

import { syncGatewayChannelSubscription } from './channel-sync';
import { resolveActiveTextChannelId, useChatStore } from './chat-store';

const guildId = '11111111-1111-4111-8111-111111111111';

function makeChannel(
  id: string,
  type: 'text' | 'voice',
  position: number,
): ChannelSummary {
  return {
    guildId,
    id,
    name: `${type}-${position}`,
    position,
    topic: null,
    type,
    voiceQuality: 'standard',
  };
}

afterEach(() => {
  useChatStore.getState().reset();
  vi.restoreAllMocks();
});

describe('chat channel recovery', () => {
  it('resolves the current text channel when it still exists', () => {
    const channels = [
      makeChannel('text-1', 'text', 0),
      makeChannel('voice-1', 'voice', 1),
    ];

    expect(resolveActiveTextChannelId(channels, 'text-1')).toBe('text-1');
  });

  it('falls back to the first text channel when the active one was deleted and syncs gateway subscriptions', async () => {
    const nextChannels = [
      makeChannel('text-2', 'text', 0),
      makeChannel('voice-1', 'voice', 1),
    ];
    const api = {
      listChannels: vi.fn().mockResolvedValue(nextChannels),
    } as unknown as ApiClient;
    const switchChannel = vi.fn();

    useChatStore.setState({
      activeChannelId: 'text-1',
      activeGuildId: guildId,
      channelsByGuild: {
        [guildId]: [
          makeChannel('text-1', 'text', 0),
          makeChannel('voice-1', 'voice', 1),
        ],
      },
      cursorByChannel: {},
      error: null,
      guilds: [],
      hasMoreByChannel: {},
      isLoadingChannels: false,
      isLoadingGuilds: false,
      isLoadingMessages: false,
      isLoadingOlder: false,
      messagesByChannel: {},
    });

    await useChatStore.getState().loadChannels(api, guildId);

    expect(useChatStore.getState().activeChannelId).toBe('text-2');

    syncGatewayChannelSubscription('text-1', useChatStore.getState().activeChannelId, switchChannel);

    expect(switchChannel).toHaveBeenCalledWith('text-1', 'text-2');
  });
});

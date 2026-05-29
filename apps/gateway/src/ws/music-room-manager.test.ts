import { describe, expect, it, vi } from 'vitest';

import { ConnectionManager } from './connection-manager';
import { MusicRoomManager } from './music-room-manager';

function attachConnection(connections: ConnectionManager) {
  const send = vi.fn();
  const conn = connections.attach({
    close() {},
    send,
  });
  return { conn, send };
}

describe('MusicRoomManager', () => {
  it('allows one publication per user and multiple users per channel', () => {
    const connections = new ConnectionManager();
    const manager = new MusicRoomManager(connections);
    const first = attachConnection(connections).conn;
    const second = attachConnection(connections).conn;

    expect(manager.start('channel-a', 'music-a', 'user-a', first.id, 'session-a')).not.toBeNull();
    expect(manager.start('channel-a', 'music-b', 'user-a', first.id, 'session-b')).toBeNull();
    expect(manager.start('channel-a', 'music-c', 'user-b', second.id, 'session-c')).not.toBeNull();

    const snapshot = manager.createSnapshot('channel-a');
    expect(snapshot.publications).toHaveLength(2);
    expect(snapshot.publications.map((publication) => publication.hostUserId).sort()).toEqual([
      'user-a',
      'user-b',
    ]);
  });

  it('tracks listeners and only permits valid music signaling pairs', () => {
    const connections = new ConnectionManager();
    const manager = new MusicRoomManager(connections);
    const host = attachConnection(connections).conn;
    const listener = attachConnection(connections).conn;

    manager.start('channel-a', 'music-a', 'user-host', host.id, 'host-session');
    const added = manager.addListener('channel-a', 'music-a', 'user-listener', listener.id, 'listener-session');

    expect(added?.existing).toBe(false);
    expect(manager.createSnapshot('channel-a').publications[0]?.listeners).toEqual([
      { sessionId: 'listener-session', userId: 'user-listener' },
    ]);
    expect(
      manager.canRelaySignal(
        'channel-a',
        'music-a',
        'music_publish',
        'user-host',
        'host-session',
        'user-listener',
      ),
    ).toBe(true);
    expect(
      manager.canRelaySignal(
        'channel-a',
        'music-a',
        'music_listen',
        'user-listener',
        'listener-session',
        'user-host',
      ),
    ).toBe(true);
    expect(
      manager.canRelaySignal(
        'channel-a',
        'music-a',
        'music_publish',
        'user-host',
        'wrong-session',
        'user-listener',
      ),
    ).toBe(false);
    expect(
      manager.canRelaySignal(
        'channel-a',
        'music-a',
        'music_listen',
        'user-listener',
        'listener-session',
        'other-user',
      ),
    ).toBe(false);
  });

  it('cleans listener and host sessions when users leave', () => {
    const connections = new ConnectionManager();
    const manager = new MusicRoomManager(connections);
    const host = attachConnection(connections).conn;
    const listener = attachConnection(connections).conn;

    manager.start('channel-a', 'music-a', 'user-host', host.id, 'host-session');
    manager.addListener('channel-a', 'music-a', 'user-listener', listener.id, 'listener-session');

    expect(manager.leaveChannelForUser('channel-a', 'user-listener')).toEqual([
      {
        channelId: 'channel-a',
        musicId: 'music-a',
        sessionId: 'listener-session',
        type: 'listener_left',
      },
    ]);
    expect(manager.createSnapshot('channel-a').publications[0]?.listeners).toEqual([]);

    expect(manager.leaveAllForUser('user-host')).toEqual([
      {
        channelId: 'channel-a',
        connectionIds: [host.id],
        musicId: 'music-a',
        sessionId: 'host-session',
        type: 'host_stopped',
      },
    ]);
    expect(manager.createSnapshot('channel-a').publications).toEqual([]);
  });

  it('broadcasts state snapshots to the host, listeners, and explicit recipients', () => {
    const connections = new ConnectionManager();
    const manager = new MusicRoomManager(connections);
    const { conn: host, send: hostSend } = attachConnection(connections);
    const { conn: listener, send: listenerSend } = attachConnection(connections);
    const { conn: extra, send: extraSend } = attachConnection(connections);

    manager.start('channel-a', 'music-a', 'user-host', host.id, 'host-session');
    manager.addListener('channel-a', 'music-a', 'user-listener', listener.id, 'listener-session');
    manager.broadcastStateUpdated('channel-a', [extra.id]);

    for (const send of [hostSend, listenerSend, extraSend]) {
      expect(send).toHaveBeenCalledOnce();
      const envelope = JSON.parse(send.mock.calls[0]?.[0] as string);
      expect(envelope.event).toBe('music.state.updated');
      expect(envelope.data.publications).toHaveLength(1);
      expect(envelope.data.publications[0]).toMatchObject({
        channelId: 'channel-a',
        hostUserId: 'user-host',
        musicId: 'music-a',
        sessionId: 'host-session',
        status: 'live',
      });
    }
  });
});

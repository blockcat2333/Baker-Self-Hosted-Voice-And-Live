import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '../auth/auth-store';

const {
  clientRefs,
  closeAllStreamPopups,
  handleVoiceGatewayDisconnected,
  handleVoiceGatewayWillReconnect,
  handleStreamGatewayWillReconnect,
} = vi.hoisted(() => ({
  clientRefs: {
    latest: null as { emitEnvelope(envelope: unknown): void; emitError(): void; emitClose(): void } | null,
  },
  closeAllStreamPopups: vi.fn(),
  handleVoiceGatewayDisconnected: vi.fn(),
  handleVoiceGatewayWillReconnect: vi.fn(),
  handleStreamGatewayWillReconnect: vi.fn(),
}));

vi.mock('@baker/sdk', () => ({
  GatewayClient: class MockGatewayClient {
    private envelopeListener: ((envelope: unknown) => void) | null = null;
    private errorListener: (() => void) | null = null;
    private closeListener: (() => void) | null = null;

    constructor(_gatewayUrl: string) {
      clientRefs.latest = this;
    }

    onEnvelope(listener: (envelope: unknown) => void) {
      this.envelopeListener = listener;
      return () => {
        if (this.envelopeListener === listener) {
          this.envelopeListener = null;
        }
      };
    }

    onError(listener: () => void) {
      this.errorListener = listener;
    }

    onClose(listener: () => void) {
      this.closeListener = listener;
    }

    connect() {}

    close() {
      this.closeListener?.();
    }

    sendCommand() {}

    ping() {}

    emitEnvelope(envelope: unknown) {
      this.envelopeListener?.(envelope);
    }

    emitError() {
      this.errorListener?.();
    }

    emitClose() {
      this.closeListener?.();
    }
  },
}));

vi.mock('../stream/stream-popup-controller', () => ({
  closeAllStreamPopups,
}));

vi.mock('../voice/voice-store', () => ({
  useVoiceStore: {
    getState: () => ({
      handleGatewayDisconnected: handleVoiceGatewayDisconnected,
      handleGatewayReconnected: vi.fn(),
      handleGatewayWillReconnect: handleVoiceGatewayWillReconnect,
    }),
  },
}));

vi.mock('../stream/stream-store', () => ({
  useStreamStore: {
    getState: () => ({
      handleGatewayReconnected: vi.fn(),
      handleGatewayWillReconnect: handleStreamGatewayWillReconnect,
      reset: vi.fn(),
    }),
  },
}));

import { useGatewayStore } from './gateway-store';

describe('gateway popup cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-16T12:00:00.000Z'));
    clientRefs.latest = null;
    closeAllStreamPopups.mockReset();
    handleVoiceGatewayDisconnected.mockReset();
    handleVoiceGatewayWillReconnect.mockReset();
    handleStreamGatewayWillReconnect.mockReset();
    useAuthStore.setState({
      accessToken: 'test-access-token',
      error: null,
      isBootstrapping: false,
      isLoading: false,
      refreshToken: 'test-refresh-token',
      user: null,
    });
    useGatewayStore.setState({
      error: null,
      gatewayRttMs: null,
      presenceMap: {},
      reconnectAttempt: 0,
      status: 'disconnected',
      voiceNetworkByChannel: {},
      voiceRosterByChannel: {},
    });
  });

  afterEach(() => {
    useGatewayStore.getState().disconnect();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('closes all stream popups during explicit gateway disconnect', () => {
    useGatewayStore.getState().connect({} as never, 'ws://gateway.example.test/ws');

    useGatewayStore.getState().disconnect();

    expect(closeAllStreamPopups).toHaveBeenCalledOnce();
    expect(useGatewayStore.getState().presenceMap).toEqual({});
    expect(useGatewayStore.getState().status).toBe('disconnected');
  });

  it('does not close stream popups when the gateway connection errors (reconnect path)', () => {
    useGatewayStore.getState().connect({} as never, 'ws://gateway.example.test/ws');
    useGatewayStore.setState({ status: 'ready' });

    clientRefs.latest?.emitError();

    expect(closeAllStreamPopups).not.toHaveBeenCalled();
    expect(useGatewayStore.getState().presenceMap).toEqual({});
    expect(useGatewayStore.getState().status).toBe('reconnecting');
  });

  it('resets voice store during explicit gateway disconnect', () => {
    useGatewayStore.getState().connect({} as never, 'ws://gateway.example.test/ws');

    useGatewayStore.getState().disconnect();

    expect(handleVoiceGatewayDisconnected).toHaveBeenCalledOnce();
  });

  it('prepares voice/stream stores for reconnect when the gateway connection errors', () => {
    useGatewayStore.getState().connect({} as never, 'ws://gateway.example.test/ws');
    useGatewayStore.setState({ status: 'ready' });

    clientRefs.latest?.emitError();

    expect(handleVoiceGatewayWillReconnect).toHaveBeenCalledOnce();
    expect(handleStreamGatewayWillReconnect).toHaveBeenCalledOnce();
  });

  it('prepares voice/stream stores for reconnect when the gateway socket closes', () => {
    useGatewayStore.getState().connect({} as never, 'ws://gateway.example.test/ws');
    useGatewayStore.setState({ status: 'ready' });

    clientRefs.latest?.emitClose();

    expect(handleVoiceGatewayWillReconnect).toHaveBeenCalledOnce();
    expect(handleStreamGatewayWillReconnect).toHaveBeenCalledOnce();
    expect(useGatewayStore.getState().status).toBe('reconnecting');
  });

  it('falls back to reconnect when handshake times out', () => {
    useGatewayStore.getState().connect({} as never, 'ws://gateway.example.test/ws');

    vi.advanceTimersByTime(8_100);

    expect(useGatewayStore.getState().status).toBe('reconnecting');
    expect(handleVoiceGatewayWillReconnect).toHaveBeenCalledOnce();
    expect(handleStreamGatewayWillReconnect).toHaveBeenCalledOnce();
  });

  it('updates gateway RTT from pong and preserves 0ms', () => {
    useGatewayStore.getState().connect({} as never, 'ws://gateway.example.test/ws');
    useGatewayStore.setState({ status: 'authenticating' });

    clientRefs.latest?.emitEnvelope({ data: {}, op: 'ack', reqId: 'req-auth' });
    clientRefs.latest?.emitEnvelope({ op: 'pong' });

    expect(useGatewayStore.getState().gatewayRttMs).toBe(0);
  });

  it('stores voice roster snapshots from gateway events', () => {
    const channelId = '11111111-1111-4111-8111-111111111111';
    useGatewayStore.getState().connect({} as never, 'ws://gateway.example.test/ws');

    clientRefs.latest?.emitEnvelope({
      data: {
        channelId,
        participants: [
          {
            isMuted: false,
            sessionId: '22222222-2222-4222-8222-222222222222',
            userId: '33333333-3333-4333-8333-333333333333',
          },
        ],
      },
      event: 'voice.roster.updated',
      op: 'event',
    });

    expect(useGatewayStore.getState().voiceRosterByChannel[channelId]).toEqual([
      {
        isMuted: false,
        sessionId: '22222222-2222-4222-8222-222222222222',
        userId: '33333333-3333-4333-8333-333333333333',
      },
    ]);
  });

  it('stores per-user voice network snapshots from gateway events', () => {
    const channelId = '11111111-1111-4111-8111-111111111111';
    const userId = '33333333-3333-4333-8333-333333333333';
    useGatewayStore.getState().connect({} as never, 'ws://gateway.example.test/ws');

    clientRefs.latest?.emitEnvelope({
      data: {
        channelId,
        participants: [
          {
            gatewayLossPct: 0,
            gatewayRttMs: 0,
            mediaSelfLossPct: 2,
            stale: false,
            updatedAt: '2026-04-16T12:00:00.000Z',
            userId,
          },
        ],
      },
      event: 'voice.network.updated',
      op: 'event',
    });

    expect(useGatewayStore.getState().voiceNetworkByChannel[channelId]?.[userId]).toEqual({
      gatewayLossPct: 0,
      gatewayRttMs: 0,
      mediaSelfLossPct: 2,
      stale: false,
      updatedAt: '2026-04-16T12:00:00.000Z',
    });
  });
});

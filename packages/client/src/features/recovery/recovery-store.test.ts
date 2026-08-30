import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  abandonAllMediaRecovery,
  resetMediaRecoveryStore,
  resolveMediaRecovery,
  retryMediaRecoveryNow,
  startMediaRecovery,
  useMediaRecoveryStore,
} from './recovery-store';

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('media recovery coordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    resetMediaRecoveryStore();
  });

  afterEach(() => {
    resetMediaRecoveryStore();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('uses exponential backoff, escalates on attempt five, and keeps retrying', async () => {
    const attempt = vi.fn().mockRejectedValue(new Error('offline'));
    startMediaRecovery({ abandon: vi.fn(), attempt, id: 'voice:1', kind: 'voice' });
    await flushMicrotasks();

    expect(useMediaRecoveryStore.getState().incidents['voice:1']).toMatchObject({
      attempt: 1,
      escalated: false,
    });

    for (const delay of [1_000, 2_000, 4_000, 8_000]) {
      await vi.advanceTimersByTimeAsync(delay);
    }
    expect(attempt).toHaveBeenCalledTimes(5);
    expect(useMediaRecoveryStore.getState().incidents['voice:1']).toMatchObject({
      attempt: 5,
      escalated: true,
    });

    await vi.advanceTimersByTimeAsync(16_000);
    expect(attempt).toHaveBeenCalledTimes(6);
    expect(useMediaRecoveryStore.getState().incidents['voice:1']?.attempt).toBe(6);
  });

  it('supports immediate retry, explicit abandon, and successful reset', async () => {
    const abandon = vi.fn();
    const attempt = vi.fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce(undefined);
    startMediaRecovery({ abandon, attempt, id: 'stream:1', kind: 'stream_watch' });
    await flushMicrotasks();

    retryMediaRecoveryNow();
    await flushMicrotasks();
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(useMediaRecoveryStore.getState().incidents).toEqual({});

    startMediaRecovery({
      abandon,
      attempt: vi.fn().mockRejectedValue(new Error('offline')),
      id: 'music:1',
      kind: 'music_listen',
    });
    await flushMicrotasks();
    abandonAllMediaRecovery();
    expect(abandon).toHaveBeenCalledOnce();
    expect(useMediaRecoveryStore.getState().incidents).toEqual({});
  });

  it('ignores a stale async completion after cancellation', async () => {
    let finish!: () => void;
    const attempt = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    startMediaRecovery({ abandon: vi.fn(), attempt, id: 'voice:stale', kind: 'voice' });
    await flushMicrotasks();
    resolveMediaRecovery('voice:stale');
    finish();
    await flushMicrotasks();

    expect(useMediaRecoveryStore.getState().incidents).toEqual({});
  });
});

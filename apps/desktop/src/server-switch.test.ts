import { describe, expect, it, vi } from 'vitest';

import { DesktopServerSwitchCoordinator } from './server-switch';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('desktop server switch coordinator', () => {
  it('preserves the current server when target validation fails', async () => {
    const coordinator = new DesktopServerSwitchCoordinator();
    const commit = vi.fn(async () => undefined);

    await expect(
      coordinator.run('offline', async () => {
        throw new Error('offline');
      }, commit),
    ).rejects.toThrow('offline');
    expect(commit).not.toHaveBeenCalled();
  });

  it('ignores an older validation result after a newer switch starts', async () => {
    const coordinator = new DesktopServerSwitchCoordinator();
    const firstValidation = deferred<string>();
    const secondValidation = deferred<string>();
    const commit = vi.fn(async () => undefined);
    const validate = vi.fn((target: string) =>
      target === 'first' ? firstValidation.promise : secondValidation.promise,
    );

    const first = coordinator.run('first', validate, commit);
    const second = coordinator.run('second', validate, commit);
    secondValidation.resolve('second');
    await expect(second).resolves.toEqual({ status: 'switched', value: 'second' });
    firstValidation.resolve('first');
    await expect(first).resolves.toEqual({ status: 'superseded' });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('second');
  });
});

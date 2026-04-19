import { describe, expect, it } from 'vitest';

import { NoopMediaAdapter } from './noop-media-adapter';

describe('NoopMediaAdapter', () => {
  it('reports adapter capabilities without coupling to a real SFU', () => {
    const adapter = new NoopMediaAdapter();

    expect(adapter.getHealth()).toMatchObject({
      backend: 'noop',
      status: 'ok',
    });
    expect(adapter.getCapabilities().metrics).toBe(true);
  });
});

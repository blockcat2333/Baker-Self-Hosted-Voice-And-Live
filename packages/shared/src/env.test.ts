import { describe, expect, it } from 'vitest';

import { parseAppEnv } from './env';

describe('parseAppEnv', () => {
  it('derives MEDIA_INTERNAL_URL from MEDIA_PORT when unset', () => {
    const env = parseAppEnv({
      MEDIA_PORT: '3103',
    });

    expect(env.MEDIA_INTERNAL_URL).toBe('http://127.0.0.1:3103');
  });

  it('keeps an explicit MEDIA_INTERNAL_URL', () => {
    const env = parseAppEnv({
      MEDIA_PORT: '3103',
      MEDIA_INTERNAL_URL: 'http://127.0.0.1:9999',
    });

    expect(env.MEDIA_INTERNAL_URL).toBe('http://127.0.0.1:9999');
  });

  it('rejects insecure default secrets in production', () => {
    expect(() =>
      parseAppEnv({
        NODE_ENV: 'production',
      }),
    ).toThrow(/insecure default secrets/i);
  });
});

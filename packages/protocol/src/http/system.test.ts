import { describe, expect, it } from 'vitest';

import {
  AdminUpdateProxySettingsRequestSchema,
  normalizeHttpProxyUrl,
} from './system';

describe('update proxy URL normalization', () => {
  it.each([
    ['127.0.0.1:7890', 'http://127.0.0.1:7890'],
    ['proxy.example.com:8080', 'http://proxy.example.com:8080'],
    ['//proxy.example.com:8080', 'http://proxy.example.com:8080'],
    ['https://proxy.example.com:8443', 'https://proxy.example.com:8443'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeHttpProxyUrl(input)).toBe(expected);
    expect(
      AdminUpdateProxySettingsRequestSchema.parse({
        enabled: true,
        proxyUrl: input,
      }).proxyUrl,
    ).toBe(expected);
  });

  it('continues to reject unsupported proxy protocols', () => {
    expect(() =>
      AdminUpdateProxySettingsRequestSchema.parse({
        enabled: true,
        proxyUrl: 'socks5://127.0.0.1:1080',
      }),
    ).toThrow('Proxy URL must be a valid HTTP or HTTPS address.');
  });
});

import { describe, expect, it } from 'vitest';

import { deriveDefaultApiBaseUrl, deriveDefaultGatewayUrl } from './derive-default-urls';

describe('derive-default-urls', () => {
  it('derives stable defaults for file:// origins (desktop production)', () => {
    expect(deriveDefaultApiBaseUrl({ protocol: 'file:', hostname: '' })).toBe('http://localhost:3001');
    expect(deriveDefaultGatewayUrl({ protocol: 'file:', hostname: '' })).toBe('ws://localhost:3002/ws');
  });

  it('derives host-based defaults for http origins (LAN-friendly)', () => {
    expect(deriveDefaultApiBaseUrl({ protocol: 'http:', hostname: '10.0.0.207' })).toBe('http://10.0.0.207:3001');
    expect(deriveDefaultGatewayUrl({ protocol: 'http:', hostname: '10.0.0.207' })).toBe('ws://10.0.0.207/ws');
  });

  it('derives wss gateway for https origins', () => {
    expect(deriveDefaultGatewayUrl({ protocol: 'https:', hostname: 'example.com' })).toBe('wss://example.com/ws');
    expect(deriveDefaultApiBaseUrl({ protocol: 'https:', hostname: 'example.com' })).toBe('https://example.com:3001');
  });

  it('preserves explicit port for http origins', () => {
    expect(deriveDefaultGatewayUrl({ protocol: 'http:', hostname: 'example.com', port: '3233' })).toBe(
      'ws://example.com:3233/ws',
    );
  });
});

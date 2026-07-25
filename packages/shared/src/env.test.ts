import { describe, expect, it } from 'vitest';

import {
  normalizeMediaRegionHost,
  parseAppEnv,
  parseMediaRegionProfiles,
  resolveMediaRegionProfileForHosts,
} from './env';

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

  it('parses media region profiles and resolves them by request host', () => {
    const env = parseAppEnv({
      MEDIA_REGION_PROFILES: JSON.stringify([
        {
          hosts: ['violet.evergarden.space'],
          id: 'mainland',
          sfuAnnouncedIp: '113.80.68.23',
          turnUrls: ['turn:violet.evergarden.space:3478?transport=udp'],
        },
        {
          hosts: ['hkserver.evergarden.space:23303'],
          id: 'hongkong',
          sfuAnnouncedIp: '168.70.50.141',
          sfuRtcMaxPort: 23400,
          sfuRtcMinPort: 23335,
          turnUrls: 'turn:hkserver.evergarden.space:23304?transport=tcp',
        },
      ]),
      SFU_ANNOUNCED_IP: '203.0.113.10',
      TURN_PASSWORD: 'secret',
      TURN_USERNAME: 'baker',
    });

    const profiles = parseMediaRegionProfiles(env);
    expect(profiles).toHaveLength(2);
    expect(profiles[1]).toMatchObject({
      hosts: ['hkserver.evergarden.space'],
      id: 'hongkong',
      sfuAnnouncedIp: '168.70.50.141',
      sfuRtcMaxPort: 23400,
      sfuRtcMinPort: 23335,
      turnUrls: ['turn:hkserver.evergarden.space:23304?transport=tcp'],
    });
    expect(
      resolveMediaRegionProfileForHosts(profiles, [
        'https://hkserver.evergarden.space:23303',
      ])?.id,
    ).toBe('hongkong');
  });

  it('normalizes media region hosts from origins and host headers', () => {
    expect(
      normalizeMediaRegionHost('HTTPS://VIOLET.EVERGARDEN.SPACE:443'),
    ).toBe('violet.evergarden.space');
    expect(normalizeMediaRegionHost('hkserver.evergarden.space:23303')).toBe(
      'hkserver.evergarden.space',
    );
  });

  it('rejects duplicate media region hosts', () => {
    const env = parseAppEnv({
      MEDIA_REGION_PROFILES: JSON.stringify([
        {
          hosts: ['https://hkserver.evergarden.space:23303'],
          id: 'hongkong-a',
        },
        {
          hosts: ['hkserver.evergarden.space'],
          id: 'hongkong-b',
        },
      ]),
    });

    expect(() => parseMediaRegionProfiles(env)).toThrow(
      /duplicate media region profile host/i,
    );
  });

  it('rejects media region profile ports outside the valid TCP/UDP range', () => {
    const env = parseAppEnv({
      MEDIA_REGION_PROFILES: JSON.stringify([
        {
          hosts: ['hkserver.evergarden.space'],
          id: 'hongkong',
          sfuRtcMaxPort: 70000,
          sfuRtcMinPort: 23335,
        },
      ]),
    });

    expect(() => parseMediaRegionProfiles(env)).toThrow();
  });
});

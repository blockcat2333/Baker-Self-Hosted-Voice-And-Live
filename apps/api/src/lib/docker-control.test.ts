import { describe, expect, it } from 'vitest';

import { readContainerHostPort, type DockerInspectResponse } from './docker-control';

describe('Docker control helpers', () => {
  it('reads published host ports from Docker inspect output', () => {
    const inspect: DockerInspectResponse = {
      HostConfig: {
        PortBindings: {
          '80/tcp': [{ HostIp: '127.0.0.1', HostPort: '19080' }],
          '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '19081' }],
        },
      },
    };

    expect(readContainerHostPort(inspect, 80)).toBe(19080);
    expect(readContainerHostPort(inspect, 8080)).toBe(19081);
    expect(readContainerHostPort(inspect, 3478, 'udp')).toBeNull();
  });
});

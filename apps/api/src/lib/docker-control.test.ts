import { describe, expect, it } from 'vitest';

import {
  decodeDockerLogStream,
  readContainerHostPort,
  type DockerInspectResponse,
} from './docker-control';

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

  it('decodes multiplexed and plain Docker log streams', () => {
    const frame = (streamType: 1 | 2, text: string) => {
      const body = Buffer.from(text);
      const header = Buffer.alloc(8);
      header[0] = streamType;
      header.writeUInt32BE(body.length, 4);
      return Buffer.concat([header, body]);
    };
    const multiplexed = Buffer.concat([
      frame(1, 'api ready\n'),
      frame(2, 'gateway warning\n'),
    ]);

    expect(decodeDockerLogStream(multiplexed)).toBe(
      'api ready\ngateway warning\n',
    );
    expect(decodeDockerLogStream(Buffer.from('plain log\n'))).toBe(
      'plain log\n',
    );
  });
});

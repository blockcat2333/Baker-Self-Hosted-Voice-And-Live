import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('all-in-one optional HTTPS configuration', () => {
  const dockerfile = readFileSync(resolve('Dockerfile'), 'utf8');
  const caddyfile = readFileSync(resolve('docker/allinone/Caddyfile'), 'utf8');
  const configureSource = readFileSync(
    resolve('docker/allinone/configure-caddy.sh'),
    'utf8',
  );
  const entrypointSource = readFileSync(
    resolve('docker/allinone/entrypoint.sh'),
    'utf8',
  );

  it('builds Caddy with the pinned AliDNS module', () => {
    expect(dockerfile).toContain(
      'xcaddy build --with github.com/caddy-dns/alidns@v1.0.29',
    );
    expect(dockerfile).toContain('XDG_DATA_HOME=/var/lib/baker/caddy/data');
  });

  it('always creates the imported runtime configuration', () => {
    expect(caddyfile).toContain(
      'import /var/lib/baker/runtime/caddy/https.caddy',
    );
    expect(configureSource).toContain(
      "printf '# Optional HTTPS listener is disabled.",
    );
    expect(entrypointSource).toContain('configure_caddy');
  });

  it('keeps Aliyun secrets in environment placeholders', () => {
    expect(configureSource).toContain(
      'access_key_id {env.ALIYUN_ACCESS_KEY_ID}',
    );
    expect(configureSource).toContain(
      'access_key_secret {env.ALIYUN_ACCESS_KEY_SECRET}',
    );
    expect(configureSource).not.toMatch(/access_key_secret\s+[A-Za-z0-9]{12}/);
  });

  it('validates the hostname, port, and required credentials', () => {
    expect(configureSource).toContain(
      'BAKER_HTTPS_HOST must be a valid DNS hostname.',
    );
    expect(configureSource).toContain(
      'BAKER_HTTPS_PORT must be an integer between 1 and 65535.',
    );
    expect(configureSource).toContain(
      'Aliyun DNS-01 requires ALIYUN_ACCESS_KEY_ID',
    );
  });
});

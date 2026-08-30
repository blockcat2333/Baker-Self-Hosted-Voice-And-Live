import { describe, expect, it } from 'vitest';

import {
  createDesktopServerEntry,
  parseDesktopServerRegistry,
  removeDesktopServer,
  upsertDesktopServer,
} from './server-registry';

const legacy = {
  apiBaseUrl: 'https://one.example.com',
  gatewayUrl: 'wss://one.example.com/ws',
  input: 'one.example.com',
  savedAt: '2026-08-30T00:00:00.000Z',
  serverVersion: '1.1.2',
};

describe('desktop server registry', () => {
  it('migrates the legacy single-server file without adding secrets', () => {
    const parsed = parseDesktopServerRegistry(legacy, () => 'server-one');
    expect(parsed.migrated).toBe(true);
    expect(parsed.registry).toMatchObject({ activeServerId: 'server-one', schemaVersion: 2 });
    expect(parsed.registry.servers[0]).toMatchObject({ ...legacy, id: 'server-one', name: 'Baker' });
    expect(JSON.stringify(parsed.registry)).not.toMatch(/token|password/i);
  });

  it('upserts, orders, and removes servers with an adjacent active fallback', () => {
    const first = createDesktopServerEntry(legacy, {
      id: 'first',
      name: 'First',
      now: legacy.savedAt,
      order: 0,
    });
    const second = createDesktopServerEntry(
      {
        ...legacy,
        apiBaseUrl: 'https://two.example.com',
        gatewayUrl: 'wss://two.example.com/ws',
        input: 'two.example.com',
      },
      { id: 'second', name: 'Second', now: legacy.savedAt, order: 1 },
    );
    let registry = parseDesktopServerRegistry(null, () => 'unused').registry;
    registry = upsertDesktopServer(registry, first, true);
    registry = upsertDesktopServer(registry, second, true);
    expect(registry.servers.map((server) => server.id)).toEqual(['first', 'second']);

    registry = removeDesktopServer(registry, 'second');
    expect(registry.activeServerId).toBe('first');
    expect(registry.servers).toHaveLength(1);
  });
});
